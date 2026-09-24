import bcrypt from 'bcryptjs';
import { z } from 'zod';

const ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export const passwordPolicy = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Password must contain upper, lower case letters and a digit');

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
