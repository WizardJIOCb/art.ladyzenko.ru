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

install -d -m 755 "$base/releases" "$base/acme/.well-known/acme-challenge" "$release"
if [[ -f "$release/REVISION" ]]; then
    echo 'Release already exists; use its verified content'
else
    tar -xzf "$archive" -C "$release"
    printf '%s\n' "$revision" > "$release/REVISION"
fi
test -f "$release/public/index.html"
test -f "$release/public/new/index.html"
chmod -R u=rwX,go=rX "$release"
ln -s "$release/public" "$base/current.$stamp"
mv -Tf "$base/current.$stamp" "$base/current"

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
}
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
    actual=$(curl --fail --silent --show-error --max-time 20 "http://art.ladyzenko.ru/.well-known/acme-challenge/$challenge")
    [[ "$actual" == "$revision" ]] || { echo 'Public ACME path failed'; exit 1; }
    certbot certonly --webroot -w "$base/acme" --cert-name art.ladyzenko.ru -d art.ladyzenko.ru --non-interactive --agree-tos
fi
activate_config "$release/deploy/nginx.conf"
curl --fail --silent --show-error --max-time 20 https://art.ladyzenko.ru/ -o /dev/null
curl --fail --silent --show-error --max-time 20 https://art.ladyzenko.ru/new/ -o /dev/null
printf 'DEPLOYED %s\nBACKUP %s\n' "$revision" "$backup"
