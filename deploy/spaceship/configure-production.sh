#!/usr/bin/env bash
set -euo pipefail
umask 077

target="/opt/email-campaign/.env.prod"
if [[ -e "$target" ]]; then
  echo "Refusing to overwrite existing $target" >&2
  exit 1
fi

read -r -p "Operator login email: " operator_email
read -r -s -p "Initial application password (12+ safe characters): " operator_password
echo
read -r -s -p "Repeat initial application password: " operator_password_again
echo
if [[ "$operator_password" != "$operator_password_again" ]]; then
  echo "Passwords do not match." >&2
  exit 1
fi
if [[ ! "$operator_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Enter a valid email address." >&2
  exit 1
fi
if [[ ${#operator_password} -lt 12 || ! "$operator_password" =~ ^[A-Za-z0-9._@%+=:,/-]+$ ]]; then
  echo "Password must be 12+ characters using letters, numbers, and ._@%+=:,/- only." >&2
  exit 1
fi

read -r -p "Google OAuth client ID (leave blank to configure later): " oauth_client_id
oauth_client_secret=""
if [[ -n "$oauth_client_id" ]]; then
  read -r -s -p "Google OAuth client secret: " oauth_client_secret
  echo
fi
if [[ -n "$oauth_client_id" && -z "$oauth_client_secret" ]]; then
  echo "A client secret is required when a client ID is entered." >&2
  exit 1
fi
if [[ "$oauth_client_id" =~ [[:space:]#] || "$oauth_client_secret" =~ [[:space:]#] ]]; then
  echo "OAuth values may not contain whitespace or #." >&2
  exit 1
fi

tmp="$(mktemp /opt/email-campaign/.env.prod.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
cat >"$tmp" <<EOF
POSTGRES_USER=coldemail
POSTGRES_DB=coldemail
POSTGRES_PASSWORD=$(openssl rand -hex 32)
SECRET_KEY=$(openssl rand -hex 32)
SESSION_KEY=$(openssl rand -hex 32)
OPERATOR_EMAIL=$operator_email
OPERATOR_INITIAL_PASSWORD=$operator_password
GOOGLE_OAUTH_CLIENT_ID=$oauth_client_id
GOOGLE_OAUTH_CLIENT_SECRET=$oauth_client_secret
LOG_LEVEL=info
EOF
chmod 600 "$tmp"
mv "$tmp" "$target"
trap - EXIT
echo "Created $target with mode 600. No secret values were printed."
