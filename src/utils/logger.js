/**
 * logger.js — minimal structured logger.
 * Uses console as the transport; swap for pino/winston later if needed.
 */

function log(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);

  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info:  (msg, meta) => log('info',  msg, meta),
  warn:  (msg, meta) => log('warn',  msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
