"""Local-only, no-proxy original-UI capture with visibly synthetic data."""

from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "reference/backend/internal/web/dist"
NOW = datetime.now(timezone.utc)
STAMP = NOW.isoformat()
END = (NOW + timedelta(days=26)).isoformat()
START = (NOW - timedelta(days=4)).isoformat()


def user(identifier=101, role="user", **extra):
    return dict(
        id=identifier, username=f"研究用户 {identifier - 100:02d}",
        email=f"member-{identifier}@example.test", role=role,
        balance=86.425, frozen_balance=0, concurrency=3, status="active",
        allowed_groups=[7], balance_notify_enabled=False,
        balance_notify_threshold=None, balance_notify_extra_emails=[],
        created_at=START, updated_at=STAMP, notes="仅本地研究，不是真实客户",
        last_active_at=STAMP, last_used_at=STAMP, current_concurrency=1,
    ) | extra


GROUP = dict(
    id=7, name="旗舰版 · 本地合成研究", description="仅用于观察现有订阅排版，不代表已购买或接通拼车",
    platform="openai", rate_multiplier=1, is_exclusive=True, status="active",
    subscription_type="subscription", daily_limit_usd=40, weekly_limit_usd=600,
    monthly_limit_usd=2000, long_context_pricing_enabled=True,
    allow_image_generation=False, allow_batch_image_generation=False,
    allow_live=False, require_oauth_only=False, require_privacy_set=False,
    peak_rate_enabled=False, peak_start="", peak_end="", peak_rate_multiplier=1,
    created_at=START, updated_at=STAMP,
)
SUBSCRIPTION = dict(
    id=11, user_id=101, group_id=7, status="active", starts_at=START,
    expires_at=END, daily_usage_usd=12.84, weekly_usage_usd=146.73,
    monthly_usage_usd=391.25, daily_window_start=STAMP,
    weekly_window_start=START, monthly_window_start=START,
    created_at=START, updated_at=STAMP, group=GROUP,
)
KEY = dict(
    id=21, user_id=101, key="research-only-not-an-api-key", name="开发工作区 · 合成",
    group_id=7, status="active", ip_whitelist=[], ip_blacklist=[],
    last_used_at=STAMP, last_used_ip=None, quota=500, quota_used=81.37,
    expires_at=END, created_at=START, updated_at=STAMP, current_concurrency=0,
    group=GROUP, rate_limit_5h=30, rate_limit_1d=80, rate_limit_7d=240,
    usage_5h=7.82, usage_1d=12.84, usage_7d=81.37,
    window_5h_start=STAMP, window_1d_start=STAMP, window_7d_start=START,
    reset_5h_at=(NOW + timedelta(hours=3)).isoformat(),
    reset_1d_at=(NOW + timedelta(hours=12)).isoformat(),
    reset_7d_at=(NOW + timedelta(days=3)).isoformat(),
)
SETTINGS = dict(
    site_name="智境", site_logo="", site_subtitle="仅合成数据",
    api_base_url="", contact_info="", doc_url="", home_content="",
    registration_enabled=False, email_verify_enabled=False, password_reset_enabled=False,
    force_email_on_third_party_signup=False, registration_email_suffix_whitelist=[],
    invitation_code_enabled=False, promo_code_enabled=False, login_agreement_enabled=False,
    turnstile_enabled=False, turnstile_site_key="", passkey_enabled=False,
    linuxdo_oauth_enabled=False, dingtalk_oauth_enabled=False, wechat_oauth_enabled=False,
    oidc_oauth_enabled=False, oidc_oauth_provider_name="OIDC", github_oauth_enabled=False,
    google_oauth_enabled=False, backend_mode_enabled=False, compact_home_enabled=False,
    payment_enabled=False, risk_control_enabled=False, subscription_enabled=True,
    payment_balance_disabled=True, table_default_page_size=20, table_page_size_options=[20, 50],
    custom_menu_items=[], custom_endpoints=[], version="local-ui-preview",
    balance_low_notify_enabled=False, account_quota_notify_enabled=False,
    balance_low_notify_threshold=0, channel_monitor_enabled=False,
    available_channels_enabled=False, model_plaza_enabled=False,
    model_plaza_require_auth=True, plugin_management_enabled=False,
    service_quota_enabled=False, affiliate_enabled=False, mcp_enabled=False,
    hide_ccs_import_button=True, allow_user_view_error_requests=False,
)
STATS = dict(
    total_api_keys=2, active_api_keys=1, total_requests=426,
    total_input_tokens=1326000, total_output_tokens=189000,
    total_cache_creation_tokens=0, total_cache_read_tokens=918000,
    total_tokens=2433000, total_cost=391.25, total_actual_cost=391.25,
    today_requests=42, today_input_tokens=147000, today_output_tokens=23000,
    today_cache_creation_tokens=0, today_cache_read_tokens=89000,
    today_tokens=259000, today_cost=12.84, today_actual_cost=12.84,
    average_duration_ms=18320, rpm=0.4, tpm=2800, by_platform=[],
)


def paginated(items):
    return dict(items=items, total=len(items), pages=1, page=1, page_size=20)
