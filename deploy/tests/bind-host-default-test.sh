#!/bin/sh
# The published host port must default to loopback so a stock deployment does
# not expose the gateway on every host interface. Exposing it stays possible,
# but an operator has to opt in with an explicit BIND_HOST.
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

is_loopback() {
  case $1 in
    127.*) return 0 ;;
    "[::1]"|::1) return 0 ;;
  esac
  return 1
}

published_entries() {
  awk '
    $0 ~ /^[[:space:]]*ports:[[:space:]]*$/ {
      in_ports = 1
      next
    }
    in_ports && $0 ~ /^[[:space:]]+-[[:space:]]*/ {
      line = $0
      sub(/^[[:space:]]+-[[:space:]]*/, "", line)
      gsub(/"/, "", line)
      print line
      next
    }
    in_ports { in_ports = 0 }
  ' "$1"
}

check_compose_default_bind() {
  compose_file=$1
  entries=$(published_entries "$compose_file")
  [ -n "$entries" ] || fail "$compose_file publishes no host port, so its BIND_HOST default is unchecked"

  count=$(printf '%s\n' "$entries" | wc -l | tr -d ' ')
  [ "$count" -eq 1 ] || fail "$compose_file must publish exactly one host port through BIND_HOST, found $count: $entries"

  case $entries in
    '${BIND_HOST:-'*'}:'*) ;;
    *) fail "$compose_file must take the published host address from \${BIND_HOST:-...}, found: $entries" ;;
  esac

  default=${entries#\$\{BIND_HOST:-}
  default=${default%%\}*}
  is_loopback "$default" || \
    fail "$compose_file defaults the published address to $default; it must default to a loopback address such as 127.0.0.1"
}

for compose_file in \
  deploy/docker-compose.yml \
  deploy/docker-compose.local.yml \
  deploy/docker-compose.standalone.yml \
  deploy/docker-compose.dev.yml
do
  check_compose_default_bind "$compose_file"
done

template_bind=$(sed -n 's/^BIND_HOST=//p' deploy/.env.example)
[ -n "$template_bind" ] || fail "deploy/.env.example must set BIND_HOST"
is_loopback "$template_bind" || \
  fail "deploy/.env.example sets BIND_HOST=$template_bind; the template must ship a loopback default and leave exposure to an explicit opt-in"

script_default=$(sed -n 's/.*read_env_value BIND_HOST \([^)"]*\).*/\1/p' deploy/apple-container.sh)
[ -n "$script_default" ] || fail "deploy/apple-container.sh must read BIND_HOST with an explicit fallback"
is_loopback "$script_default" || \
  fail "deploy/apple-container.sh falls back to BIND_HOST=$script_default; the fallback must be a loopback address"

printf 'bind host default test passed\n'
