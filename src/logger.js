/**
 * Structured JSON logger. One line per event, no dependencies.
 * In production these lines are the entire observability story for a solo
 * operator: ship to whatever platform collects stdout and you can answer
 * "why did this shop not get an alert?" without a debugger.
 */
import config from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.log.level] ?? LEVELS.info;

function emit(level, msg, fields = {}) {
  if (LEVELS[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const out = JSON.stringify(line, (k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v));
  if (level === 'error') process.stderr.write(out + '\n');
  else process.stdout.write(out + '\n');
}

export const logger = {
  debug: (m, f) => emit('debug', m, f),
  info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
  child: (bindings) => ({
    debug: (m, f) => emit('debug', m, { ...bindings, ...f }),
    info: (m, f) => emit('info', m, { ...bindings, ...f }),
    warn: (m, f) => emit('warn', m, { ...bindings, ...f }),
    error: (m, f) => emit('error', m, { ...bindings, ...f }),
  }),
};

/** Wrap a handler so an unhandled rejection becomes a 500, never a dead process. */
export function asyncRoute(fn) {
  return (req, res, ...rest) => {
    Promise.resolve(fn(req, res, ...rest)).catch((err) => {
      logger.error('route_failed', { url: req.url, err });
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
    });
  };
}

export default logger;
