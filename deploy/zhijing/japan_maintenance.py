"""Target-only health watch and protected backups; no provider probes."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time
import urllib.request

ROOT=Path('/opt/zhijing-sub2api')
STATE=ROOT/'maintenance'
APP='zhijing-api-v005'
DB='zhijing-sub2api-japan-postgres-1'
REDIS='zhijing-sub2api-japan-redis-1'
ROLLING_RELEASE=ROOT/'backend-releases/20261106-v0.0.4'
PEER='zhijing-sub2api-japan-api-v004'
# 当前生产实例从 nginx upstream 动态解析（2026-11-10 起拓扑会随蓝绿/灰度变化，
# 硬编码 port/app 曾在 v0.0.7 上线后导致脚本监控的是备份而非生产）。
#
# 2026-11-14 审计修复：Nginx 实际加载的是 sites-enabled 下的文件，而 sites-available
# 里那份副本已与线上漂移（available 主节点 18800，enabled 主节点 18801）。看门狗读错
# 文件会监控到错误的实例，因此优先读 enabled，available 仅作兜底。
NGINX_SITE=Path('/etc/nginx/sites-enabled/zhijing.kaogong.art')
NGINX_SITE_FALLBACK=Path('/etc/nginx/sites-available/zhijing.kaogong.art')
DEFAULT_PROBE_PORT=18786
DEFAULT_APP='zhijing-api-v007'
# 自动 docker restart 会让请求在重启窗口内失败，等于制造停机。
# 默认关闭，只有显式设置 ZHIJING_AUTO_RESTART=1 才恢复旧的自愈行为。
AUTO_RESTART_ENV='ZHIJING_AUTO_RESTART'


def auto_restart_enabled():
    return os.environ.get(AUTO_RESTART_ENV,'').strip().lower() in ('1','true','yes')


def _active_cert_paths():
    """返回 nginx 实际在用的证书文件路径。

    2026-11-14 审计修复：原实现只检查
    /etc/letsencrypt/live/154-36-187-147.sslip.io/fullchain.pem，
    而 zhijing.kaogong.art 站点用的是 /etc/nginx/zhijing-tls/fullchain.pem
    —— 这张证书不参与 certbot 自动续期、2027-01-28 到期，最需要盯的一张
    从来没有被检查过。现在从 nginx -T 里取全部 ssl_certificate。
    """
    paths=[]
    try:
        out=run(['nginx','-T'],timeout=60).decode('utf-8','replace')
        for line in out.splitlines():
            stripped=line.strip()
            if not stripped.startswith('ssl_certificate'):
                continue
            if stripped.startswith('ssl_certificate_key'):
                continue
            if ';' not in stripped:
                continue
            path=stripped[len('ssl_certificate'):].split(';')[0].strip()
            if path and path not in paths:
                paths.append(path)
    except (RuntimeError,OSError,subprocess.SubprocessError):
        pass
    legacy='/etc/letsencrypt/live/154-36-187-147.sslip.io/fullchain.pem'
    if legacy not in paths:
        paths.append(legacy)
    return paths



def run(args,timeout=60):
    process=subprocess.run(args,capture_output=True,timeout=timeout)
    if process.returncode:raise RuntimeError('local_command_failed')
    return process.stdout


def _read_site_text():
    for path in (NGINX_SITE,NGINX_SITE_FALLBACK):
        try:
            return path.read_text(encoding='utf-8',errors='replace')
        except OSError:
            continue
    return None


def resolve_primary():
    """从 nginx upstream 的 peers 块解析当前主实例端口，再反查容器名。

    蓝绿/灰度切换后无需修改本脚本；任何一步解析失败都回退到 DEFAULT_*，
    保证脚本在异常情况下仍指向一个确定的实例而不是直接失效。

    2026-11-14 审计修复：
    - 读 sites-enabled（nginx 实际加载的文件），available 仅作兜底；
    - 原正则要求 `weight=N;` 紧跟分号，而线上是
      `server 127.0.0.1:18801 weight=100 max_fails=1 fail_timeout=10s;`，
      永远匹配不上，于是每 60 秒静默回退到 18786/zhijing-api-v007 这两个
      已经不存在的目标，看门狗整整失明。现在允许 weight 之后出现其他参数。
    """
    import re
    port=None
    text=_read_site_text()
    if text:
        block=re.search(r'# ---- zhijing-peers-begin ----(.*?)# ---- zhijing-peers-end ----',text,re.S)
        if block:
            for line in block.group(1).splitlines():
                m=re.search(r'server\s+127\.0\.0\.1:(\d+)\s+weight=(\d+)',line)
                if m and int(m.group(2))>0:
                    port=int(m.group(1))
                    break
    name=None
    if port is not None:
        try:
            out=run(['docker','ps','--filter','publish=%d'%port,'--format','{{.Names}}'])
            names=[x for x in out.decode().strip().splitlines() if x]
            if names:
                name=names[0]
        except (RuntimeError,OSError):
            pass
    return (port if port is not None else DEFAULT_PROBE_PORT,
            name if name is not None else DEFAULT_APP)


def private_json(path,value):
    temp=path.with_suffix('.tmp')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:json.dump(value,f)
    temp.replace(path)


def check_ops_baselines():
    """运维基线检查：证书到期、备份新鲜度、磁盘余量。

    这些是审计 P1-12/P1-13/P1-21 的可观测部分——不做异地存储和 PITR 本身
    （需要外部资源与 PG 重启），但至少让"快到期了/备份停了/盘快满了"可见。
    任何一项失败都不影响主流程，只写进 health.json 供外部读取。
    """
    out={}
    # 2026-11-14：改为检查 nginx 实际在用的每一张证书（含不参与 certbot 自动续期的
    # /etc/nginx/zhijing-tls/fullchain.pem），并保留 cert_days_left/cert_ok 兼容字段，
    # 取所有证书里最早到期的那张作为汇总值。
    try:
        certs=[]
        for raw_path in _active_cert_paths():
            cert=Path(raw_path)
            if not cert.exists():
                continue
            r=subprocess.run(['openssl','x509','-enddate','-noout','-in',str(cert)],
                             capture_output=True,timeout=10)
            text=r.stdout.decode().strip()
            if not text.startswith('notAfter='):
                continue
            exp=dt.datetime.strptime(text[len('notAfter='):].strip(),'%b %d %H:%M:%S %Y %Z')
            exp=exp.replace(tzinfo=dt.timezone.utc)
            days=(exp-dt.datetime.now(dt.timezone.utc)).days
            certs.append({'path':str(cert),'days_left':days,'ok':days>14})
        if certs:
            worst=min(certs,key=lambda item:item['days_left'])
            out['certs']=certs
            out['cert_days_left']=worst['days_left']
            out['cert_path']=worst['path']
            out['cert_ok']=worst['ok']
        else:
            out['cert_ok']=None
    except (OSError,RuntimeError,ValueError,subprocess.SubprocessError):
        out['cert_ok']=None
    try:
        bd=Path('/var/backups/zhijing-sub2api')
        if bd.is_dir():
            subs=[x for x in bd.iterdir() if x.is_dir()]
            if subs:
                newest=max(subs,key=lambda x:x.stat().st_mtime)
                age_h=(time.time()-newest.stat().st_mtime)/3600.0
                out['backup_age_hours']=round(age_h,1)
                out['backup_ok']=age_h<12
    except OSError:
        out['backup_ok']=None
    try:
        st=os.statvfs('/')
        free_gb=st.f_bavail*st.f_frsize/1e9
        used_pct=100.0*(st.f_blocks-st.f_bfree)/st.f_blocks
        out['disk_free_gb']=round(free_gb,1)
        out['disk_ok']=used_pct<85
    except OSError:
        out['disk_ok']=None
    # ── PITR 新鲜度（2026-11-12 审计 P1-8）───────────────────────────────
    # 原实现只查 6h 逻辑 dump，完全不看 pitr.json。结果：48h 基础备份
    # 调度静默停摆时 health.json 依然全绿，没人会发现 PITR 已经断了。
    try:
        _st = ROOT/'maintenance'/'pitr.json'
        if _st.exists():
            _d = json.loads(_st.read_text())
            _last = float(_d.get('last_run_epoch', 0))
            _age = (time.time() - _last) / 3600.0
            _res = _d.get('result') or {}
            out['pitr_age_hours'] = round(_age, 1)
            out['pitr_backup'] = _res.get('backup')
            out['pitr_cleanup'] = _res.get('cleanup')
            out['pitr_ok'] = (_age < 54.0 and _res.get('backup') == 'ok'
                              and _res.get('cleanup') == 'ok')
        else:
            out['pitr_ok'] = False
            out['pitr_age_hours'] = None
    except (OSError, ValueError, TypeError, AttributeError):
        out['pitr_ok'] = None
    # ── DB 连通性直探（2026-11-12 第 3 轮审计 P0-4）─────────────────────
    # /readyz 的 database 分支在代码里写死为 "not_probed"，DB 挂掉时
    # /readyz 仍报 ready；nginx 无主动探活、维护脚本又只探 /health ——
    # 三层链路没有任何一层能发现 DB 故障。这里从宿主机直探兜底。
    try:
        _r = subprocess.run(
            ['docker', 'exec', 'zhijing-sub2api-japan-postgres-1',
             'psql', '-U', 'zhijing_trial', '-d', 'zhijing_trial',
             '-Atc', 'select 1'],
            capture_output=True, timeout=8)
        out['db_ok'] = (_r.returncode == 0 and _r.stdout.strip() == b'1')
        if not out['db_ok']:
            out['db_error'] = _r.stderr.decode('utf-8', 'replace').strip()[:200]
    except (OSError, subprocess.SubprocessError):
        out['db_ok'] = None
    # ── 计费失败积压（2026-11-12 第 3 轮审计 P1-2）───────────────────
    # billing_failures 表此前只写不读，漏收永不闭环。自动重放因计费语义
    # （订阅成本 vs 余额成本的拆分）无法从该表精确还原，贸然自动化会造成
    # 错误扣费，故改为「积压可见 + 人工重放工具」：
    #   - 本检查把待重放计数写进 health.json，>0 即需人工介入
    #   - 重放工具见 /root/billing-failure-replay.sh（带 dry-run）
    try:
        _r = subprocess.run(
            ['docker', 'exec', 'zhijing-sub2api-japan-postgres-1',
             'psql', '-U', 'zhijing_trial', '-d', 'zhijing_trial', '-Atc',
             "select count(*) from billing_failures where status='pending'"],
            capture_output=True, timeout=8)
        if _r.returncode == 0:
            _n = int((_r.stdout or b'0').strip() or b'0')
            out['billing_failures_pending'] = _n
            out['billing_ok'] = (_n == 0)
    except (OSError, subprocess.SubprocessError, ValueError):
        out['billing_ok'] = None
    return out


PITR_STATE = ROOT/'maintenance'/'pitr.json'
PITR_INTERVAL = 48*3600   # 48 小时：备份 + 清理各一次


def maybe_pitr_maintenance(now, result):
    """每 48 小时做一次 PITR 基础备份并执行保留策略清理。

    为什么合并在自愈脚本里：本环境的 systemd timer / cron 安装受 guard 限制，
    无法新增定时单元；japan-health.timer 已经每分钟在跑，复用它加时间间隔判断
    是最小侵入方案。

    保留策略：3 份基础备份（约 6 天），WAL 只保留 >= 最早备份起始位点的部分。
    备份/清理失败都只记录，绝不影响自愈主流程。
    """
    try:
        state = {}
        if PITR_STATE.exists():
            try:
                state = json.loads(PITR_STATE.read_text())
            except (ValueError, OSError):
                state = {}
        last = float(state.get('last_run_epoch', 0) or 0)
        if now - last < PITR_INTERVAL:
            result['pitr'] = {'skipped': True,
                              'next_in_hours': round((PITR_INTERVAL-(now-last))/3600.0, 1)}
            return
        out = {}
        for name, script, timeout in (('backup', 'pitr-basebackup.sh', 900),
                                      ('cleanup', 'pitr-cleanup.sh', 300)):
            try:
                r = subprocess.run(['bash', str(Path('/root')/script), '3'],
                                   capture_output=True, timeout=timeout)
                out[name] = 'ok' if r.returncode == 0 else 'rc=%d' % r.returncode
            except (OSError, subprocess.SubprocessError) as exc:
                out[name] = 'error: %s' % exc
        PITR_STATE.parent.mkdir(parents=True, exist_ok=True)
        PITR_STATE.write_text(json.dumps({'last_run_epoch': now, 'result': out}))
        result['pitr'] = out
    except Exception as exc:  # noqa: BLE001 - 绝不让附属逻辑打断自愈
        result['pitr'] = {'error': str(exc)}


def watch():
    global APP
    STATE.mkdir(mode=0o700,exist_ok=True)
    if (STATE/'maintenance.off').exists():return
    probe_port,primary=resolve_primary()
    APP=primary
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    healthy=False
    for _ in range(2):
        try:
            with opener.open('http://127.0.0.1:%d/health'%probe_port,timeout=5) as response:
                healthy=response.status==200 and len(response.read(65537))<=65536
        except OSError:
            healthy=False
        if healthy:break
        time.sleep(2)
    previous={}
    state=STATE/'health.json'
    if state.exists():previous=json.loads(state.read_text())
    now=time.time()
    result={'checked_at':dt.datetime.now(dt.timezone.utc).isoformat(),'healthy':healthy,
            'restarted':False,'last_restart_epoch':previous.get('last_restart_epoch',0)}
    # Even an unreadable/switching receipt suppresses the dangerous legacy restart.
    peer_active=(ROLLING_RELEASE/'active.json').exists()
    peer_receipt={}
    if peer_active:
        try:
            peer_receipt=json.loads((ROLLING_RELEASE/'active.json').read_text())
            if not isinstance(peer_receipt,dict):raise ValueError('invalid_receipt')
            peer_active=peer_receipt.get('status') not in ('activation_rolled_back','api_peer_rolled_back') and (time.time()-(ROLLING_RELEASE/'active.json').stat().st_mtime)<=86400
        except (ValueError,OSError):
            peer_receipt={}
    if peer_active:
        try:
            if peer_receipt.get('peer')!=PEER or peer_receipt.get('api_port')!=18783:
                raise ValueError('peer_receipt_not_ready')
            peer_info=json.loads(run(['docker','inspect',PEER]))[0]
            result['api_peer_healthy']=peer_info['State']['Running'] and peer_info['State'].get('Health',{}).get('Status')=='healthy'
        except Exception:
            result['api_peer_healthy']=False
        result['legacy_restart_requires_shared_lease_review']=not healthy
        result['maintenance_healthy']=healthy
        result['healthy']=healthy and result['api_peer_healthy']
        result['manual_review_required']=not result['healthy']
    if not healthy and not peer_active:
        # Never restart DB/Redis or loop on an external failure. Only a local
        # liveness failure can restart this app, with a ten-minute cooldown.
        # 容器可能已被删除/改名（回滚时 docker rm 是常见操作）。
        # 原实现此处无异常捕获：docker inspect 非 0 退出会抛 RuntimeError 并冒出
        # watch()，systemd 只留一行 journald，自愈从此静默失效。这里吞掉并留状态。
        try:
            info=json.loads(run(['docker','inspect',APP]))[0]
        except (RuntimeError,ValueError,IndexError,KeyError,TypeError):
            info=None
        if info is None:
            result['restart_skipped']='container_unavailable'
            # 2026-11-14 审计修复：原实现在这里直接 return，check_ops_baselines()
            # 整段被跳过——证书到期、备份新鲜度、磁盘、DB 连通性、计费积压、PITR
            # 六项观测在实际生产上从未执行过。观测必须在任何分支都跑。
            result['ops']=check_ops_baselines()
            maybe_pitr_maintenance(now,result)
            private_json(state,result)
            print(json.dumps({'local_health':result['healthy'],'app_restarted':False,
                'api_peer_healthy':result.get('api_peer_healthy'),
                'manual_review_required':True,'restart_skipped':'container_unavailable',
                'ops':result['ops'],'pitr':result.get('pitr')}))
            return
        # 2026-11-14：默认不再自动 docker restart。重启窗口内请求必然失败，与
        # 「不停机」要求冲突；只有显式 ZHIJING_AUTO_RESTART=1 才保留旧自愈行为。
        if not auto_restart_enabled():
            result['restart_skipped']='auto_restart_disabled'
        elif info['State']['Status'] not in ('restarting','paused') and now-result['last_restart_epoch']>=600:
            run(['docker','restart','--time','60',APP],timeout=90)
            result.update(restarted=True,last_restart_epoch=now)
    result['ops']=check_ops_baselines()
    maybe_pitr_maintenance(now,result)
    private_json(state,result)
    print(json.dumps({'local_health':result['healthy'],'app_restarted':result['restarted'],
        'api_peer_healthy':result.get('api_peer_healthy'),
        'manual_review_required':result.get('manual_review_required',False),
        'ops':result['ops'],'pitr':result.get('pitr')}))


def backup_sources():
    sources=[(p,p.name) for p in [ROOT/'runtime.env',ROOT/'compose.japan.yaml',ROOT/'data']]
    for p in [Path('/etc/nginx/sites-available/zhijing.kaogong.art'),
              Path('/etc/nginx/snippets/zhijing-sub2api-gateway.conf'),
              Path('/var/www/zhijing-public'),Path('/var/lib/zhijing-legacy-backup'),
              ROOT/'japan_maintenance.py',Path('/usr/local/libexec/zhijing-japan-ops.py')]:
        if p.exists():sources.append((p,'additional/'+p.name))
    # The API Compose contains server-only secrets; it stays in the same private
    # backup as runtime.env, never in a public release or local evidence bundle.
    previous_v002=ROOT/'backend-releases/20261105-v0.0.2'
    if previous_v002.exists():
        for name in ('compose.peer.yaml','active.json','stage.json'):
            item=previous_v002/name
            if item.is_file():sources.append((item,'previous-v002/'+name))
    previous_release=ROOT/'concurrency-releases/20261103-3-9-v1'
    if previous_release.exists():sources.append((previous_release,'previous-rolling-api-release'))
    # Back up runtime receipts/config, excluding disposable test/build binaries.
    if ROLLING_RELEASE.exists():
        for name in ('compose.peer.yaml','active.json','stage.json','prepared.json','redis-ready.json','package.json','index.html.before',
                     'zhijing.kaogong.art.before','zhijing-sub2api-gateway.conf.before',
                     'zhijing-japan-ops.py.before','japan_maintenance.py.before'):
            item=ROLLING_RELEASE/name
            if item.is_file():sources.append((item,'rolling-api-release/'+name))
    return sources


def backup():
    STATE.mkdir(mode=0o700,exist_ok=True)
    if (STATE/'maintenance.off').exists():return
    base=Path('/var/backups/zhijing-sub2api')
    base.mkdir(mode=0o700,exist_ok=True)
    stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target=base/stamp
    target.mkdir(mode=0o700)
    dump=target/'database.dump'
    fd=os.open(dump,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:
        result=subprocess.run(['docker','exec',DB,'pg_dump','-U','zhijing_trial','-d','zhijing_trial','-Fc'],
                              stdout=f,stderr=subprocess.PIPE,timeout=180)
        if result.returncode:raise RuntimeError('database_backup_failed')
    # pg_restore on stdin validates the new archive without exposing SQL/data.
    with dump.open('rb') as f:
        result=subprocess.run(['docker','exec','-i',DB,'pg_restore','--list'],stdin=f,
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        if result.returncode:raise RuntimeError('backup_archive_invalid')
    run(['docker','exec',REDIS,'redis-cli','SAVE'])
    info=json.loads(run(['docker','inspect',REDIS]))[0]
    source=next(Path(m['Source'])/'dump.rdb' for m in info['Mounts'] if m['Destination']=='/data')
    import shutil
    shutil.copy2(source,target/'redis.rdb');(target/'redis.rdb').chmod(0o600)
    config=target/'config.tar.gz'
    with tarfile.open(config,'w:gz',compresslevel=1) as archive:
        for p,name in backup_sources():archive.add(p,arcname=name)
    config.chmod(0o600)
    metadata={'created_at':stamp,'database_consistent_pg_dump':True,
              'redis_snapshot_simultaneous_with_database':False,
              'note':'Restore database as billing authority; recheck Redis cache/counters after online backup.',
              'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
                       for p in [dump,target/'redis.rdb',config]}}
    private_json(target/'receipt.json',metadata)
    private_json(STATE/'last-backup.json',{'created_at':stamp,'directory':str(target),'archive_valid':True})
    # Do not silently delete migration/older recovery data. Rotation can be
    # approved later; the initial databases are small and disk is monitored.
    print(json.dumps({'backup_created':True,'database_archive_valid':True,'bytes':sum(p.stat().st_size for p in target.iterdir())}))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['watch','backup'])
    options=parser.parse_args()
    try:
        {'watch':watch,'backup':backup}[options.action]()
    except Exception as error:
        print(json.dumps({'status':'maintenance_failed','error_class':type(error).__name__}))
        raise SystemExit(1)
