import { Router, type Request, type Response } from 'express';

import type { SessionStore } from '../application/sessionStore';
import type { UserService } from '../application/userService';
import { toUserView } from '../domain/user';
import { AuthenticationError } from '../domain/errors';
import { getSessionToken, sessionCookie, clearSessionCookie } from './auth';
import { renderLoginPage, renderSetupPage } from './authView';

/**
 * Unauthenticated routes: login, logout, session status, and first-run setup.
 * Mounted before every `requireUser` router, so it must not require a session
 * itself. The setup flow also performs the legacy `local-pi` → 0th-user data
 * migration.
 */
export function authRouter(deps: {
  userService: UserService;
  sessionStore: SessionStore;
}): Router {
  const router = Router();
  const { userService, sessionStore } = deps;

  const queryString = (req: Request, key: string): string | null => {
    const v = req.query[key];
    return typeof v === 'string' ? v : null;
  };
  const str = (v: unknown): string => String(v ?? '').trim();
  const strOpt = (v: unknown): string | undefined => {
    const s = str(v);
    return s.length === 0 ? undefined : s;
  };
  /** Only allow same-origin relative return targets (no open redirect). */
  const safeReturn = (raw: unknown, fallback: string): string => {
    if (typeof raw !== 'string' || raw.length === 0) return fallback;
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return fallback;
  };
  const setSession = (res: Response, userId: string): void => {
    const token = sessionStore.create(userId);
    res.setHeader('Set-Cookie', sessionCookie(token));
  };

  router.get('/auth/login', (req, res) => {
    if (userService.countUsers() === 0) {
      res.redirect(302, '/setup');
      return;
    }
    const error = queryString(req, 'error');
    const notice = queryString(req, 'notice');
    const returnTo = queryString(req, 'return') ?? '/';
    res.type('html').send(renderLoginPage({ error, notice, returnTo: safeReturn(returnTo, '/') }));
  });

  router.post('/auth/login', (req, res) => {
    const username = str(req.body?.username);
    const password = String(req.body?.password ?? '');
    const returnTo = safeReturn(req.body?.return, '/');
    if (!username || !password) {
      res.redirect(302, `/auth/login?return=${encodeURIComponent(returnTo)}&error=${encodeURIComponent('请输入用户名和密码')}`);
      return;
    }
    try {
      const user = userService.authenticate(username, password);
      setSession(res, user.id);
      res.redirect(302, returnTo);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        res.redirect(302, `/auth/login?return=${encodeURIComponent(returnTo)}&error=${encodeURIComponent('用户名或密码错误')}`);
        return;
      }
      throw err;
    }
  });

  router.post('/auth/logout', (req, res) => {
    const token = getSessionToken(req);
    if (token) sessionStore.revoke(token);
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.redirect(302, '/auth/login');
  });

  router.get('/auth/status', (req, res) => {
    if (!req.sessionUserId) {
      res.json({ authenticated: false, user: null });
      return;
    }
    try {
      const user = userService.getUser(req.sessionUserId);
      res.json({ authenticated: true, user: toUserView(user) });
    } catch {
      res.json({ authenticated: false, user: null });
    }
  });

  router.get('/setup', (req, res) => {
    if (userService.countUsers() > 0) {
      res.redirect(302, '/auth/login');
      return;
    }
    res.type('html').send(renderSetupPage({ error: queryString(req, 'error') }));
  });

  router.post('/setup', (req, res) => {
    if (userService.countUsers() > 0) {
      res.redirect(302, '/auth/login');
      return;
    }
    const username = str(req.body?.username);
    const displayName = strOpt(req.body?.displayName);
    const password = String(req.body?.password ?? '');
    const passwordConfirm = String(req.body?.passwordConfirm ?? '');
    if (password !== passwordConfirm) {
      res.redirect(302, '/setup?error=' + encodeURIComponent('两次输入的密码不一致'));
      return;
    }
    try {
      const user = userService.createFirstUser({ username, password, displayName });
      // First-run migration: adopt legacy local-pi Labs under the new 0th user.
      userService.adoptLegacyData(user.id);
      setSession(res, user.id);
      res.redirect(302, '/');
    } catch (err) {
      if (err instanceof Error) {
        res.redirect(302, '/setup?error=' + encodeURIComponent(err.message));
        return;
      }
      throw err;
    }
  });

  return router;
}
