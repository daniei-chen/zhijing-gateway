"""V4 loopback UI fixtures. No network, credentials, inference or persistent writes."""
from datetime import datetime, timedelta, timezone
from fixtures import GROUP, SUBSCRIPTION, STAMP, START, paginated

NOW = datetime.now(timezone.utc)
POINTS = [dict(bucket_start=(NOW-timedelta(minutes=59-i)).isoformat(), request_count=8+i%7,
               token_consumed=40000+(i%9)*5500, switch_count=i%3,
               qps=round(.15+(i%7)*.035, 3), tps=900+(i%9)*170) for i in range(60)]
THROUGHPUT = dict(bucket='1m', points=POINTS,
                  by_platform=[dict(platform='openai', request_count=684, token_consumed=3510000)],
                  top_groups=[dict(group_id=7, group_name='旗舰版 · 合成', request_count=684, token_consumed=3510000)])
OVERVIEW = dict(start_time=START, end_time=STAMP, platform='', health_score=98,
    success_count=682, error_count_total=2, business_limited_count=0, error_count_sla=2,
    request_count_total=684, request_count_sla=684, token_consumed=3510000,
    sla=.99708, error_rate=.00292, upstream_error_rate=.00146,
    upstream_error_count_excl_429_529=1, upstream_429_count=0, upstream_529_count=0,
    qps=dict(current=.28, peak=.36, avg=.24), tps=dict(current=1920, peak=2260, avg=1580),
    output_tps=dict(p5=18.2, p10=22.3, p50=48.1, avg=47.4, sample_count=682),
    duration=dict(p50_ms=8400, p90_ms=18800, p95_ms=24500, p99_ms=41000, avg_ms=12900, max_ms=58000),
    ttft=dict(p50_ms=820, p90_ms=2100, p95_ms=2800, p99_ms=4200, avg_ms=960, max_ms=7800),
    system_metrics=dict(id=1, created_at=STAMP, window_minutes=1, cpu_usage_percent=12.4,
        memory_used_mb=146, memory_total_mb=768, memory_usage_percent=19.0,
        db_ok=True, redis_ok=True, db_max_open_conns=12, redis_pool_size=24,
        redis_conn_total=5, redis_conn_idle=4, db_conn_active=1, db_conn_idle=3,
        db_conn_waiting=0, goroutine_count=171, concurrency_queue_depth=0),
    job_heartbeats=[dict(job_name='合成指标聚合', last_run_at=STAMP, last_success_at=STAMP,
                         last_duration_ms=18, last_result='ok', updated_at=STAMP)])
ERROR_TREND = dict(bucket='1m', points=[dict(bucket_start=p['bucket_start'],
    error_count_total=1 if i in (12, 40) else 0, error_count_sla=1 if i in (12, 40) else 0,
    business_limited_count=0, upstream_error_count_excl_429_529=1 if i==12 else 0,
    upstream_429_count=0, upstream_529_count=0) for i,p in enumerate(POINTS)])
ADVANCED = dict(data_retention=dict(cleanup_enabled=True, cleanup_schedule='0 3 * * *',
    error_log_retention_days=30, minute_metrics_retention_days=7, hourly_metrics_retention_days=90),
    aggregation=dict(aggregation_enabled=True), openai_account_quota_auto_pause=dict(default_threshold_5h=0,default_threshold_7d=0),
    ignore_count_tokens_errors=False, ignore_context_canceled=True, ignore_no_available_accounts=False,
    ignore_invalid_api_key_errors=False, ignore_insufficient_balance_errors=False,
    display_openai_token_stats=False, display_alert_events=True, auto_refresh_enabled=False, auto_refresh_interval_seconds=60)
CONCURRENCY = dict(current_in_use=3, max_capacity=18, load_percentage=16.7, waiting_in_queue=0)
ACCOUNTS = [dict(id=41+i, name=name, platform='openai', type='oauth', credentials={}, extra={},
    concurrency=9, current_concurrency=2-i, priority=i+1, rate_multiplier=1, status='active',
    error_message='', notes='仅本地合成样本，无上游凭证', group_ids=[7], groups=[GROUP],
    schedulable=True, auto_pause_on_expired=False, last_used_at=STAMP, created_at=START, updated_at=STAMP,
    rate_limited_at=None, rate_limit_reset_at=None, overload_until=None, expires_at=None)
    for i,name in enumerate(['创作车 01 · 合成','研究车 02 · 合成'])]
PLAN = dict(id=51, group_id=7, group_platform='openai', group_name='旗舰版', name='旗舰版 · 合成',
    description='本地套餐展示样本，不代表线上权益或售价', price=520, currency='CNY', original_price=599,
    validity_days=30, validity_unit='days', features=['独立成员额度','原生订阅权益'],
    for_sale=True, sort_order=1)
RISK_CONFIG = dict(engine='openai', enabled=False, mode='off', base_url='', model='', proxy_id=None,
    api_key_configured=False, api_key_masked='', api_key_count=0, api_key_masks=[], api_key_statuses=[],
    timeout_ms=10000, sample_rate=1, all_groups=True, group_ids=[], record_non_hits=False,
    thresholds={}, worker_count=2, queue_size=100, block_status=403, block_message='',
    email_on_hit=False, auto_ban_enabled=False, ban_threshold=5, violation_window_hours=24,
    retry_count=0, hit_retention_days=30, non_hit_retention_days=7, pre_hash_check_enabled=False,
    blocked_keywords=[], keyword_blocking_mode='keyword_only', model_filter=dict(type='all',models=[]),
    cyber_policy_exclude_from_ban_count=False)


def resolve_admin(p, query):
    if p.startswith('/admin/ops/'):
        end=p.removeprefix('/admin/ops/')
        fixed={
            'dashboard/snapshot-v2':dict(generated_at=STAMP, overview=OVERVIEW, throughput_trend=THROUGHPUT,error_trend=ERROR_TREND),
            'dashboard/overview':OVERVIEW, 'dashboard/throughput-trend':THROUGHPUT,
            'dashboard/error-trend':ERROR_TREND,
            'dashboard/latency-histogram':dict(start_time=START,end_time=STAMP,platform='',total_requests=684,
                buckets=[dict(range=r,count=n) for r,n in [('0-5s',116),('5-10s',296),('10-20s',194),('20-40s',65),('40s+',13)]]),
            'dashboard/error-distribution':dict(total=2,items=[dict(status_code=502,total=1,sla=1,business_limited=0),dict(status_code=504,total=1,sla=1,business_limited=0)]),
            'dashboard/openai-token-stats':dict(time_range='1h',start_time=START,end_time=STAMP,items=[],total=0),
            'concurrency':dict(enabled=True,platform=dict(openai=dict(platform='openai',**CONCURRENCY)),
                group={'7':dict(group_id=7,group_name='旗舰版 · 合成',platform='openai',**CONCURRENCY)},
                account={},timestamp=STAMP),
            'user-concurrency':dict(enabled=True,user={},timestamp=STAMP),
            'account-availability':dict(enabled=True,platform=dict(openai=dict(platform='openai',total_accounts=2,available_count=2,rate_limit_count=0,error_count=0)),group={},account={},timestamp=STAMP),
            'realtime-traffic':dict(enabled=True,summary=dict(window=query.get('window',['1min'])[0],start_time=START,end_time=STAMP,platform='',qps=OVERVIEW['qps'],tps=OVERVIEW['tps']),timestamp=STAMP),
            'advanced-settings':ADVANCED, 'settings/metric-thresholds':dict(sla_percent_min=99,ttft_p99_ms_max=5000,request_error_rate_percent_max=2,upstream_error_rate_percent_max=2),
            'alert-rules':[], 'alert-events':[],
            'runtime/alert':dict(evaluation_interval_seconds=60,distributed_lock=dict(enabled=True,key='synthetic',ttl_seconds=60),silencing=dict(enabled=False,global_until_rfc3339='',global_reason='',entries=[]),thresholds={}),
            'email-notification/config':dict(alert=dict(enabled=False,recipients=[],min_severity='warning',rate_limit_per_hour=10,batching_window_seconds=60,include_resolved_alerts=True),
                report=dict(enabled=False,recipients=[],daily_summary_enabled=False,daily_summary_schedule='0 9 * * *',weekly_summary_enabled=False,weekly_summary_schedule='0 9 * * 1',error_digest_enabled=False,error_digest_schedule='0 * * * *',error_digest_min_count=5,account_health_enabled=False,account_health_schedule='0 9 * * *',account_health_error_rate_threshold=5)),
            'runtime/logging':dict(level='info',persist_access_logs=False,enable_sampling=False,sampling_initial=100,sampling_thereafter=100,caller=True,stacktrace_level='error',retention_days=30,request_retention_days=90),
            'system-logs/health':dict(queue_depth=0,queue_capacity=5000,written_count=426,dropped_count=0,write_failed_count=0,avg_write_delay_ms=4,last_error=''),
            'system-logs':paginated([dict(id=61,created_at=STAMP,level='info',component='preview',message='本地合成日志：指标汇总完成',platform='openai',fields={},host='preview.local')]),
            'requests':paginated([dict(kind='success',created_at=STAMP,request_id='preview-request-001',platform='openai',model='gpt-6.1-sol',duration_ms=8400,first_token_ms=820,status_code=200,user_id=101,api_key_id=21,account_id=41,group_id=7,stream=True)])}
        if end in fixed:return fixed[end]
        if end in ('errors','request-errors','upstream-errors'):return paginated([])
    if p=='/admin/accounts':return paginated(ACCOUNTS)
    if p=='/admin/groups/usage-summary':return [dict(group_id=7,today_cost=12.84,yesterday_cost=8.42,total_cost=391.25)]
    if p=='/admin/groups/capacity-summary':return [dict(group_id=7,concurrency_used=3,concurrency_max=18,sessions_used=0,sessions_max=0,rpm_used=0,rpm_max=0)]
    if p=='/admin/groups/live-capability':return dict(enabled=False)
    if p=='/admin/groups/0/model-allowlist-candidates':return dict(models=[])
    if p in ('/admin/accounts/all','/admin/accounts/simple'):return ACCOUNTS
    if p=='/admin/channels':return paginated([])
    if p=='/admin/plugins':return []
    if p=='/admin/channel-monitors':return dict(items=[],total=0,page=1,page_size=20)
    if p in ('/admin/payment/plans','/payment/plans'):return [PLAN]
    if p=='/admin/payment/orders':return paginated([])
    if p=='/admin/payment/providers':return []
    if p=='/admin/payment/channels':return []
    if p=='/admin/payment/dashboard':return dict(today_amount={'CNY':4160},total_amount={'CNY':61360},today_count=8,total_count=128,avg_amount={'CNY':520},total_orders=128,paid_orders=118,pending_orders=6,failed_orders=4,
        total_revenue={'CNY':61360},total_refunded={'CNY':520},total_refunds={'CNY':520},
        today_orders=8,today_revenue={'CNY':4160},conversion_rate=92.19,
        daily_series=[dict(date=(NOW-timedelta(days=6-i)).strftime('%Y-%m-%d'),count=11+i,amount={'CNY':5720+i*520}) for i in range(7)],
        payment_methods=[],top_users={})
    if p in ('/admin/affiliates/invites','/admin/affiliates/rebates','/admin/affiliates/transfers'):return paginated([])
    if p=='/admin/risk-control/config':return RISK_CONFIG
    if p=='/admin/risk-control/status':return dict(enabled=False,risk_control_enabled=True,mode='off',engine='openai',queue_size=0,queue_capacity=100,worker_count=2,processed_total=0,hit_total=0,blocked_total=0,pre_block_api_key_available_count=0,api_keys=[])
    if p=='/admin/risk-control/logs':return paginated([])
    if p=='/admin/prompt-audit/config':return dict(enabled=False,blocking_enabled=False,blocking_latest_turn_only=True,
        store_pass_events=False,effective_mode='off',strategy='priority',worker_count=2,queue_capacity=100,
        scanners=[],all_groups=True,group_ids=[],endpoints=[],config_version=1,updated_at=STAMP,updated_by=101,change_summary='本地合成')
    if p=='/admin/prompt-audit/events':return paginated([])
    if p=='/admin/prompt-audit/runtime':return dict(process_status='disabled',effective_mode='off',expected_config_version=1,active_config_version=1,
        worker_total=2,worker_active=0,queue_capacity=100,queue=dict(staging=0,queued=0,processing=0,retry=0,done=0,failed=0,active=0),
        processed_total=0,failed_total=0,enqueued_total=0,dropped_total=0,database_status='ok',redis_status='ok',endpoints={},guard_metrics=dict(total=0,allowed=0,flagged=0,blocked=0,unavailable=0,invalid=0,timeouts=0,failovers=0,bulkhead_full=0,record_failed=0))
    if p=='/admin/settings/admin-api-key':return dict(exists=False,masked_key='')
    if p=='/admin/settings/admin-api-keys':return dict(items=[],permissions=[])
    if p=='/admin/settings/email-templates':return dict(templates=[])
    if p=='/admin/affiliates/users':return paginated([])
    if p in ('/admin/settings/overload-cooldown','/admin/settings/rate-limit-429-cooldown',
             '/admin/settings/panel-rate-limit','/admin/settings/stream-timeout',
             '/admin/settings/rectifier','/admin/settings/beta-policy','/admin/settings/web-search-emulation',
             '/admin/accounts/upstream-billing-probe/settings','/admin/accounts/ollama-cloud-usage/settings',
             '/admin/accounts/opencode-go-usage/settings'):return dict(enabled=False)
    if p=='/admin/backups':return paginated([])
    if p=='/admin/backups/s3-config':return dict(enabled=False,endpoint='',region='',bucket='',prefix='',access_key_id='',secret_key_set=False,use_path_style=False)
    if p=='/admin/backups/image-storage':return dict(enabled=False,endpoint='',bucket='',public_url='',prefix='')
    if p=='/admin/backups/schedule':return dict(enabled=False,cron='0 3 * * *',retention_count=7)
    if p=='/admin/access-keys':return []
    return NotImplemented
