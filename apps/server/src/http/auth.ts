import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { OWNER, type Principal } from '../core/auth/principal.ts';
import { HelmError, parse } from '../core/errors.ts';
import { jsonBody, type AppEnv } from './env.ts';

const COOKIE = 'helm_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Resolves `Authorization: Bearer <token>` to a principal. Plugged in by the tokens step. */
export type TokenResolver = (token: string) => Principal | null;

function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

async function hasValidSession(c: Context, config: Config): Promise<boolean> {
  const value = await getSignedCookie(c, config.sessionSecret, COOKIE);
  if (typeof value !== 'string') return false;
  const m = /^v1\.(\d+)$/.exec(value);
  if (!m) return false;
  return Date.now() - Number(m[1]) < SESSION_TTL_MS;
}

/** Sets `principal` from a session cookie or bearer token; 401 otherwise. */
export function authenticate(config: Config, resolveToken: TokenResolver): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization');
    if (header?.toLowerCase().startsWith('bearer ')) {
      const principal = resolveToken(header.slice(7).trim());
      if (!principal) throw new HelmError('unauthorized', 'Invalid or revoked token');
      c.set('principal', principal);
      return next();
    }
    if (await hasValidSession(c, config)) {
      c.set('principal', OWNER);
      return next();
    }
    throw new HelmError('unauthorized', 'Not signed in');
  };
}

/** Very small in-memory brute-force brake for the owner password. */
class LoginLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max = 10,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  blocked(key: string): boolean {
    const a = this.attempts.get(key);
    if (!a || a.resetAt < Date.now()) return false;
    return a.count >= this.max;
  }

  fail(key: string): void {
    const now = Date.now();
    const a = this.attempts.get(key);
    if (!a || a.resetAt < now) this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    else a.count++;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

function clientKey(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';
}

/** Public auth routes: login / logout / me. Mounted before `authenticate`. */
export function authRoutes(config: Config): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const limiter = new LoginLimiter();

  r.post('/login', async (c) => {
    const key = clientKey(c);
    if (limiter.blocked(key)) {
      return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } }, 429);
    }
    const { password } = parse(z.object({ password: z.string() }), await jsonBody(c));
    if (!passwordMatches(password, config.ownerPassword)) {
      limiter.fail(key);
      throw new HelmError('unauthorized', 'Wrong password');
    }
    limiter.reset(key);
    await setSignedCookie(c, COOKIE, `v1.${Date.now()}`, config.sessionSecret, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return c.json({ ok: true });
  });

  r.post('/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  r.get('/me', async (c) => c.json({ signedIn: await hasValidSession(c, config) }));

  return r;
}
