// /api/ratelimit.js
// In-memory rate limiter with hashed IPs (CommonJS).

const crypto = require('crypto');

const store = new Map();
const DAILY_LIMIT = 100;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function hashIp(ip) {
  const salt = process.env.IP_SALT || 'inkong-default-salt-change-me';
  return crypto.createHash('sha256').update(salt + '::' + ip).digest('hex').slice(0, 32);
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return hours + ' hour' + (hours === 1 ? '' : 's') + ' and ' + minutes + ' minute' + (minutes === 1 ? '' : 's');
  if (minutes > 0) return minutes + ' minute' + (minutes === 1 ? '' : 's');
  return seconds + ' second' + (seconds === 1 ? '' : 's');
}

function checkRateLimit(ipHash) {
  const now = Date.now();
  const entry = store.get(ipHash);

  if (!entry || (now - entry.firstAt) > WINDOW_MS) {
    store.set(ipHash, { count: 1, firstAt: now });
    return { allowed: true, remaining: DAILY_LIMIT - 1 };
  }

  if (entry.count >= DAILY_LIMIT) {
    const resetsAt = entry.firstAt + WINDOW_MS;
    const msLeft = resetsAt - now;
    return {
      allowed: false,
      remaining: 0,
      msLeft: msLeft,
      resetsIn: formatDuration(msLeft)
    };
  }

  entry.count += 1;
  return { allowed: true, remaining: DAILY_LIMIT - entry.count };
}

module.exports = {
  hashIp: hashIp,
  getClientIp: getClientIp,
  checkRateLimit: checkRateLimit
};
