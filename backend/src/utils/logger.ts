import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? (process.env.TEST_LOG ? 'error' : 'silent') : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.client_secret',
      '*.clientSecret',
      '*.apiKey',
      '*.access_token',
    ],
    censor: '[REDACTED]',
  },
});
