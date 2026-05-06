import { randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'bounce_forge_admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const index = entry.indexOf('=');
        return index >= 0
          ? [entry.slice(0, index), decodeURIComponent(entry.slice(index + 1))]
          : [entry, ''];
      })
  );
}

function equalSecret(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export class AdminAuth {
  constructor(password) {
    this.password = password;
    this.sessions = new Map();
  }

  isConfigured() {
    return typeof this.password === 'string' && this.password.length > 0;
  }

  login(password) {
    if (
      !this.isConfigured() ||
      typeof password !== 'string' ||
      !equalSecret(password, this.password)
    ) {
      return null;
    }

    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
  }

  isRequestAuthenticated(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];

    if (!token) {
      return false;
    }

    const expiresAt = this.sessions.get(token);

    if (!expiresAt || expiresAt < Date.now()) {
      this.sessions.delete(token);
      return false;
    }

    return true;
  }

  logout(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];

    if (token) {
      this.sessions.delete(token);
    }
  }

  createCookie(token, { secure = false } = {}) {
    return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000
    )}${secure ? '; Secure' : ''}`;
  }

  clearCookie({ secure = false } = {}) {
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
  }
}
