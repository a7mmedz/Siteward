import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JSON_LIMIT: z.string().default('2mb'),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(50),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DEMO_TOOLS: bool,
  FAIL_SYNC_RATE: z.coerce.number().min(0).max(1).default(0),
});

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigins: string[];
  logLevel: string;
  jsonLimit: string;
  loginRateLimit: number;
  trustProxy: number;
  demoTools: boolean;
  failSyncRate: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && e.JWT_SECRET.startsWith('replace-with')) {
    throw new Error('JWT_SECRET still has the placeholder value from .env.example');
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    jwtSecret: e.JWT_SECRET,
    jwtExpiresIn: e.JWT_EXPIRES_IN,
    corsOrigins: e.CORS_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    logLevel: e.LOG_LEVEL,
    jsonLimit: e.JSON_LIMIT,
    loginRateLimit: e.LOGIN_RATE_LIMIT,
    trustProxy: e.TRUST_PROXY,
    demoTools: e.DEMO_TOOLS,
    failSyncRate: e.FAIL_SYNC_RATE,
  };
}
