#!/bin/sh
# 阶段一三条安全默认值的「部署面」看守。
#
# Go 侧的门禁锁的是二进制里的默认值；这份脚本锁的是随仓库发给运维的模板。
# 模板里一条写死的 true 就能覆盖二进制默认值，而且升级说明之外没人会注意到，
# 所以它必须和代码默认值一起被 CI 看着。
#
# 三条不变量：
#   1. security.trust_forwarded_ip_for_api_key_acl 在示例配置里是 false，
#      可信代理清单里没有「信任所有来源」的通配网段；
#   2. security.admin_system_update.enabled 在示例配置里是 false；
#   3. 任何 compose/.env 模板都不替运维把上面两条环境变量写成 true。
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

config_file=deploy/config.example.yaml
[ -f "$config_file" ] || fail "missing $config_file"

# 只取标量值：去掉行尾注释、引号和空白。
scalar_of() {
  sed -n "s/^[[:space:]]*$1:[[:space:]]*\([^#]*\).*/\1/p" "$2" \
    | tr -d "\"' \t" | head -n 1
}

# 1a. 转发头兼容开关必须显式写成 false。模板删掉这一行同样算失败：
#     没有这一行的示例配置会让人以为默认已经是安全值。
forwarded=$(scalar_of 'trust_forwarded_ip_for_api_key_acl' "$config_file")
[ -n "$forwarded" ] || \
  fail "$config_file must state security.trust_forwarded_ip_for_api_key_acl: false"
[ "$forwarded" = "false" ] || \
  fail "$config_file sets security.trust_forwarded_ip_for_api_key_acl: $forwarded; the template must keep it false (see deploy/EDGE_SECURITY.md)"

# 1b. 可信代理清单里出现通配网段等于把转发头重新变成可信来源。
if grep -Eq '^[[:space:]]*-[[:space:]]*["'"'"']?(0\.0\.0\.0/0|::/0)["'"'"']?[[:space:]]*$' "$config_file"; then
  fail "$config_file lists a trust-everything CIDR under server.trusted_proxies; forwarding headers from any peer would become authoritative"
fi

# 2. /admin/system/update 的应用层硬门默认必须是关的。
gate_enabled=$(awk '
  /^[[:space:]]*admin_system_update:[[:space:]]*$/ {
    indent = match($0, /[^ ]/)
    in_block = 1
    next
  }
  in_block {
    if ($0 ~ /^[[:space:]]*$/) next
    if (match($0, /[^ ]/) <= indent) { in_block = 0; next }
    if ($0 ~ /^[[:space:]]*enabled:[[:space:]]*/) {
      line = $0
      sub(/^[[:space:]]*enabled:[[:space:]]*/, "", line)
      sub(/[[:space:]]*#.*$/, "", line)
      gsub(/["'"'"' \t]/, "", line)
      print line
      exit
    }
  }
' "$config_file")
[ -n "$gate_enabled" ] || \
  fail "$config_file must document security.admin_system_update.enabled: false"
[ "$gate_enabled" = "false" ] || \
  fail "$config_file sets security.admin_system_update.enabled: $gate_enabled; the template must keep the endpoint closed by default (see deploy/ADMIN_SYSTEM_UPDATE.md)"

# 3. 部署模板不得替运维打开这两条开关：环境变量优先级高于文件，一个 true
#    就能同时绕过上面两条断言。
check_env_override() {
  file=$1
  name=$2
  values=$(sed -n "s/^[[:space:]]*-\{0,1\}[[:space:]]*${name}[[:space:]]*[:=][[:space:]]*[\"']\{0,1\}\([^\"' ]*\).*/\1/p" "$file")
  [ -n "$values" ] || return 0
  for value in $values; do
    [ "$value" = "false" ] || \
      fail "$file sets $name=$value; deployment templates must not turn these switches on for the operator"
  done
}

for template in \
  deploy/.env.example \
  deploy/docker-compose.yml \
  deploy/docker-compose.local.yml \
  deploy/docker-compose.standalone.yml \
  deploy/docker-compose.dev.yml
do
  [ -f "$template" ] || continue
  check_env_override "$template" SECURITY_TRUST_FORWARDED_IP_FOR_API_KEY_ACL
  check_env_override "$template" SECURITY_ADMIN_SYSTEM_UPDATE_ENABLED
done

# 4. 调用方接缝：单元测试看得见「函数返回什么」，看不见「谁在用这个函数」。
#    这里锁的是那两处装配代码，删掉它们等于把门禁和回环绑定一起摘掉。
main_go=backend/cmd/server/main.go
[ -f "$main_go" ] || fail "missing $main_go"
grep -Fq 'setupAddr := config.GetSetupServerAddress()' "$main_go" || \
  fail "$main_go must bind the setup wizard through config.GetSetupServerAddress(); a hardcoded address drops the loopback default"
if grep -Eq 'setupAddr[[:space:]]*:=[[:space:]]*config\.SetupServerAddress\{' "$main_go"; then
  fail "$main_go builds the setup address by hand instead of calling config.GetSetupServerAddress()"
fi

admin_routes=backend/internal/server/routes/admin.go
[ -f "$admin_routes" ] || fail "missing $admin_routes"
grep -Eq 'system\.POST\("/update",[[:space:]]*h\.Admin\.System\.UpdateGate\(\)' "$admin_routes" || \
  fail "$admin_routes must keep h.Admin.System.UpdateGate() on POST /api/v1/admin/system/update; without it the endpoint is back to a single admin JWT"

printf 'security invariants test passed\n'
