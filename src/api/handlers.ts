import type { NextFunction, Request, Response } from 'express';

/**
 * Wraps a handler so thrown errors reach the error middleware. Sync handlers
 * resolve immediately; async handlers (e.g. ModelGateway calls) have their
 * rejected promise forwarded to `next`, which the error middleware awaits.
 */
export function handle(handler: (req: Request, res: Response) => unknown | Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      Promise.resolve(handler(req, res)).catch(next);
    } catch (err) {
      next(err);
    }
  };
}
