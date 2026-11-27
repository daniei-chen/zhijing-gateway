#!/bin/sh
# 阶段一文档必须与仓库实际状态一致：文档说「已落地」的每一条，都要能在仓库里核到；
# 文档不能把已落地的条目再写成 pending，也不能提前宣称已经回灌。
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

doc=docs/security/2026-11-27-phase1-hardening.md

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

[ -f "$doc" ] || fail "missing ${doc}"

# 1. 发布端口默认回环
for compose_file in \
  deploy/docker-compose.yml \
  deploy/docker-compose.local.yml \
  deploy/docker-compose.standalone.yml \
  deploy/docker-compose.dev.yml
do
  grep -Fq '${BIND_HOST:-127.0.0.1}' "$compose_file" || \
    fail "${compose_file} no longer defaults the published port to loopback"
done
grep -qx 'BIND_HOST=127.0.0.1' deploy/.env.example || \
  fail "deploy/.env.example no longer ships BIND_HOST=127.0.0.1"

# 2. 转发头信任默认 false，迁移只告警不回翻
grep -Fq 'viper.SetDefault("security.trust_forwarded_ip_for_api_key_acl", false)' \
  backend/internal/config/config.go || \
  fail "security.trust_forwarded_ip_for_api_key_acl no longer defaults to false"
grep -Fq 'stored value is' backend/internal/service/setting_service.go || \
  fail "setting_service.go no longer documents the stored-value-authoritative migration"

# 3. setup 只绑回环 + 一次性 token
grep -Fq 'setupWizardDefaultHost = "127.0.0.1"' backend/internal/config/config.go || \
  fail "the setup wizard no longer defaults to loopback"
grep -Fq 'func GetSetupServerAddress()' backend/internal/config/config.go || \
  fail "GetSetupServerAddress is missing"
[ -f backend/internal/setup/token.go ] || fail "backend/internal/setup/token.go is missing"
grep -Fq 'X-Setup-Token' backend/internal/setup/token.go || \
  fail "the setup token header is missing"

# 4. CI race job
grep -Eq '^  race:$' .github/workflows/backend-ci.yml || fail "backend-ci.yml has no race job"
grep -Fq 'make test-race' .github/workflows/backend-ci.yml || fail "the race job does not run make test-race"

# 5. /admin/system/update 应用层硬门
grep -Fq 'viper.SetDefault("security.admin_system_update.enabled", false)' \
  backend/internal/config/config.go || \
  fail "security.admin_system_update.enabled no longer defaults to false"
[ -f backend/internal/server/middleware/admin_system_update_gate.go ] || \
  fail "admin_system_update_gate.go is missing"
grep -Fq 'UpdateGate()' backend/internal/server/routes/admin.go || \
  fail "registerSystemRoutes no longer wires the update gate"

# 6. 源站 403 清单与校验脚本
[ -f deploy/zhijing/nginx/zhijing.origin.deny.conf ] || \
  fail "the origin deny template is missing"
[ -f deploy/zhijing/verify-sensitive-endpoints.sh ] || \
  fail "verify-sensitive-endpoints.sh is missing"
grep -Fq 'restore_previous_upstream' deploy/zhijing/zero-downtime-deploy.sh || \
  fail "zero-downtime-deploy.sh no longer rolls back on a failed sensitive-endpoint check"

# 文档本身的三条纪律
if grep -n 'pending' "$doc"; then
  fail "${doc} still marks landed work as pending"
fi
if grep -n '已回灌' "$doc"; then
  fail "${doc} claims a backport that was not decided"
fi
grep -Fq '## 上游回灌' "$doc" || fail "${doc} has no upstream backport section"
grep -Fq '本地扩展' "$doc" || fail "${doc} does not mark the deny template as local-only"

# 本仓库的提交必须给完整 40 位: 7-39 位且含字母的十六进制串会让 --match-head-commit 匹配失败。
# 提到上游的段落除外 —— 上游 sha 只能按 docs/UPSTREAM.md 记录的短形态引用，我们没有完整值。
short_shas=$(grep -v '上游' "$doc" \
  | grep -oE '\b[0-9a-f]*[a-f][0-9a-f]*\b' \
  | awk 'length($0) >= 7 && length($0) <= 39' || true)
if [ -n "$short_shas" ]; then
  printf '%s\n' "$short_shas" >&2
  fail "${doc} contains abbreviated commit ids; report full 40-character shas"
fi

printf 'phase1 hardening doc test passed\n'
