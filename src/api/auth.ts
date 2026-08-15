import type { NextFunction, Request, Response } from 'express';

/**
 * Authentication stub for SPEC-001.
 *
 * There is no auth spec yet, so the "authenticated user" (MVP.md) is the value
 * of the `X-User-Id` header. Requests without one are rejected as
 * unauthenticated. Lab ownership is then enforced against this ID in the
 * service layer.
 */
export const USER_ID_HEADER = 'x-user-id';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.header(USER_ID_HEADER);
  if (!userId || userId.trim().length === 0) {
    res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: `Missing or empty ${USER_ID_HEADER} header` },
    });
    return;
  }
  req.userId = userId;
  next();
}
