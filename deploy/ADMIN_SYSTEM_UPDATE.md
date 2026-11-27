# Admin system update gate

`POST /api/v1/admin/system/update` downloads a release binary and replaces the
running service in place. Anyone who can call it holds code execution on the
host, so the application now refuses it unless three independent conditions
hold. This page covers the policy, how the caller address is resolved, the
configuration for the current origin/edge topology, and what an upgrade changes
for existing release automation.

## Defaults

| Setting | Default | Effect |
| --- | --- | --- |
| `security.admin_system_update.enabled` | `false` | Every call is rejected. |
| `security.admin_system_update.allow_cidrs` | `127.0.0.1/32`, `::1/128` | Only a peer on the same host passes the address check. |

The endpoint answers `403` with code `ADMIN_SYSTEM_UPDATE_FORBIDDEN` when it is
disabled or when the caller address is not allowed. Both cases share one code
and one message on purpose: the route exists in a public binary, so hiding it
behind `404` conceals nothing, while a single stable code keeps the gate from
reporting its configuration to the caller. The precise reason (disabled, peer
not allowed, step-up state) is written to the audit log and the process log.

## Decision order

1. `enabled` must be `true`, otherwise reject.
2. The caller address must match `allow_cidrs`, otherwise reject.
3. The current session must hold a TOTP step-up grant, otherwise reject with the
   usual step-up codes (`STEP_UP_REQUIRED`, `STEP_UP_TOTP_NOT_ENABLED`,
   `STEP_UP_ADMIN_API_KEY_FORBIDDEN`, ...).

The handler runs only when all three pass.

Step 3 is deliberately **not** governed by `settings.step_up_enabled`. That
setting defaults to off and can be switched off from the admin UI, which would
otherwise remove the last check on the most dangerous endpoint. This gate passes
no settings reader at all, so the global switch cannot turn it off. Other
step-up-protected endpoints keep their existing behaviour.

Because step 3 rejects machine credentials, an **admin API key can never call
this endpoint**, no matter how the CIDR list is configured. The caller must be a
signed-in administrator session that has enabled TOTP and completed
`POST /api/v1/user/totp/step-up` within the session's step-up window.

## How the caller address is resolved

Only the TCP peer (`c.Request.RemoteAddr`) is trusted:

- The peer address itself is matched against `allow_cidrs`.
- `X-Forwarded-For`, `CF-Connecting-IP`, `X-Real-IP` and any custom client-IP
  header are ignored unless the peer is listed in `server.trusted_proxies`.
- When the peer is a trusted proxy, all `X-Forwarded-For` fields are combined in
  order into one chain, walked from right to left, skipping trusted hops and
  taking the first untrusted address; `X-Real-IP` is used only when
  `X-Forwarded-For` is absent. That resolved address is what `allow_cidrs`
  matches.

`security.trust_forwarded_ip_for_api_key_acl` does not affect this endpoint.
That legacy switch makes raw forwarding headers authoritative for client-IP
metadata (it shipped as `true` historically and now defaults to `false`); an IP
allowlist built on it is bypassable by adding a header whenever it is on. The
gate therefore never reads the legacy resolution path.

A forwarded chain that contains a value which is not an IP address is treated as
unusable: the call is rejected rather than falling back to the proxy's own
address. Falling back would turn the most common `allow_cidrs` entry (loopback)
into "anyone who can reach the proxy passes", so one malformed value would
disable the address check. The audit entry shows an empty
`system_update_peer_ip` with `system_update_result=peer_not_allowed` in that
case.

## Configuring the current topology

The origin runs in Japan and the public entry point is the Tencent Cloud machine
`175.27.132.225`, which connects back to the origin. The origin must therefore
allow the entry machine, not just loopback.

**Pattern A — the origin sees the entry machine as the TCP peer** (the app port
is reachable only from the entry machine, or is bound to the entry machine's
tunnel address):

```yaml
security:
  admin_system_update:
    enabled: true
    allow_cidrs:
      - "175.27.132.225/32"
```

**Pattern B — a reverse proxy on the origin (nginx/Caddy on loopback) fronts the
app.** The TCP peer is then `127.0.0.1`, which the default list already allows,
so the gate would delegate the decision entirely to that proxy. To make
`allow_cidrs` decide, declare the local proxy as trusted and let the chain
resolve the entry machine:

```yaml
server:
  trusted_proxies:
    - 127.0.0.1/32
security:
  admin_system_update:
    enabled: true
    allow_cidrs:
      - "175.27.132.225/32"
```

Only do this while the application port is unreachable except through that
proxy; a trusted proxy entry is an instruction to believe the headers it sends.
Keep the existing edge rules in place as well — this gate is a backstop for the
application, not a replacement for restricting `/admin/system/update` at the
edge.

Equivalent environment variables (usable when the deployment has no config
file):

```
SECURITY_ADMIN_SYSTEM_UPDATE_ENABLED=true
SECURITY_ADMIN_SYSTEM_UPDATE_ALLOW_CIDRS=127.0.0.1/32,175.27.132.225/32
```

An empty `allow_cidrs` list denies every caller; an unparseable entry fails
startup instead of being silently dropped.

## Audit

Every attempt records the decision, whether it passed or not:

- Audit log entry for `POST /api/v1/admin/system/update` with extra fields
  `system_update_peer_ip`, `system_update_cidr` (the matched rule, or `none`),
  `system_update_step_up` (`granted`, `not_evaluated`, or the step-up rejection
  code) and `system_update_result` (`allowed`, `disabled`, `peer_not_allowed`,
  `denied`).
- A process log line `admin system update gate decision` with the same fields at
  `INFO` for an allowed call and `WARN` otherwise.

`system_update_peer_ip` is the address the gate actually decided on. The audit
entry's own `client_ip` column follows the legacy metadata path and may reflect
a forwarded header, so use the gate field when reconstructing what happened.

## Upgrade impact

After upgrading, `POST /api/v1/admin/system/update` **stops working by
default**: it returns `403 ADMIN_SYSTEM_UPDATE_FORBIDDEN` until
`security.admin_system_update.enabled` is set to `true` and the caller address is
inside `allow_cidrs`. A release script that calls this endpoint fails at that
point — the update does not happen, and the service keeps running the old
binary. Two further consequences matter for automation:

- Even with the gate open, the call must come from an administrator **browser
  session with TOTP step-up**. A script authenticating with an admin API key is
  rejected (`STEP_UP_ADMIN_API_KEY_FORBIDDEN`) regardless of configuration, so
  such a script needs a real step-up session or a deployment path outside this
  endpoint (SSH, systemd, image rollout).
- The `rollback` and `restart` endpoints are not covered by this gate; they keep
  the previous step-up behaviour, which is governed by `step_up_enabled`.

Startup logs the gate state once: `admin system update gate open` with the
allowlist, or `admin system update gate closed: ...` when the default applies.
