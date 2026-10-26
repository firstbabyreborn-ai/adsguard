#!/usr/bin/env bash
# One-command deploy to Fly.io. Run: bash deploy.sh
set -euo pipefail

need() { command -v "$1" >/dev/null || { echo "Missing: $1 — $2"; exit 1; }; }
need fly "install: curl -L https://fly.io/install.sh | sh"
need node "install Node 20+"

echo "==> 1/6 checking secrets"
for v in SHOPIFY_API_KEY SHOPIFY_API_SECRET APP_URL; do
  [[ -z "${!v:-}" ]] && { echo "Set $v first (export $v=...)"; exit 1; }
done
[[ "$APP_URL" == https://* ]] || { echo "APP_URL must start with https://"; exit 1; }

echo "==> 2/6 tests"
node --test test/ | tail -3

echo "==> 3/6 app + database"
if ! fly apps list | grep -q '^adsguard'; then
  fly launch --no-deploy --name adsguard --region sin --copy-config
fi
if ! fly postgres list 2>/dev/null | grep -q adsguard-db; then
  fly postgres create --name adsguard-db --region sin --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1
  fly postgres attach adsguard-db --app adsguard
fi

echo "==> 4/6 secrets"
fly secrets set \
  SHOPIFY_API_KEY="$SHOPIFY_API_KEY" \
  SHOPIFY_API_SECRET="$SHOPIFY_API_SECRET" \
  APP_URL="$APP_URL" \
  NODE_ENV=production \
  STORAGE_DRIVER=pg \
  ${RESEND_API_KEY:+RESEND_API_KEY=$RESEND_API_KEY} \
  ${ALERT_FROM:+ALERT_FROM=$ALERT_FROM} \
  ${CRON_SECRET:+CRON_SECRET=$CRON_SECRET}

echo "==> 5/6 deploy"
fly deploy

echo "==> 6/6 verify"
sleep 5
curl -fsS "${APP_URL%/}/healthz" | tee /dev/stderr | grep -q '"ok": true' && echo "healthz OK"
echo
echo "LIVE:      $APP_URL"
echo "Dashboard: $APP_URL/app"
echo "Install:   $APP_URL/auth?shop=YOUR-STORE.myshopify.com"
echo
echo "Next: Shopify Partner dashboard → App setup →"
echo "  App URL                  $APP_URL/app"
echo "  Allowed redirection URL  $APP_URL/auth/callback"
