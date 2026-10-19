import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  RESTCOUNTRIES_API_KEY: z.string().min(1, 'RESTCOUNTRIES_API_KEY is required'),
  REFRESH_TTL_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

export type Env = Record<string, string | undefined>;

/** Parses env vars and fails fast with the offending field names. */
export function loadConfig(env: Env = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return result.data;
}
