import type { NextFunction, Request, Response } from 'express';

import type { SessionStore } from '../application/sessionStore';

/**
 * Authentication for MiniLab.
 *
 * Multi-user model: browsers authenticate via a session cookie (`minilab_session`)
 * issued on login; the identity is resolved from the in-memory SessionStore.
 * Local CLI/script clients keep the legacy `X-User-Id` header contract
 * (SPEC-001) — the header is trusted because a process that can reach the
 * local service can already read/write the database directly.
 *
 * Unauthenticated browser navigation is redirected to the login page; JSON/API
 * clients without credentials get a 401.
 */
export const USER_ID_HEADER = 'x-user-id';
export const SESSION_COOKIE_NAME = 'minilab_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `sessionAuth` when a valid session cookie is present. */
      sessionUserId?: string;
      /** Set by `requireUser` — always present past that middleware. */
      userId: string;
    }
  }
}

/** Resolves the session cookie token from a request, or null. */
export function getSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name === SESSION_COOKIE_NAME && value.length > 0) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

/**
 * Global middleware: when the request carries a valid session cookie, records
 * the authenticated user on `req.sessionUserId`. Runs before every router so
 * `requireUser` can pick it up. Never rejects — it just leaves the request
 * unauthenticated when there is no session.
 */
export function sessionAuth(store: SessionStore) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = getSessionToken(req);
    if (token) {
      const session = store.get(token);
      if (session) {
        req.sessionUserId = session.userId;
      }
    }
    next();
  };
}

/** Set-Cookie value for a newly created session. */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 60 * 60}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

function wantsHtml(req: Request): boolean {
  return String(req.header('accept') ?? '').includes('text/html');
}

/**
 * Ensures a request is authenticated. Sources, in order:
 *   1. a valid session cookie (via `sessionAuth`)
 *   2. the legacy `X-User-Id` header (local CLI/script clients)
 * Unauthenticated browser navigation → 302 to the login page; other clients → 401 JSON.
 */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (req.sessionUserId) {
    req.userId = req.sessionUserId;
    next();
    return;
  }
  const headerUser = req.header(USER_ID_HEADER);
  if (headerUser && headerUser.trim().length > 0) {
    req.userId = headerUser.trim();
    next();
    return;
  }
  if (wantsHtml(req)) {
    const returnPath = req.originalUrl || '/';
    res.redirect(302, `/auth/login?return=${encodeURIComponent(returnPath)}`);
    return;
  }
  res.status(401).json({
    error: { code: 'UNAUTHENTICATED', message: `Missing or empty ${USER_ID_HEADER} header / session` },
  });
}

/**
 * Cross-site request forgery (CSRF) guard. Runs after `sessionAuth`, before all
 * routers, and only inspects state-changing requests without an `X-User-Id`
 * header — i.e. the browser-authenticated class of requests. Origin/Referer is
 * compared against the request Host; cross-site POSTs are rejected. SameSite=Strict
 * cookies already prevent cross-site cookie transmission, so this is defense in
 * depth rather than the primary control.
 */
export function desktopCsrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (process.env.MINILAB_DESKTOP !== '1') {
    next();
    return;
  }
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    next();
    return;
  }
  if (req.header(USER_ID_HEADER)) {
    next();
    return;
  }
  const host = req.headers.host;
  const origin = req.header('origin');
  if (origin) {
    if (host && originHostOf(origin) !== host) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cross-site request rejected' } });
      return;
    }
    next();
    return;
  }
  const referer = req.header('referer');
  if (referer) {
    if (host && originHostOf(referer) !== host) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cross-site request rejected' } });
      return;
    }
  }
  next();
}

/** Extracts the `host[:port]` from an absolute URL; returns '' on malformed input. */
function originHostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}
