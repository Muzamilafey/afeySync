import type { z } from 'zod';
import { badRequest } from './errors';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Request validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const pagination = (query: Record<string, unknown>, maxLimit = 100) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

/**
 * Validates a partial update and keeps only the keys the client sent. Zod 4 applies `.default()`
 * inside `.partial()`, so without this an omitted field would be silently reset to its default.
 */
export function parsePatch<T extends z.ZodType>(schema: T, data: unknown): Partial<z.infer<T>> {
  const parsed = parse(schema, data) as Record<string, unknown>;
  const sent = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => Object.prototype.hasOwnProperty.call(sent, k))) as Partial<z.infer<T>>;
}
