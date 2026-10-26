/** Auth-surface tests: the parts an attacker would actually try first. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import shopify from '../src/shopify.js';
import config from '../src/config.js';

config.shopify.apiKey = 'test_key';
config.shopify.apiSecret = 'test_secret_value_long_enough_123';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function makeToken(payload, secret = config.shopify.apiSecret) {
  const h = b64u({ alg: 'HS256', typ: 'JWT' });
  const p = b64u(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

test('shop domain validation blocks SSRF / open redirect', () => {
  assert.equal(shopify.isValidShopDomain('demo.myshopify.com'), true);
  assert.equal(shopify.isValidShopDomain('demo-store.myshopify.com'), true);
  assert.equal(shopify.isValidShopDomain('evil.com'), false);
  assert.equal(shopify.isValidShopDomain('demo.myshopify.com.evil.com'), false);
  assert.equal(shopify.isValidShopDomain('../../etc/passwd'), false);
  assert.equal(shopify.isValidShopDomain(null), false);
  assert.equal(shopify.isValidShopDomain('x'.repeat(300) + '.myshopify.com'), false);
});

test('valid session token is accepted and yields the shop', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({
    iss: 'https://demo.myshopify.com/admin',
    dest: 'https://demo.myshopify.com',
    aud: 'test_key',
    sub: '42',
    exp: now + 60,
    nbf: now - 10,
  });
  const r = shopify.verifySessionToken(token);
  assert.ok(r);
  assert.equal(r.shop, 'demo.myshopify.com');
});

test('session token signed with the wrong secret is rejected', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ dest: 'https://demo.myshopify.com', aud: 'test_key', exp: now + 60 }, 'wrong_secret');
  assert.equal(shopify.verifySessionToken(token), null);
});

test('expired session token is rejected', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ dest: 'https://demo.myshopify.com', aud: 'test_key', exp: now - 5 });
  assert.equal(shopify.verifySessionToken(token), null);
});

test('token with a foreign audience is rejected', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ dest: 'https://demo.myshopify.com', aud: 'someone_elses_app', exp: now + 60 });
  assert.equal(shopify.verifySessionToken(token), null);
});

test('token pointing at a non-shopify destination is rejected', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ dest: 'https://evil.com', aud: 'test_key', exp: now + 60 });
  assert.equal(shopify.verifySessionToken(token), null);
});

test('tampered payload invalidates the signature', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ dest: 'https://demo.myshopify.com', aud: 'test_key', exp: now + 60 });
  const [h, , s] = token.split('.');
  const forged = b64u({ dest: 'https://other.myshopify.com', aud: 'test_key', exp: now + 60 });
  assert.equal(shopify.verifySessionToken(`${h}.${forged}.${s}`), null);
});

test('garbage tokens return null instead of throwing', () => {
  for (const bad of ['', 'a.b', 'a.b.c.d', null, undefined, 'Bearer x']) {
    assert.equal(shopify.verifySessionToken(bad), null);
  }
});

test('oauth hmac verification accepts a valid signature and rejects a bad one', () => {
  const params = { shop: 'demo.myshopify.com', code: 'abc', state: 'xyz', timestamp: '1700000000' };
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const hmac = crypto.createHmac('sha256', config.shopify.apiSecret).update(message).digest('hex');
  const good = new URLSearchParams({ ...params, hmac }).toString();
  const bad = new URLSearchParams({ ...params, hmac: 'deadbeef' }).toString();
  assert.equal(shopify.verifyOAuthHmac(good), true);
  assert.equal(shopify.verifyOAuthHmac(bad), false);
  assert.equal(shopify.verifyOAuthHmac('shop=demo.myshopify.com'), false);
});

test('webhook hmac verifies against the raw body', () => {
  const raw = JSON.stringify({ id: 1, title: 'Aurora Lamp' });
  const hmac = crypto.createHmac('sha256', config.shopify.apiSecret).update(raw).digest('base64');
  assert.equal(shopify.verifyWebhookHmac(raw, hmac), true);
  assert.equal(shopify.verifyWebhookHmac(raw, 'nope'), false);
  assert.equal(shopify.verifyWebhookHmac('{"changed":true}', hmac), false);
});

test('pricing has a hard ceiling and no overage concept', () => {
  assert.equal(shopify.PRICING.maxMonthly, 49);
  assert.equal(shopify.PRICING.incidentOnlyBilling, true);
  assert.equal(shopify.PRICING.plans.growth.price, 49);
  assert.ok(!('overage' in shopify.PRICING));
});

test('form token binds a post to one shop and expires', () => {
  const shop = 'demo.myshopify.com';
  const tok = shopify.signFormToken(shop);
  assert.equal(shopify.verifyFormToken(shop, tok), true);
  assert.equal(shopify.verifyFormToken('other.myshopify.com', tok), false, 'replay to another shop must fail');
  assert.equal(shopify.verifyFormToken(shop, 'bogus'), false);
  assert.equal(shopify.verifyFormToken(shop, ''), false);
  assert.equal(shopify.verifyFormToken('evil.com', tok), false);
});

test('form token rejects an expired token', () => {
  const shop = 'demo.myshopify.com';
  const ts = Date.now() - 60 * 60 * 1000; // an hour old
  const mac = crypto.createHmac('sha256', config.shopify.apiSecret).update(`${shop}:${ts}`).digest('base64url');
  assert.equal(shopify.verifyFormToken(shop, `${ts}.${mac}`, 30), false);
});
