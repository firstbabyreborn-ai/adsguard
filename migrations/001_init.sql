-- AdsGuard schema. Idempotent: safe to re-run on every boot.
-- Money columns are numeric(12,2); every timestamp is timestamptz so a shop's
-- local timezone never changes the meaning of "3 hours ago".

CREATE TABLE IF NOT EXISTS shops (
  domain            text PRIMARY KEY,
  access_token      text,
  installed_at      timestamptz NOT NULL DEFAULT now(),
  uninstalled_at    timestamptz,
  -- set when a shop/redact webhook is processed; all PII is nulled at that point
  redacted_at       timestamptz,
  plan              text NOT NULL DEFAULT 'free',
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing           jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS watchpoints (
  id                    text PRIMARY KEY,
  shop                  text NOT NULL REFERENCES shops(domain) ON DELETE CASCADE,
  url                   text NOT NULL,
  product_id            text,
  variant_ids           text[] NOT NULL DEFAULT '{}',
  label                 text NOT NULL,
  ad_spend_30d          numeric(12,2) NOT NULL DEFAULT 0,
  sessions_30d          integer       NOT NULL DEFAULT 0,
  conversion_rate       numeric(6,4)  NOT NULL DEFAULT 0.02,
  aov                   numeric(12,2) NOT NULL DEFAULT 0,
  expect_text           text,
  expect_in_stock       boolean       NOT NULL DEFAULT true,
  max_price_change_pct  numeric(6,2)  NOT NULL DEFAULT 15,
  baseline_price        numeric(12,2),
  check_interval_mins   integer       NOT NULL DEFAULT 10,
  last_checked_at       timestamptz,
  last_status           text NOT NULL DEFAULT 'unknown',
  consecutive_failures  integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS watchpoints_shop_idx ON watchpoints (shop);
CREATE INDEX IF NOT EXISTS watchpoints_due_idx  ON watchpoints (last_checked_at NULLS FIRST);

CREATE TABLE IF NOT EXISTS events (
  id             text PRIMARY KEY,
  shop           text NOT NULL REFERENCES shops(domain) ON DELETE CASCADE,
  watch_id       text REFERENCES watchpoints(id) ON DELETE SET NULL,
  kind           text NOT NULL,
  severity       text NOT NULL DEFAULT 'warning',
  title          text NOT NULL,
  detail         text NOT NULL DEFAULT '',
  risk_per_hour  numeric(12,2) NOT NULL DEFAULT 0,
  at             timestamptz NOT NULL DEFAULT now(),
  cleared        boolean NOT NULL DEFAULT false,
  resolved_at    timestamptz,
  duration_mins  integer,
  estimated_loss numeric(12,2),
  alerted_at     timestamptz
);
CREATE INDEX IF NOT EXISTS events_shop_at_idx  ON events (shop, at DESC);
CREATE INDEX IF NOT EXISTS events_open_idx     ON events (shop, cleared) WHERE cleared = false;
CREATE INDEX IF NOT EXISTS events_watch_kind_idx ON events (watch_id, kind) WHERE cleared = false;

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id        bigserial PRIMARY KEY,
  event_id  text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  channel   text NOT NULL,
  ok        boolean NOT NULL,
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_deliveries_event_idx ON alert_deliveries (event_id);

-- Delivery health is a business metric: if email starts failing, every other
-- number on the dashboard becomes a lie. Surface it in /metrics.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
