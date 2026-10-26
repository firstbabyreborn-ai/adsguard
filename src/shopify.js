/**
 * Shopify plumbing: OAuth, session tokens, HMAC, webhooks, Billing.
 *
 * Three decisions worth knowing:
 *  1. Embedded apps authenticate with App Bridge **session tokens** (HS256 JWT),
 *     not cookies. Cookie auth in an iframe is broken by third-party cookie
 *     policy and is rejected in App Store review.
 *  2. HMAC comparison is timing-safe and shop domains are validated against the
 *     myshopify pattern (open-redirect / SSRF protection).
 *  3. Billing is capped and incident-based. Billing is the #1 source of 1-star
 *     reviews in this category (23%); being provably fair is a growth channel.
 */
import crypto from 'node:crypto';
import config from './config.js';

export const COMPLIANCE_TOPICS = ['CUSTOMERS_DATA_REQUEST', 'CUSTOMERS_REDACT', 'SHOP_REDACT'];
export const APP_TOPICS = ['APP_UNINSTALLED', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE', 'INVENTORY_LEVELS_UPDATE', 'ORDERS_CREATE'];

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function isValidShopDomain(shop) {
  return typeof shop === 'string' && shop.length <= 255 && SHOP_RE.test(shop);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* --------------------------------- OAuth -------------------------------- */

export function buildAuthUrl({ shop, state }) {
  if (!isValidShopDomain(shop)) throw new Error('invalid_shop_domain');
  const p = new URLSearchParams({
    client_id: config.shopify.apiKey,
    scope: config.shopify.scopes,
    redirect_uri: `${config.appUrl}/auth/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${p.toString()}`;
}

export function verifyOAuthHmac(rawQuery) {
  const params = Object.fromEntries(new URLSearchParams(rawQuery || '').entries());
  const received = params.hmac;
  if (!received) return false;
  delete params.hmac;
  delete params.signature;
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const digest = crypto.createHmac('sha256', config.shopify.apiSecret).update(message).digest('hex');
  return safeEqual(digest, received);
}

/** Webhooks: base64 HMAC of the raw body in a header. */
export function verifyWebhookHmac(rawBody, headerHmac) {
  if (!headerHmac) return false;
  const digest = crypto.createHmac('sha256', config.shopify.apiSecret).update(rawBody).digest('base64');
  return safeEqual(digest, headerHmac);
}

export async function exchangeToken({ shop, code }) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: config.shopify.apiKey, client_secret: config.shopify.apiSecret, code }),
  });
  if (!res.ok) throw new Error(`token_exchange_failed_${res.status}`);
  return res.json();
}

/* ----------------------------- Session tokens ---------------------------- */

/**
 * Verify an App Bridge session token.
 * Returns the decoded payload or null. Never throws — callers treat null as 401.
 */
export function verifySessionToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;

    const expected = crypto
      .createHmac('sha256', config.shopify.apiSecret)
      .update(`${h}.${p}`)
      .digest('base64url');
    if (!safeEqual(expected, sig)) return null;

    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return null;

    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > now + 5) return null;

    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
    if (config.shopify.apiKey && aud.length && !aud.includes(config.shopify.apiKey)) return null;

    const dest = String(payload.dest || '').replace(/^https:\/\//, '');
    if (dest && !isValidShopDomain(dest)) return null;

    return { shop: dest || null, payload };
  } catch {
    return null;
  }
}

/* -------------------------------- GraphQL -------------------------------- */

export async function graphql(shop, accessToken, query, variables = {}) {
  const res = await fetch(
    `https://${shop}/admin/api/${config.shopify.apiVersion}/graphql.json`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': accessToken },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!res.ok) throw new Error(`graphql_${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

/* -------------------------------- Webhooks ------------------------------- */

export async function registerWebhooks(shop, accessToken) {
  const topics = [...APP_TOPICS, ...COMPLIANCE_TOPICS];
  const results = [];
  for (const topic of topics) {
    try {
      const data = await graphql(
        shop,
        accessToken,
        `mutation hook($topic: WebhookSubscriptionTopic!, $url: URL!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
            webhookSubscription { id }
            userErrors { field message }
          }
        }`,
        { topic, url: `${config.appUrl}/webhooks` },
      );
      results.push({ topic, ok: !data.webhookSubscriptionCreate.userErrors.length });
    } catch (err) {
      results.push({ topic, ok: false, error: err.message });
    }
  }
  return results;
}

/* -------------------------------- Billing -------------------------------- */

export const PRICING = {
  plans: {
    free: { price: 0, watchpoints: 1, intervalMins: 60, channels: ['email'] },
    starter: { price: 19, watchpoints: 15, intervalMins: 10, channels: ['email', 'slack'] },
    growth: { price: 49, watchpoints: 60, intervalMins: 5, channels: ['email', 'slack', 'sms'] },
  },
  /** Hard ceiling. Nothing above this can ever be charged. */
  maxMonthly: 49,
  /** No charge for checks — only for incidents actually caught. */
  incidentOnlyBilling: true,
};

export async function createRecurringCharge(shop, accessToken, { plan, returnUrl, trialDays = 14, test = config.env !== 'production' }) {
  const spec = PRICING.plans[plan];
  if (!spec) throw new Error('unknown_plan');
  const data = await graphql(
    shop,
    accessToken,
    `mutation appSubscriptionCreate(
      $name: String!, $lineItems: [AppSubscriptionLineItemInput]!,
      $returnUrl: URL!, $trialDays: Int!, $test: Boolean
    ) {
      appSubscriptionCreate(
        name: $name, returnUrl: $returnUrl, trialDays: $trialDays,
        lineItems: $lineItems, test: $test
      ) {
        confirmationUrl
        appSubscription { id }
        userErrors { field message }
      }
    }`,
    {
      name: `AdsGuard ${plan}`,
      returnUrl,
      trialDays,
      test,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: spec.price, currencyCode: 'USD' },
              interval: 'EVERY_30_DAYS',
            },
          },
        },
      ],
    },
  );
  return data.appSubscriptionCreate;
}

export default {
  COMPLIANCE_TOPICS,
  APP_TOPICS,
  isValidShopDomain,
  buildAuthUrl,
  verifyOAuthHmac,
  verifyWebhookHmac,
  verifySessionToken,
  signFormToken,
  verifyFormToken,
  exchangeToken,
  graphql,
  registerWebhooks,
  createRecurringCharge,
  PRICING,
};

/* ------------------------- form CSRF (no JS needed) ------------------------ */

/**
 * Server-rendered forms cannot send an Authorization header from inside an
 * iframe without client JS, so we bind each form post to the shop with a
 * short-lived HMAC token. Stateless: nothing to store, nothing to leak.
 */
export function signFormToken(shop, ttlMinutes = 30) {
  if (!isValidShopDomain(shop)) throw new Error('invalid_shop_domain');
  const ts = Date.now();
  const mac = crypto
    .createHmac('sha256', config.shopify.apiSecret || 'dev')
    .update(`${shop}:${ts}`)
    .digest('base64url');
  return `${ts}.${mac}`;
}

export function verifyFormToken(shop, token, ttlMinutes = 30) {
  try {
    if (!isValidShopDomain(shop) || typeof token !== 'string') return false;
    const [rawTs, mac] = token.split('.');
    const ts = Number(rawTs);
    if (!Number.isFinite(ts)) return false;
    if (Math.abs(Date.now() - ts) > ttlMinutes * 60_000) return false;
    const expected = crypto
      .createHmac('sha256', config.shopify.apiSecret || 'dev')
      .update(`${shop}:${ts}`)
      .digest('base64url');
    return safeEqual(expected, mac);
  } catch {
    return false;
  }
}
