import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { ForbiddenError, ModelGatewayError, NotFoundError, ValidationError } from '../domain/errors';

/**
 * Maps domain and validation errors to stable HTTP error codes
 * (ENGINEERING_RULES: "Return stable error codes").
 *
 *   VALIDATION_ERROR -> 400   (invalid request body / domain invariant)
 *   NOT_FOUND        -> 404
 *   FORBIDDEN        -> 403
 *   UNAUTHENTICATED  -> 401   (handled in auth middleware)
 *   PROVIDER_ERROR   -> 502   (normalized model-provider failure, with category)
 *   INTERNAL_ERROR   -> 500
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', issues: err.issues },
    });
    return;
  }
  if (err instanceof ModelGatewayError) {
    res.status(502).json({
      error: { code: 'PROVIDER_ERROR', category: err.category, message: err.message },
    });
    return;
  }
  if (err instanceof ValidationError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: err.message } });
    return;
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: err.message } });
    return;
  }
  // Body-parser errors (e.g. malformed JSON) carry a status and `expose`.
  if (
    err &&
    typeof err === 'object' &&
    (err as { status?: unknown }).status === 400 &&
    (err as { expose?: unknown }).expose
  ) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed request body' } });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
