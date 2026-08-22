#!/bin/sh
set -eu

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="/root/email-campaign-predeploy-${stamp}"
mkdir -p "$backup_dir"
cp -a /etc/caddy/Caddyfile "$backup_dir/Caddyfile"
tar -C /var/www/sambhavbuilds -czf "$backup_dir/portfolio-dist.tar.gz" dist
chmod 700 "$backup_dir"

if ! swapon --show=NAME --noheadings | grep -qx '/swapfile'; then
  if [ ! -e /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
fi
if ! grep -q '^/swapfile[[:space:]]' /etc/fstab; then
  printf '%s\n' '/swapfile none swap sw 0 0' >>/etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y docker.io docker-compose-v2
systemctl enable --now docker

install -d -m 0750 /opt/email-campaign

printf 'backup_dir=%s\n' "$backup_dir"
printf 'swap_bytes=%s\n' "$(swapon --show=SIZE --bytes --noheadings | awk '{sum += $1} END {print sum + 0}')"
docker --version
docker compose version
