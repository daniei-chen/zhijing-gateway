# 智境网关 Docker Image

智境网关 is an AI API Gateway Platform for distributing and managing AI product subscription API quotas.

## Quick Start

```bash
docker run -d \
  --name zhijing-gateway \
  -p 127.0.0.1:8080:8080 \
  -e SERVER_HOST=0.0.0.0 \
  -e DATABASE_URL="postgres://user:pass@host:5432/sub2api" \
  -e REDIS_URL="redis://host:6379" \
  ghcr.io/daniei-chen/zhijing-gateway:latest
```

Without `AUTO_SETUP=true` the container starts the first-run setup wizard, which
creates the administrator account. Two things follow from that:

- **The wizard binds `127.0.0.1` inside the container by default.** A published
  port cannot reach the container's loopback, so a wizard deployment needs
  `-e SERVER_HOST=0.0.0.0`. Publish the port on the host's loopback
  (`-p 127.0.0.1:8080:8080`) and reach it through an SSH tunnel instead of
  exposing it.
- **The wizard requires a one-time setup token.** Read it from the container log
  and open the link it prints:

  ```bash
  docker logs zhijing-gateway 2>&1 | grep -E "Setup token|Open the wizard"
  # open http://127.0.0.1:8080/setup?setup_token=<token>
  ```

The token is written to `setup-token` in the data directory (mode `0600`) as a
fallback, and it is revoked once the installation completes. Compose deployments
that set `AUTO_SETUP=true` skip the wizard and are unaffected.

## Docker Compose

The examples publish the container on `127.0.0.1:8080`, so the gateway answers
only on the Docker host. Serve production traffic through a reverse proxy
(nginx/Caddy) on that host; to publish the port directly instead, map
`-p 8080:8080` and restrict the port in the host firewall. The Compose files in
`deploy/` take the address from `BIND_HOST`, which defaults to `127.0.0.1` and
must be set to `0.0.0.0` to expose the port. A deployment that relied on the
previous `0.0.0.0` default keeps direct access only after setting it
explicitly.

```yaml
version: '3.8'

services:
  zhijing-gateway:
    image: ghcr.io/daniei-chen/zhijing-gateway:latest
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      - DATABASE_URL=postgres://postgres:postgres@db:5432/sub2api?sslmode=disable
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=sub2api
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

## Startup and Database Recovery

智境网关 runs database migrations while starting. PostgreSQL may still be
recovering briefly after a host or Docker daemon restart. The application
retries transient PostgreSQL startup and connection errors with bounded
exponential backoff, then continues startup when the database is ready.
Permanent errors such as invalid credentials, migration checksum mismatches,
SQL errors, and incompatible data fail immediately.

The Compose deployment also checks PostgreSQL readiness with both `pg_isready`
and a simple SQL query. `depends_on: condition: service_healthy` helps order a
fresh Compose start, but application-level retries are still required when
Docker restores existing containers after a host restart.

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `REDIS_URL` | Redis connection string | Yes | - |
| `PORT` | Server port | No | `8080` |
| `SERVER_HOST` | Container listen address for the setup wizard; set `0.0.0.0` to make the wizard reachable through a published port | No | `127.0.0.1` (setup wizard) |
| `GIN_MODE` | Gin framework mode (`debug`/`release`) | No | `release` |
| `AUTO_SETUP` | Configure from environment variables on first start instead of running the wizard | No | unset |

## Supported Architectures

- `linux/amd64`
- `linux/arm64`

## Tags

- `latest` - Latest stable release
- `x.y.z` - Specific version
- `x.y` - Latest patch of minor version
- `x` - Latest minor of major version

## Links

- [GitHub Repository](https://github.com/daniei-chen/zhijing-gateway)
- [Documentation](https://github.com/daniei-chen/zhijing-gateway#readme)
