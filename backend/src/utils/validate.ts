import type { z } from 'zod';
import { badRequest } from './errors';

/** "reorderLevel" → "Reorder level"; "prices.1.amount" → "Prices (row 2) amount". */
export function fieldLabel(path: PropertyKey[]) {
  const words = path
    .map((p) => (typeof p === 'number' ? `(row ${p + 1})` : String(p).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()))
    .join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Request';
}

type Issue = z.core.$ZodIssue;
/** A plain-language explanation of one validation problem. Custom messages written in schemas are kept. */
export function friendlyIssue(i: Issue): string {
  const x = i as Issue & { minimum?: number | bigint; maximum?: number | bigint; origin?: string; format?: string; expected?: string; values?: unknown[]; input?: unknown };
  const generic = /^(Too small|Too big|Invalid|Expected)/.test(i.message);
  if (!generic) return i.message;
  switch (i.code) {
    case 'too_small':
      if (x.origin === 'string') return Number(x.minimum) <= 1 ? 'is required' : `must be at least ${x.minimum} characters`;
      if (x.origin === 'array') return Number(x.minimum) <= 1 ? 'needs at least one entry' : `needs at least ${x.minimum} entries`;
      return `must be ${x.minimum} or more`;
    case 'too_big':
      if (x.origin === 'string') return `must be at most ${x.maximum} characters`;
      if (x.origin === 'array') return `can have at most ${x.maximum} entries`;
      return `must be ${x.maximum} or less`;
    case 'invalid_format':
      if (x.format === 'email') return 'must be a valid email address';
      if (x.format === 'regex') return 'contains characters that are not allowed';
      return `is not a valid ${x.format ?? 'value'}`;
    case 'invalid_type':
      if (x.input === undefined || x.input === null || x.input === '') return 'is required';
      return x.expected === 'number' ? 'must be a number' : `must be a ${x.expected}`;
    case 'invalid_value':
      return x.values?.length ? `must be one of: ${x.values.map(String).join(', ')}` : 'has an invalid value';
    default:
      return i.message;
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), field: fieldLabel(i.path), message: friendlyIssue(i) }));
    const summary = issues.slice(0, 3).map((i) => `${i.field}: ${i.message}`).join('; ');
    throw badRequest(`Please check: ${summary}${issues.length > 3 ? ` (and ${issues.length - 3} more)` : ''}.`, issues, 'VALIDATION_ERROR');
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
