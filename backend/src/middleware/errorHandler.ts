import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { fieldLabel, friendlyIssue } from '../utils/validate';
import { logger } from '../utils/logger';

/** Standard error envelope. Never leaks stack traces, credentials or tokens. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: unknown;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), field: fieldLabel(i.path), message: friendlyIssue(i) }));
    message = `Please check: ${issues.slice(0, 3).map((i) => `${i.field}: ${i.message}`).join('; ')}.`;
    details = issues;
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'INVALID_ID';
    message = 'Invalid identifier';
  } else if ((err as { code?: number })?.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    const kv = (err as { keyValue?: Record<string, unknown> }).keyValue ?? {};
    const [field, value] = Object.entries(kv)[0] ?? [];
    message = field ? `A record with ${fieldLabel(String(field).split('.')).toLowerCase()} "${String(value)}" already exists. Use a different ${fieldLabel(String(field).split('.')).toLowerCase()}.` : 'A record with the same unique value already exists';
  } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON body';
  } else if ((err as { type?: string })?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  }

  if (status >= 500) logger.error({ err, requestId: req.requestId, path: req.path }, 'Unhandled error');
  res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}), requestId: req.requestId } });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Endpoint not found', requestId: req.requestId } });
}
