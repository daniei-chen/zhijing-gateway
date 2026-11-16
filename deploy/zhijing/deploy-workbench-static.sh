#!/usr/bin/env bash
# Publish the /app-assets workbench build without replacing the public homepage.
#
# Assets are copied first and the HTML entry is replaced last. Existing hashed
# assets are intentionally retained so sessions that still hold the previous
# index do not fail during rollout.
set -Eeuo pipefail

: "${DIST:?set DIST to the directory containing an index.html built with --base=/app-assets/}"

TARGET="${TARGET:-/var/www/zhijing-workbench}"
PUBLIC_HOST="${PUBLIC_HOST:-zhijing.kaogong.art}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/zhijing-frontend-backups}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

test -f "${DIST}/index.html" || die "missing ${DIST}/index.html"
test -f "${TARGET}/index.html" || die "workbench target not found: ${TARGET}"
grep -q '/app-assets/' "${DIST}/index.html" || die "index.html does not reference /app-assets/"
if grep -Eq 'src="/assets/|href="/assets/' "${DIST}/index.html"; then
  die "index.html still references the homepage /assets namespace"
fi

# Vite --base=/app-assets/ emits URLs like /app-assets/assets/index-*.js.
# Nginx maps /app-assets/ below TARGET, so the build's assets directory belongs
# at TARGET/app-assets/assets.
if test -d "${DIST}/app-assets"; then
  asset_source="${DIST}/app-assets"
  asset_destination="${TARGET}/app-assets"
elif test -d "${DIST}/assets"; then
  asset_source="${DIST}/assets"
  asset_destination="${TARGET}/app-assets/assets"
else
  die "missing built assets directory (expected ${DIST}/assets)"
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="${BACKUP_ROOT}/${stamp}"
mkdir -p "$backup"
cp -a "${TARGET}/index.html" "${backup}/index.html"
cp -a "${TARGET}/logo.svg" "${backup}/logo.svg" 2>/dev/null || true
find "${TARGET}/app-assets" -type f -printf '%P\n' | sort >"${backup}/assets-before.txt"

published=false
restore_index_on_failure() {
  status=$?
  if (( status != 0 )) && [[ "$published" == true ]]; then
    restore_tmp="${TARGET}/.index.html.restore"
    cp -a "${backup}/index.html" "$restore_tmp"
    chown --reference="${TARGET}/index.html" "$restore_tmp" 2>/dev/null || true
    mv -f "$restore_tmp" "${TARGET}/index.html"
    printf 'ROLLED BACK: previous workbench index restored from %s\n' "$backup" >&2
  fi
  exit "$status"
}
trap restore_index_on_failure EXIT

# New hashed assets become available before any HTML can reference them.
mkdir -p "$asset_destination"
cp -a "${asset_source}/." "${asset_destination}/"
if test -f "${DIST}/logo.svg"; then
  cp -a "${DIST}/logo.svg" "${TARGET}/.logo.svg.next"
  chmod --reference="${TARGET}/logo.svg" "${TARGET}/.logo.svg.next" 2>/dev/null || true
  mv -f "${TARGET}/.logo.svg.next" "${TARGET}/logo.svg"
  cp -a "${DIST}/logo.svg" "${TARGET}/app-assets/.logo.svg.next"
  chmod --reference="${TARGET}/logo.svg" "${TARGET}/app-assets/.logo.svg.next" 2>/dev/null || true
  mv -f "${TARGET}/app-assets/.logo.svg.next" "${TARGET}/app-assets/logo.svg"
fi

# Every /app-assets URL in the entry HTML must already exist relative to the
# nginx root before the new index becomes visible.
while IFS= read -r entry_url; do
  relative=${entry_url#/app-assets/}
  test -f "${TARGET}/app-assets/${relative}" || \
    die "index references missing workbench asset: ${entry_url}"
done < <(grep -oE '/app-assets/[^"]+' "${DIST}/index.html" | sort -u)

index_tmp="${TARGET}/.index.html.next"
cp "${DIST}/index.html" "$index_tmp"
chmod --reference="${TARGET}/index.html" "$index_tmp" 2>/dev/null || chmod 0644 "$index_tmp"
chown --reference="${TARGET}/index.html" "$index_tmp" 2>/dev/null || true
mv -f "$index_tmp" "${TARGET}/index.html"
published=true

new_entry=$(grep -oE '/app-assets/[^"]+\.js' "${TARGET}/index.html" | head -1)
test -n "$new_entry" || die "new index has no workbench entry asset"
asset_status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  --resolve "${PUBLIC_HOST}:443:127.0.0.1" "https://${PUBLIC_HOST}${new_entry}")
test "$asset_status" = "200" || die "new workbench asset returned HTTP ${asset_status}"

login_html=$(curl -fsS --max-time 10 --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
  "https://${PUBLIC_HOST}/login")
case "$login_html" in
  *"<div id=\"app\"></div>"*) ;;
  *) die "login page is incomplete after workbench deployment" ;;
esac

printf 'workbench_deployed stamp=%s backup=%s entry=%s\n' "$stamp" "$backup" "$new_entry"
