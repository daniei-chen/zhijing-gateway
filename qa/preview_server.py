"""Loopback-only static QA. Synthetic fixtures; never proxies to a real service."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import json
import hashlib
import uuid
import mimetypes
import re
from copy import deepcopy
from fixtures import SETTINGS, STATS, GROUP, SUBSCRIPTION, KEY, START, STAMP, user, paginated
from datetime import datetime, timedelta, timezone
from admin_fixtures import resolve_admin

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'frontend/dist'
SETTINGS.update(site_name='Sub2API', version='local-ui-preview', password_reset_enabled=True,
                channel_monitor_enabled=True, allow_user_view_error_requests=True,
                balance_low_notify_enabled=True, balance_low_notify_threshold=5,
                payment_enabled=True, risk_control_enabled=True,
                affiliate_enabled=True, plugin_management_enabled=True)
SETTINGS['version'] = 'v0.0.2-local-preview'
STATS.update(total_users=6, today_new_users=1, total_accounts=2, normal_accounts=2,
             error_accounts=0, active_users=3, today_account_cost=12.84, total_account_cost=391.25,
             active_requests=0, avg_response_time=18320)
GROUP.update(name='旗舰版', description='智境旗舰工作区 · 本地合成预览')
SUBSCRIPTION.update(expires_at='2099-12-31T15:59:59+00:00')
MEMBER = user(username='创造者 · 本地样本', email='member@preview.local', email_bound=True,
              balance_notify_extra_emails=[dict(email='member@preview.local', verified=True, disabled=False)])
ADMIN = user(102, role='admin', username='维护者 · 本地样本', email='admin@preview.local')
KEYS = [KEY, KEY | dict(id=22, name='自动化任务 · 合成', status='inactive')]
USERS = [user(i, username=f'创造者 {i-100:02d} · 合成', concurrency=3) for i in range(101, 107)]
TREND = [dict(date=(datetime.now(timezone.utc)-timedelta(days=6-i)).strftime('%Y-%m-%d'),
              requests=12+i*5, input_tokens=18000+i*3100, output_tokens=3200+i*800,
              cache_creation_tokens=0, cache_read_tokens=9500+i*1400,
              total_tokens=30700+i*5300, cost=2.0+i*.6, actual_cost=2.0+i*.6) for i in range(7)]
for i, (total, cached_percent) in enumerate([(38000, 24), (65000, 42), (47000, 34), (94000, 62), (71000, 51), (112000, 73), (84000, 67)]):
    output = round(total * .12)
    prompt = total - output
    cached = round(prompt * cached_percent / 100)
    TREND[i].update(input_tokens=prompt-cached, output_tokens=output,
                    cache_read_tokens=cached, total_tokens=total)
MODELS = [dict(model='gpt-6.1-sol', requests=320, input_tokens=960000, output_tokens=148000,
               total_tokens=1840000, cost=284.32, actual_cost=284.32, account_cost=284.32),
          dict(model='gpt-6-astra', requests=106, input_tokens=366000, output_tokens=41000,
               total_tokens=593000, cost=106.93, actual_cost=106.93, account_cost=106.93)]
MONITORS = [dict(id=31+i, name=name, provider=provider, group_name='本地合成预览',
                 primary_model=model, primary_status='operational', primary_latency_ms=800+i*170,
                 primary_ping_latency_ms=90+i*11, availability_7d=99.98-i*.04,
                 extra_models=[], timeline=[dict(status='operational', latency_ms=800+i*170+j%7*23,
                     ping_latency_ms=90+i*11, checked_at=(datetime.now(timezone.utc)-timedelta(minutes=j)).isoformat())
                     for j in range(60)])
            for i, (name, provider, model) in enumerate([
                ('Codex 主线 · 合成', 'openai', 'gpt-6.1-sol'),
                ('Codex 备用 · 合成', 'openai', 'gpt-6-astra'),
                ('Claude 工作区 · 合成', 'anthropic', 'claude-opus'),
                ('Gemini 研究 · 合成', 'gemini', 'gemini-pro')])]


class Handler(BaseHTTPRequestHandler):
    timeout = 10
    max_request_bytes = 16384
    fail_next_snapshot = False
    fail_member_read = False
    def log_message(self, *args):
        pass

    @property
    def identity(self):
        token = self.headers.get('Authorization', '')
        return ADMIN if 'preview-admin' in token else MEMBER

    @property
    def scenario(self):
        return next((v.split('=', 1)[1] for v in self.headers.get('Cookie', '').split('; ') if v.startswith('preview_scenario=')), 'normal')

    def member_subscriptions(self):
        sample = deepcopy(SUBSCRIPTION)
        mode = self.scenario
        if mode == 'empty': return []
        if mode == 'unlimited':
            sample['group'].update(daily_limit_usd=0, weekly_limit_usd=None, monthly_limit_usd=None)
        elif mode == 'over':
            sample['daily_usage_usd'] = sample['group']['daily_limit_usd'] + 8.25
            sample['weekly_usage_usd'] = sample['group']['weekly_limit_usd'] * .82
        elif mode == 'expired':
            sample.update(status='expired', expires_at=(datetime.now(timezone.utc)-timedelta(days=1)).isoformat())
        elif mode == 'missing': sample['group'] = None
        elif mode == 'multi':
            second = deepcopy(sample)
            second.update(id=999, group_id=88, daily_usage_usd=2.5, status='suspended')
            second['group'].update(id=88, name='研究工作区 · 合成', daily_limit_usd=20, weekly_limit_usd=None, monthly_limit_usd=None)
            return [sample, second]
        return [sample]

    def respond(self, value, status=200):
        messages = {200: '本地合成数据', 400: '本地预览：请求格式错误',
                    401: '本地预览：账户或密码错误', 408: '本地预览：请求读取超时',
                    413: '本地预览：请求正文过大'}
        body = json.dumps(dict(code=0 if status == 200 else status,
                               message=messages.get(status, '本地预览：模拟读取失败'),
                               data=value), ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def api(self, path, query):
        p = path.removeprefix('/api/v1')
        admin_fixture = resolve_admin(p, query)
        if admin_fixture is not NotImplemented: return admin_fixture
        if path in ('/setup/status', '/api/v1/setup/status'):
            return dict(needs_setup=False, step='complete')
        if p in ('/auth/me', '/user/profile'):
            if 'preview-' not in self.headers.get('Authorization', ''):
                raise PermissionError
            return self.identity | dict(run_mode='standard')
        if p == '/settings/public': return SETTINGS
        if p == '/admin/settings': return SETTINGS | dict(ops_monitoring_enabled=True, ops_realtime_monitoring_enabled=False)
        if p == '/admin/compliance': return dict(required=False, version='synthetic-local-only')
        if p in ('/payment/config', '/admin/payment/config'): return dict(enabled=True, min_amount=1, max_amount=1000, daily_limit=0, order_timeout_minutes=15, max_pending_orders=3, enabled_payment_types=[], balance_disabled=True, balance_recharge_multiplier=1, subscription_usd_to_cny_rate=7, recharge_fee_rate=0, load_balance_strategy='round_robin', product_name_prefix='', product_name_suffix='', help_image_url='', help_text='仅本地合成预览，不提供支付')
        if p == '/payment/checkout-info':
            return dict(methods={}, global_min=0, global_max=0,
                        plans=[dict(id=701, group_id=GROUP['id'], group_platform=GROUP['platform'],
                                    group_name=GROUP['name'], name='旗舰版 · 本地合成样例',
                                    description='只用于检查续费跳转，不创建订单或提供支付',
                                    price=0, validity_days=30, validity_unit='day', features=[],
                                    for_sale=True, sort_order=0, daily_limit_usd=GROUP['daily_limit_usd'],
                                    weekly_limit_usd=GROUP['weekly_limit_usd'], monthly_limit_usd=GROUP['monthly_limit_usd'])],
                        balance_disabled=True, balance_recharge_multiplier=1, subscription_usd_to_cny_rate=0,
                        recharge_fee_rate=0, help_text='本地合成预览，支付未接通', help_image_url='', stripe_publishable_key='')
        if p == '/admin/system/check-updates':
            return dict(current_version='0.0.2-local-preview', latest_version='0.0.2-local-preview', has_update=False, cached=True, build_type='source')
        if p == '/announcements': return []
        if p.startswith('/subscriptions'):
            if p == '/subscriptions' and self.scenario == 'error' and Handler.fail_member_read:
                Handler.fail_member_read = False
                raise ConnectionError
            samples = self.member_subscriptions()
            active = [item for item in samples if item['status'] == 'active' and
                      (not item.get('expires_at') or datetime.fromisoformat(item['expires_at'].replace('Z', '+00:00')) > datetime.now(timezone.utc))]
            if p == '/subscriptions/summary':
                return dict(active_count=len(active), subscriptions=active)
            if p == '/subscriptions/active': return active
            if p == '/subscriptions/progress': return []
            return samples
        if p.endswith('/platform-quotas'): return dict(platform_quotas=[])
        if p in ('/usage/dashboard/stats', '/admin/dashboard/stats'): return STATS
        if p == '/admin/dashboard/snapshot-v2':
            if Handler.fail_next_snapshot:
                Handler.fail_next_snapshot = False
                raise ConnectionError
            return dict(stats=STATS, trend=TREND, models=MODELS, groups=[])
        if p == '/usage/dashboard/snapshot-v2':
            return dict(generated_at=STAMP, start_date=START[:10], end_date=STAMP[:10],
                        granularity=query.get('granularity', ['day'])[0], trend=TREND,
                        groups=[dict(group_id=7, group_name=GROUP['name'], requests=426, total_tokens=2433000,
                                     cost=391.25, actual_cost=391.25)])
        if p == '/channel-monitors': return dict(items=MONITORS)
        if re.fullmatch(r'/channel-monitors/\d+/status', p):
            monitor = next((item for item in MONITORS if item['id'] == int(p.split('/')[2])), MONITORS[0])
            return dict(id=monitor['id'], name=monitor['name'], provider=monitor['provider'], group_name=monitor['group_name'],
                        models=[dict(model=monitor['primary_model'], latest_status='operational', latest_latency_ms=monitor['primary_latency_ms'],
                                     availability_7d=monitor['availability_7d'], availability_15d=99.94, availability_30d=99.91,
                                     avg_latency_7d_ms=monitor['primary_latency_ms'])])
        if p.endswith('/dashboard/trend'): return dict(trend=TREND, start_date=START[:10], end_date=STAMP[:10], granularity='day')
        if p.endswith('/dashboard/models'): return dict(models=MODELS)
        if p.endswith('/dashboard/users-ranking'): return dict(ranking=[], total_actual_cost=0, total_requests=0, total_tokens=0)
        if p.endswith('/dashboard/groups'): return dict(groups=[])
        if p.endswith('/dashboard/api-keys-trend'): return dict(trend=[], api_keys=[])
        if p.endswith('/dashboard/users-trend'): return dict(trend=[], users=[])
        if p.endswith('/dashboard/user-spending-ranking'): return dict(rankings=[], total_cost=0)
        if p.endswith('/dashboard/realtime'): return dict(active_requests=0, requests_per_minute=0, average_response_time=0, error_rate=0)
        if p in ('/usage/stats', '/admin/usage/stats'): return STATS
        if p in ('/usage', '/user/error-requests', '/admin/usage'): return paginated([])
        if p in ('/usage/models', '/admin/usage/models'): return []
        if p == '/groups/available' or p == '/admin/groups/all': return [GROUP]
        if p == '/admin/groups': return paginated([GROUP])
        if p == '/groups/rates': return {}
        if p == '/keys':
            term = query.get('search', [''])[0].lower()
            state = query.get('status', [''])[0]
            return paginated([key for key in KEYS if term in (key['name']+key['key']).lower()
                              and (not state or key['status'] == state)])
        if p == '/keys/21': return KEY
        if p == '/admin/user-attributes': return []
        if p == '/admin/users':
            text = query.get('search', [''])[0].lower()
            rows = [r for r in USERS if text in (r['username'] + r['email']).lower()]
            return paginated(rows)
        if re.fullmatch(r'/admin/users/\d+', p): return USERS[0] | dict(subscriptions=[SUBSCRIPTION])
        if p == '/admin/subscriptions': return paginated([SUBSCRIPTION])
        if p == '/user/account-bindings': return dict(bindings=[], email_bound=True)
        if p == '/user/totp/status': return dict(enabled=False, pending=False)
        if p == '/user/passkeys': return []
        if p.endswith('/all'): return []
        if p in ('/admin/accounts', '/admin/proxies', '/admin/redeem-codes', '/admin/promo-codes', '/admin/announcements', '/admin/audit-logs', '/redeem/history'):
            return paginated([])
        if p in ('/admin/channels', '/channels', '/channel-monitor'): return []
        raise KeyError(p)

    def do_GET(self):
        try:
            url = urlsplit(self.path)
            query = parse_qs(url.query, max_num_fields=100)
        except ValueError:
            return self.respond(dict(error='invalid_request_query'), 400)
        if url.path == '/__preview':
            body = '''<!doctype html><meta charset="utf-8"><title>智境 · 本地隔离预览</title><style>body{font:16px system-ui;max-width:720px;margin:80px auto;padding:24px;line-height:2;color:#293047}a{color:#7656ce;margin-right:24px}code{background:#f1edfa;padding:4px}</style><h1>智境 · 本地隔离预览</h1><p>页面全部使用合成数据，无生产权限，不连接服务器、模型或支付。</p><p><a href="/login">查看登录页</a><a href="/__preview/member">体验成员工作台</a><a href="/__preview/admin">体验管理员控制台</a></p><p>也可在登录页使用：<code>member@preview.local</code> 或 <code>admin@preview.local</code>，密码 <code>Preview2026!</code>。</p>'''.encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(body); return
        if url.path in ('/__preview/member', '/__preview/admin', '/__preview/logout', '/__preview/failure'):
            role = url.path.rsplit('/', 1)[1]
            if role == 'failure':
                Handler.fail_next_snapshot = True
                role = 'admin'
            self.send_response(303)
            self.send_header('Set-Cookie', f'preview_seed={role}; Path=/; SameSite=Strict; HttpOnly')
            scenario = query.get('scenario', ['normal'])[0]
            if scenario not in ('normal', 'empty', 'unlimited', 'over', 'expired', 'missing', 'multi', 'error'): scenario = 'normal'
            Handler.fail_member_read = scenario == 'error'
            self.send_header('Set-Cookie', f'preview_scenario={scenario}; Path=/; SameSite=Strict; HttpOnly')
            self.send_header('Location', '/subscriptions' if role == 'member' and 'scenario' in query else '/admin/dashboard' if role == 'admin' else '/dashboard' if role == 'member' else '/login')
            self.end_headers(); return
        if url.path.startswith('/api/') or url.path == '/setup/status':
            try: self.respond(self.api(url.path, query))
            except PermissionError: self.respond(None, 401)
            except ConnectionError: self.respond(dict(error='synthetic_one_time_failure'), 503)
            except (ValueError, OverflowError): self.respond(dict(error='invalid_request_query'), 400)
            except KeyError:
                print('UNMAPPED GET', url.path, flush=True)
                self.respond(dict(error='not_in_local_fixture_scope'), 404)
            return
        target = (STATIC / url.path.lstrip('/')).resolve()
        if not target.is_relative_to(STATIC.resolve()): self.send_error(404); return
        if not target.is_file():
            if '.' in target.name: self.send_error(404); return
            target = STATIC / 'index.html'
        data = target.read_bytes()
        if target.name == 'index.html':
            code = 'if(!localStorage.getItem("sub2api_locale"))localStorage.setItem("sub2api_locale","zh");'
            seed = next((v.split('=', 1)[1] for v in self.headers.get('Cookie', '').split('; ') if v.startswith('preview_seed=')), None)
            if seed not in ('admin', 'member', 'logout'): seed = None
            if seed:
                identity = None if seed == 'logout' else ADMIN if seed == 'admin' else MEMBER
                access = None if identity is None else f'preview-{seed}'
                fingerprint = hashlib.sha256(json.dumps([access, None], separators=(',', ':')).encode()).hexdigest()
                record = dict(generation=uuid.uuid4().hex, subject=str(identity['id']) if identity else None,
                              phase='transition', credentials=fingerprint)
                code += 'const previewSession=' + json.dumps(record) + ';localStorage.setItem("auth_session_identity_v1",JSON.stringify(previewSession));'
                code += 'localStorage.removeItem("refresh_token");localStorage.removeItem("token_expires_at");'
                if seed == 'logout': code += 'localStorage.removeItem("auth_token");localStorage.removeItem("auth_user");'
                else:
                    code += f'localStorage.setItem("auth_token","preview-{seed}");localStorage.setItem("auth_user",{json.dumps(json.dumps(identity, ensure_ascii=False))});'
                code += 'previewSession.phase="ready";localStorage.setItem("auth_session_identity_v1",JSON.stringify(previewSession));'
            for role in ('user', 'admin'):
                code += f'localStorage.setItem("{role}_guide_101_{role}_v4_interactive","true");'
                code += f'localStorage.setItem("{role}_guide_102_{role}_v4_interactive","true");'
            code += 'window.__APP_CONFIG__=' + json.dumps(SETTINGS, ensure_ascii=False) + ';'
            banner = '<div id="local-preview-banner" style="position:fixed;bottom:0;left:0;right:0;z-index:10000;padding:5px 8px;background:#201e27;color:#dfd7ee;text-align:center;font:10px/1.5 system-ui;pointer-events:none">本地隔离预览 · 合成数据 · 未连接生产服务</div>'
            data = data.replace(b'</head>', ('<script>' + code + '</script></head>').encode()).replace(b'</body>', (banner + '</body>').encode())
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'self'")
        if target.name == 'index.html' and 'preview_seed=' in self.headers.get('Cookie', ''):
            self.send_header('Set-Cookie', 'preview_seed=; Max-Age=0; Path=/; SameSite=Strict; HttpOnly')
        self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        try:
            path = urlsplit(self.path).path
        except ValueError:
            return self.respond(dict(error='invalid_request_path'), 400)
        lengths = self.headers.get_all('Content-Length', [])
        if len(lengths) > 1 or self.headers.get('Transfer-Encoding') is not None:
            self.close_connection = True
            return self.respond(dict(error='ambiguous_request_framing'), 400)
        length = lengths[0] if lengths else '0'
        if not re.fullmatch(r'[0-9]+', length):
            self.close_connection = True
            return self.respond(dict(error='invalid_content_length'), 400)
        if len(length) > 8 or int(length) > self.max_request_bytes:
            self.close_connection = True
            return self.respond(dict(error='request_body_too_large'), 413)
        try:
            raw = self.rfile.read(int(length))
        except TimeoutError:
            self.close_connection = True
            return self.respond(dict(error='request_read_timeout'), 408)
        if len(raw) != int(length):
            return self.respond(dict(error='incomplete_request_body'), 400)
        try:
            body = json.loads(raw or b'{}')
        except ValueError:
            return self.respond(dict(error='invalid_json'), 400)
        if not isinstance(body, dict):
            return self.respond(dict(error='json_object_required'), 400)
        if path == '/api/v1/user' and self.command == 'PUT' and set(body) == {'balance_notify_enabled'} and isinstance(body['balance_notify_enabled'], bool):
            # In-memory synthetic preference only. No email or production service is contacted.
            self.identity['balance_notify_enabled'] = body['balance_notify_enabled']
            return self.respond(self.identity)
        if path == '/api/v1/auth/login':
            email = body.get('email', '')
            if body.get('password') != 'Preview2026!' or email not in ('member@preview.local', 'admin@preview.local', 'mfa@preview.local'):
                return self.respond(None, 401)
            if email == 'mfa@preview.local':
                return self.respond(dict(requires_2fa=True, temp_token='preview-2fa', user_email_masked='m**@preview.local'))
            identity = ADMIN if email.startswith('admin@') else MEMBER
            return self.respond(dict(access_token='preview-admin' if identity['role'] == 'admin' else 'preview-member', token_type='Bearer', expires_in=3600, user=identity))
        if path in ('/api/v1/auth/logout', '/api/v1/auth/revoke'): return self.respond({})
        if path == '/api/v1/auth/login/2fa':
            if body.get('temp_token') == 'preview-2fa' and body.get('totp_code') == '123456':
                return self.respond(dict(access_token='preview-member', token_type='Bearer', expires_in=3600, user=MEMBER))
            return self.respond(None, 401)
        if path in ('/api/v1/admin/dashboard/users-usage', '/api/v1/usage/dashboard/api-keys-usage'):
            return self.respond(dict(stats={str(i): dict(today_actual_cost=12.84, total_actual_cost=391.25) for i in range(21, 107)}))
        if path == '/api/v1/admin/accounts/today-stats/batch':
            return self.respond(dict(stats={}))
        if path == '/api/v1/admin/accounts/usage/batch':
            return self.respond(dict(usage={}, errors={}))
        print('BLOCKED MUTATION', path, flush=True)
        self.respond(dict(error='local_preview_is_read_only'), 405)

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Loopback-only synthetic UI preview')
    parser.add_argument('--port', type=int, default=18860)
    port = parser.parse_args().port
    if not (STATIC / 'index.html').is_file(): raise SystemExit('Build frontend/dist first')
    print(f'Local isolated preview: http://127.0.0.1:{port}/__preview', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
