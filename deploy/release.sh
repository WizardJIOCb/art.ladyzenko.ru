#!/usr/bin/env bash
set -euo pipefail

revision=${1:?Usage: release.sh COMMIT_SHA ARCHIVE_PATH}
archive=${2:?Archive required}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit'; exit 1; }
base=/var/www/art.ladyzenko.ru
config=/etc/nginx/sites-available/art.ladyzenko.ru.conf
enabled=/etc/nginx/sites-enabled/art.ladyzenko.ru.conf
release="$base/releases/$revision"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/var/backups/art.ladyzenko.ru/$stamp"
install -d -m 700 "$backup"
tar -czf "$backup/nginx-config.tar.gz" -C /etc/nginx nginx.conf sites-available sites-enabled conf.d
if [[ -e "$config" ]]; then cp -a "$config" "$backup/site.conf"; fi
if [[ -L "$base/current" ]]; then readlink "$base/current" > "$backup/previous-release"; fi
if [[ -L "$base/app-current" ]]; then readlink "$base/app-current" > "$backup/previous-app"; fi
if [[ -f /etc/systemd/system/art-ladyzenko-leads.service ]]; then
    cp -a /etc/systemd/system/art-ladyzenko-leads.service "$backup/leads.service"
fi
test -s /etc/art-ladyzenko-leads.json

install -d -m 755 "$base/releases" "$base/acme/.well-known/acme-challenge" "$release"
if [[ -f "$release/REVISION" ]]; then
    echo 'Release already exists; use its verified content'
else
    tar -xzf "$archive" -C "$release"
    printf '%s\n' "$revision" > "$release/REVISION"
fi
test -f "$release/public/index.html"
test -f "$release/public/new/index.html"
test -f "$release/public/new2/index.html"
test -f "$release/server/leads.py"
chmod -R u=rwX,go=rX "$release"

restore_config() {
    if [[ -f "$backup/site.conf" ]]; then
        cp -a "$backup/site.conf" "$config"
    else
        rm -f "$enabled" "$config"
    fi
    if [[ -f "$backup/previous-release" ]]; then
        ln -s "$(cat "$backup/previous-release")" "$base/rollback.$stamp"
        mv -Tf "$base/rollback.$stamp" "$base/current"
    fi
    if [[ -f "$backup/previous-app" ]]; then
        ln -s "$(cat "$backup/previous-app")" "$base/app-rollback.$stamp"
        mv -Tf "$base/app-rollback.$stamp" "$base/app-current"
        if [[ -f "$backup/leads.service" ]]; then
            cp -a "$backup/leads.service" /etc/systemd/system/art-ladyzenko-leads.service
        fi
        systemctl daemon-reload
        systemctl restart art-ladyzenko-leads.service
    else
        systemctl disable --now art-ladyzenko-leads.service || true
    fi
}

ln -s "$release" "$base/app-current.$stamp"
mv -Tf "$base/app-current.$stamp" "$base/app-current"
install -m 644 "$release/deploy/art-ladyzenko-leads.service" /etc/systemd/system/art-ladyzenko-leads.service
systemctl daemon-reload
systemctl enable art-ladyzenko-leads.service
if ! systemctl restart art-ladyzenko-leads.service; then restore_config; exit 1; fi
if ! curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 --max-time 5 http://127.0.0.1:8330/healthz; then
    restore_config
    exit 1
fi
activate_config() {
    install -m 644 "$1" "$config"
    if [[ ! -e "$enabled" ]]; then ln -s "$config" "$enabled"; fi
    if ! nginx -t; then restore_config; exit 1; fi
    if ! systemctl reload nginx; then restore_config; nginx -t && systemctl reload nginx; exit 1; fi
}

if [[ ! -f /etc/letsencrypt/live/art.ladyzenko.ru/fullchain.pem ]]; then
    activate_config "$release/deploy/bootstrap-http.conf"
    challenge="art-deploy-$revision"
    printf '%s' "$revision" > "$base/acme/.well-known/acme-challenge/$challenge"
    actual=$(curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 --max-time 20 "http://art.ladyzenko.ru/.well-known/acme-challenge/$challenge")
    [[ "$actual" == "$revision" ]] || { echo 'Public ACME path failed'; exit 1; }
    certbot certonly --webroot -w "$base/acme" --cert-name art.ladyzenko.ru -d art.ladyzenko.ru --non-interactive --agree-tos
fi
activate_config "$release/deploy/nginx.conf"
api_ready=false
for attempt in {1..20}; do
    code=$(curl --silent --output /dev/null --max-time 5 --write-out '%{http_code}' https://art.ladyzenko.ru/api/leads || true)
    if [[ "$code" == 403 ]]; then api_ready=true; break; fi
    sleep 0.25
done
if [[ "$api_ready" != true ]]; then restore_config; nginx -t && systemctl reload nginx; exit 1; fi
ln -s "$release/public" "$base/current.$stamp"
mv -Tf "$base/current.$stamp" "$base/current"
curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 --max-time 20 https://art.ladyzenko.ru/ -o /dev/null
curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 --max-time 20 https://art.ladyzenko.ru/new/ -o /dev/null
curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 --max-time 20 https://art.ladyzenko.ru/new2/ -o /dev/null
printf 'DEPLOYED %s\nBACKUP %s\n' "$revision" "$backup"
