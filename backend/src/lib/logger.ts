import { pino } from 'pino';

export function createLogger(level: string) {
  return pino({
    level,
    redact: ['req.headers.authorization', 'req.body.password'],
  });
}

export type Logger = ReturnType<typeof createLogger>;
