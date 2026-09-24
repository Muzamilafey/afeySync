import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 5 forwards rejected promises, but this keeps handlers typed consistently. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
