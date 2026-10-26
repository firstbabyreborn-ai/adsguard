/**
 * The monitoring engine.
 *
 * The product is one number: `riskPerHour` — the burn rate of a page that
 * cannot convert. Everything else here exists to make that number trustworthy.
 */
import config from './config.js';

const HOURS_PER_MONTH = 30 * 24;
export const MAX_BODY_BYTES = 512 * 1024;

/** Ad spend burning + revenue that can no longer be earned. */
export function riskPerHour(item) {
  const adBurn = (Number(item.adSpend30d) || 0) / HOURS_PER_MONTH;
  const sessionRate = (Number(item.sessions30d) || 0) / HOURS_PER_MONTH;
  const lostRevenue = sessionRate * (Number(item.conversionRate) || 0) * (Number(item.aov) || 0);
  return Number((adBurn + lostRevenue).toFixed(2));
}

/** Read at most MAX_BODY_BYTES — a merchant's product page should never OOM us. */
async function readCapped(res) {
  const reader = res.body?.getReader?.();
  if (!reader) return await res.text();
  const chunks = [];
  let size = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(decoder.decode(value, { stream: true }));
    if (size >= MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch {}
      break;
    }
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}

export async function checkHttp(item) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), config.http.timeoutMs);
  try {
    const res = await fetch(item.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': config.http.userAgent,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        kind: 'http_error',
        severity: res.status >= 500 ? 'critical' : 'warning',
        title: `HTTP ${res.status} on ${item.label}`,
        detail: `Expected 200, got ${res.status} ${res.statusText || ''}. Every paid click on this URL landed on an error page.`,
      };
    }
    return { ok: true, body: await readCapped(res) };
  } catch (err) {
    const timedOut = err?.name === 'AbortError' || /timeout/i.test(err?.message || '');
    return {
      ok: false,
      kind: timedOut ? 'timeout' : 'unreachable',
      severity: 'critical',
      title: timedOut ? `${item.label} timed out` : `${item.label} is unreachable`,
      detail: timedOut
        ? `No response within ${config.http.timeoutMs}ms. For a store, slow is the same as down — shoppers leave before the page paints.`
        : `Request failed: ${err.message}. DNS, TLS or origin failure.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function checkContent(item, body) {
  if (!item.expectText) return { ok: true };
  const has = String(body || '').toLowerCase().includes(String(item.expectText).toLowerCase());
  if (has) return { ok: true };
  return {
    ok: false,
    kind: 'content_missing',
    severity: 'critical',
    title: `"${item.expectText}" is missing from ${item.label}`,
    detail:
      'The page returns 200 but the expected content is gone. This is the failure a plain uptime check cannot see: a broken theme, an app conflict, or a redirect to the wrong template.',
  };
}

export async function fetchProductState(shopDomain, accessToken, productId) {
  const gid = String(productId).startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`;
  const query = `query ProductState($id: ID!) {
    product(id: $id) {
      id title status publishedAt totalInventory
      variants(first: 20) { nodes { id title price inventoryQuantity availableForSale } }
    }
  }`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.http.timeoutMs);
  try {
    const res = await fetch(`https://${shopDomain}/admin/api/${config.shopify.apiVersion}/graphql.json`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': accessToken },
      body: JSON.stringify({ query, variables: { id: gid } }),
    });
    if (!res.ok) throw new Error(`Admin API ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors.map((e) => e.message).join('; '));
    return json.data?.product ?? null;
  } finally {
    clearTimeout(timer);
  }
}

export function checkStock(item, product) {
  if (!product) {
    return {
      ok: false,
      kind: 'product_missing',
      severity: 'critical',
      title: `Product behind ${item.label} no longer exists`,
      detail: 'Deleted or unpublished. Links and ads now point at a dead product page.',
    };
  }
  const buyable =
    product.status === 'ACTIVE' &&
    (product.totalInventory == null || product.totalInventory > 0) &&
    (product.variants?.nodes || []).some((v) => v.availableForSale);

  if (buyable || item.expectInStock === false) return { ok: true, product };
  return {
    ok: false,
    kind: 'out_of_stock',
    severity: 'critical',
    title: `${product.title} is out of stock while you are paying for traffic`,
    detail: `totalInventory=${product.totalInventory ?? 'n/a'}, status=${product.status}. Ad clicks land on a product nobody can buy.`,
    product,
  };
}

export function checkPrice(item, product) {
  const prices = (product?.variants?.nodes || []).map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
  if (!prices.length) return { ok: true };
  const price = Math.min(...prices);
  if (!item.baselinePrice) return { ok: true, price };

  const pct = ((price - item.baselinePrice) / item.baselinePrice) * 100;
  const limit = Number(item.maxPriceChangePct ?? 15);
  if (Math.abs(pct) <= limit) return { ok: true, price };
  return {
    ok: false,
    kind: 'price_drift',
    severity: pct > 0 ? 'warning' : 'critical',
    title: `Price moved ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% on ${item.label}`,
    detail: `Baseline ${item.baselinePrice} → now ${price}. Feed, ad copy and checkout are quoting different numbers.`,
    price,
  };
}

/**
 * Run every check for one watchpoint.
 * @returns {Promise<Array>} failures (empty === healthy)
 */
export async function runChecks(shop, item) {
  const failures = [];
  const risk = riskPerHour(item);

  const http = await checkHttp(item);
  if (!http.ok) {
    failures.push({ ...http, riskPerHour: risk });
  } else {
    const content = checkContent(item, http.body);
    if (!content.ok) failures.push({ ...content, riskPerHour: risk });
  }

  if (item.productId && shop.accessToken) {
    try {
      const product = await fetchProductState(shop.domain, shop.accessToken, item.productId);
      for (const result of [checkStock(item, product), checkPrice(item, product)]) {
        if (!result.ok) failures.push({ ...result, riskPerHour: risk });
      }
      if (product && !item.baselinePrice) {
        const prices = (product.variants?.nodes || []).map((v) => Number(v.price)).filter(Boolean);
        if (prices.length) item.baselinePrice = Math.min(...prices);
      }
    } catch (err) {
      failures.push({
        ok: false,
        kind: 'api_error',
        severity: 'warning',
        title: 'Lost access to store data',
        detail: `Admin API failed: ${err.message}. Stock and price monitoring is blind until this recovers.`,
        riskPerHour: risk,
      });
    }
  }

  return failures;
}

export default { runChecks, riskPerHour, checkHttp, checkContent, checkStock, checkPrice, fetchProductState };
