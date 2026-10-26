/**
 * Alert dispatch.
 *
 * The product is worthless if the alert never arrives, so this module never
 * throws: every failure is captured, recorded in `alert_deliveries`, and
 * surfaced in /metrics. Two suppression rules prevent the failure mode that
 * gets monitoring apps uninstalled — storms and noise.
 */
import config from './config.js';
import { logger } from './logger.js';

const money = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

export function formatAlert(shop, event) {
  const burn = event.riskPerHour ? `${money(event.riskPerHour)}/hour` : 'cost unknown';
  const daily = event.riskPerHour ? `${money(event.riskPerHour * 24)}/day` : '';
  return {
    subject: `[AdsGuard] ${event.title}`,
    text: [
      event.title,
      '',
      event.detail,
      '',
      `Burning: ${burn}${daily ? ` (${daily} if it runs all day)` : ''}`,
      `Store:   ${shop.domain}`,
      `Detected: ${new Date(event.at).toUTCString()}`,
      '',
      'Fix now → your dashboard shows the page, the evidence and the fix.',
    ].join('\n'),
    slack: {
      text:
        `:rotating_light: *${event.title}*\n${event.detail}\n` +
        `*Burning ${burn}${daily ? ` · ${daily}` : ''}* · \`${shop.domain}\``,
    },
    sms: `AdsGuard: ${event.title} — ${burn}. ${shop.domain}`,
  };
}

async function sendEmail({ to, subject, text }) {
  if (!to) return { channel: 'email', ok: false, reason: 'no_recipient' };
  if (!config.alerts.resendKey) return { channel: 'email', ok: true, simulated: true, to };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.alerts.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.alerts.fromEmail, to, subject, text }),
    });
    return { channel: 'email', ok: res.ok, status: res.status, reason: res.ok ? undefined : await res.text().catch(() => '') };
  } catch (err) {
    return { channel: 'email', ok: false, reason: err.message };
  }
}

async function sendSlack({ webhookUrl, payload }) {
  if (!webhookUrl) return { channel: 'slack', ok: false, reason: 'no_webhook' };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { channel: 'slack', ok: res.ok, status: res.status };
  } catch (err) {
    return { channel: 'slack', ok: false, reason: err.message };
  }
}

async function sendSms({ to, body }) {
  const { sid, token, from } = config.alerts.twilio;
  if (!sid || !token || !from) return { channel: 'sms', ok: false, reason: 'twilio_not_configured' };
  if (!to) return { channel: 'sms', ok: false, reason: 'no_phone' };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    return { channel: 'sms', ok: res.ok, status: res.status };
  } catch (err) {
    return { channel: 'sms', ok: false, reason: err.message };
  }
}

export async function dispatch(shop, event, store) {
  const msg = formatAlert(shop, event);
  const plan = ['email', 'slack', 'sms'].filter((c) =>
    (PLAN_CHANNELS[shop.plan] ?? PLAN_CHANNELS.free).includes(c),
  );

  const attempts = [];
  if (plan.includes('email')) {
    attempts.push(await sendEmail({ to: shop.settings?.alertEmail, subject: msg.subject, text: msg.text }));
  }
  if (plan.includes('slack')) {
    attempts.push(await sendSlack({ webhookUrl: shop.settings?.slackWebhook, payload: msg.slack }));
  }
  if (plan.includes('sms')) {
    attempts.push(await sendSms({ to: shop.settings?.alertPhone, body: msg.sms }));
  }

  // Persist every attempt. Silence about a failed alert is the worst outcome.
  if (store?.recordDelivery) {
    for (const a of attempts) {
      try {
        await store.recordDelivery(event.id, a.channel, a.ok, a);
      } catch (err) {
        logger.warn('delivery_record_failed', { event: event.id, err });
      }
    }
  }
  const anyOk = attempts.some((a) => a.ok);
  if (!anyOk) logger.error('alert_delivery_failed', { shop: shop.domain, event: event.id, attempts });

  return attempts;
}

const PLAN_CHANNELS = {
  free: ['email'],
  starter: ['email', 'slack'],
  growth: ['email', 'slack', 'sms'],
};

/**
 * Two suppression rules:
 *  1. risk floor — never page for something under N $/hour
 *  2. one page per open incident (watchId+kind) per cooldown window
 */
export function shouldNotify(shop, event, existingOpen, { lastAlertAt = 0 } = {}) {
  if (shop.uninstalledAt) return false;
  const floor = Number(shop.settings?.minRiskToAlert ?? 15);
  if (Number(event.riskPerHour) < floor) return false;
  const dup = existingOpen.some((e) => e.watchId === event.watchId && e.kind === event.kind);
  if (dup) return false;
  const cooldownMs = config.alerts.minSecondsBetweenAlerts * 1000;
  if (Date.now() - lastAlertAt < cooldownMs) return false;
  return true;
}

export default { dispatch, formatAlert, shouldNotify };
