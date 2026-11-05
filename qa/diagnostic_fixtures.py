"""v0.0.2 synthetic diagnostics only. No production data or provider connections."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json


def samples():
    now = datetime.now(timezone.utc)

    def stamp(age):
        return (now - timedelta(seconds=age)).isoformat()

    def timing(age, metrics, result="complete"):
        return dict(schema_version=1, source="process_memory", observed_at=stamp(age),
                    retention_seconds=86400, capacity=4096, metrics=metrics, body_read_result=result)

    base = dict(platform="openai", model="gpt-6.1-sol", user_id=101, api_key_id=21, group_id=7,
                user_email="member@preview.local", api_key_name="本地合成密钥", account_name="",
                group_name="旗舰版 · 合成", resolved=False, client_request_id="", request_type=2,
                inbound_endpoint="/v1/chat/completions", request_path="/v1/chat/completions",
                stream=True, error_body="", upstream_errors="[]")
    errors = [
        base | dict(id=61, created_at=stamp(75), request_id="synthetic-local-limit", status_code=429,
                    phase="request", type="rate_limit_error", error_owner="client", error_source="gateway",
                    severity="P1", account_id=None, is_business_limited=True,
                    message="个人并发已达上限，请等待正在执行的请求完成后再试（上限 3）",
                    error_body=json.dumps(dict(error=dict(type="rate_limit_error", code="gateway_user_concurrency_limit", message="本地合成并发提示")))),
        base | dict(id=62, created_at=stamp(120), request_id="synthetic-provider-limit", status_code=429,
                    phase="upstream", type="rate_limit_error", error_owner="provider", error_source="upstream_http",
                    severity="P1", account_id=41, account_name="创作车 01 · 合成", is_business_limited=False,
                    message="合成上游限流样本", upstream_status_code=429, upstream_error_message="Synthetic upstream rate limit",
                    error_body=json.dumps(dict(error=dict(type="rate_limit_error", code="rate_limit_exceeded", message="Synthetic upstream rate limit")))),
        base | dict(id=63, created_at=stamp(165), request_id="synthetic-legacy-attribution", status_code=429,
                    phase="upstream", type="rate_limit_error", error_owner="provider", error_source="upstream_http",
                    severity="P1", account_id=None, is_business_limited=False,
                    message="个人并发已达上限，请等待正在执行的请求完成后再试"),
        base | dict(id=64, created_at=stamp(210), request_id="synthetic-body-interrupted", status_code=400,
                    phase="request", type="invalid_request_error", error_owner="client", error_source="client_request",
                    severity="P3", account_id=None, is_business_limited=False, message="Failed to read request body (synthetic)")
    ]
    requests = [dict(kind="success", created_at=stamp(30), request_id="synthetic-upload-sample",
                     platform="openai", model="gpt-6.1-sol", duration_ms=8310, first_token_ms=2240,
                     user_id=101, api_key_id=21, account_id=41, group_id=7, stream=True,
                     gateway_timing=timing(30, dict(body_read_block_ms=10240, body_ready_ingress_ms=10254,
                         body_normalize_ms=8, body_wire_bytes=1310720, user_wait_ms=0, account_wait_ms=110,
                         connection_wait_ms=6, routing_start_ingress_ms=10400, chat_first_event_ingress_ms=12680,
                         upstream_semantic_ingress_ms=15320, downstream_semantic_flush_ingress_ms=15322, upstream_attempts=1)))]
    metrics = {
        61: dict(body_read_block_ms=44, body_ready_ingress_ms=48, user_wait_ms=0),
        62: dict(body_read_block_ms=62, body_ready_ingress_ms=64, routing_start_ingress_ms=74,
                 user_wait_ms=0, account_wait_ms=0, connection_wait_ms=8, upstream_attempts=1),
        64: dict(body_read_block_ms=63000, body_wire_bytes=65536),
    }
    for error in errors:
        row = {k: error[k] for k in ("created_at", "request_id", "platform", "model", "status_code", "phase",
                                    "message", "error_owner", "error_source", "user_id", "api_key_id", "account_id", "group_id", "stream")}
        row.update(kind="error", error_id=error["id"])
        if error["id"] in metrics:
            row["gateway_timing"] = timing((61, 62, 64).index(error["id"]) * 45 + 75, metrics[error["id"]], "error" if error["id"] == 64 else "complete")
        requests.append(row)
    requests.append(dict(kind="success", created_at=stamp(255), request_id="synthetic-old-backend",
                         platform="openai", model="gpt-6.1-sol", duration_ms=4200, first_token_ms=0,
                         account_id=41, user_id=101, api_key_id=21, group_id=7, stream=True))
    # Complete the same 684-request synthetic window used by the overview.
    for index in range(678):
        requests.append(dict(kind="success", created_at=stamp(256 + index * 4),
                             request_id=f"synthetic-history-{index:04d}", platform="openai", model="gpt-6.1-sol",
                             duration_ms=8400, first_token_ms=820, account_id=41, user_id=101,
                             api_key_id=21, group_id=7, stream=True))
    return requests, errors


def page(rows, query):
    number = max(1, int(query.get("page", [1])[0]))
    size = min(100, max(1, int(query.get("page_size", [10])[0])))
    start = (number - 1) * size
    return dict(items=rows[start:start + size], total=len(rows), page=number, page_size=size, pages=(len(rows) + size - 1) // size)


def resolve_diagnostics(end, query):
    if end != "requests" and not any(end == name or end.startswith(name + "/") for name in ("errors", "request-errors", "upstream-errors")):
        return NotImplemented
    requests, errors = samples()
    if end == "requests":
        kind = query.get("kind", ["all"])[0]
        rows = [r for r in requests if kind == "all" or r["kind"] == kind]
        for param, field in (("platform", "platform"), ("group_id", "group_id"), ("request_id", "request_id")):
            value = query.get(param, [""])[0]
            if value: rows = [r for r in rows if str(r.get(field, "")) == str(value)]
        for param, compare in (("min_duration_ms", lambda v, n: v >= n), ("max_duration_ms", lambda v, n: v <= n)):
            if param in query: rows = [r for r in rows if isinstance(r.get("duration_ms"), (int, float)) and compare(r["duration_ms"], float(query[param][0]))]
        sort = query.get("sort", ["created_at_desc"])[0]
        field = {"duration_desc": "duration_ms", "ttft_desc": "first_token_ms"}.get(sort, "created_at")
        rows.sort(key=lambda r: (r.get(field) is not None, r.get(field) if r.get(field) is not None else 0), reverse=True)
        return page(rows, query)
    if end.endswith("/upstream-errors"):
        return []
    if "/" in end:
        identifier = end.rsplit("/", 1)[1]
        return next((deepcopy(r) for r in errors if str(r["id"]) == identifier), None)
    rows = errors
    if end == "upstream-errors": rows = [r for r in rows if r["error_owner"] == "provider"]
    view = query.get("view", ["all"])[0]
    if view == "errors": rows = [r for r in rows if not r["is_business_limited"]]
    if view == "excluded": rows = [r for r in rows if r["is_business_limited"]]
    for field in ("status_code", "phase", "error_owner"):
        value = query.get(field, [""])[0]
        if value: rows = [r for r in rows if str(r.get(field, "")) == str(value)]
    text = query.get("q", [""])[0].lower()
    if text: rows = [r for r in rows if text in (r["message"] + r["request_id"]).lower()]
    return page(rows, query)
