import { z } from 'zod';

const bool = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  HOST: z.string().default('0.0.0.0'),
  /** postgres://... para produção; vazio = PGlite embutido (dev/test). */
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().optional(),
  /** redis://... opcional; sem ele usa armazenamento em memória (instância única). */
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('dev-secret-change-me-please-0123456789'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: bool.default(false),
  ADMIN_EMAIL: z.string().email().default('admin@tracado.local'),
  ADMIN_PASSWORD: z.string().min(8).default('admin12345'),
  ENABLE_DEV_ROUTES: bool.default(false),
  SEED_DEMO: bool.default(false),
  DEMO_BOTS: z.coerce.number().int().min(0).max(21).default(0),
  REQUIRE_VERIFIED_EMAIL_FOR_RANKED: bool.default(false),
  RANKING_MIN_RACES: z.coerce.number().int().min(0).default(1),
  ENGINE_TICK_MS: z.coerce.number().int().min(50).default(500),
  ENGINE_ENABLED: bool.default(true),
  METRICS_TOKEN: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MAX_SIGNUPS_PER_IP_PER_DAY: z.coerce.number().int().default(10),
  FLAG_SIGNUPS_PER_IP_PER_DAY: z.coerce.number().int().default(3),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(300),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(10),
  ENTRY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(20),
});

export type Config = z.infer<typeof schema>;

/** Carrega `.env` do diretório atual, se existir (Node ≥ 21.7). Variáveis já definidas no ambiente têm prioridade. */
export function loadDotEnv(path = '.env') {
  try {
    process.loadEnvFile(path);
  } catch {
    /* sem .env: usa apenas o ambiente */
  }
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<Config> = {},
): Config {
  const cfg = { ...schema.parse(env), ...overrides };
  if (cfg.NODE_ENV === 'production') {
    if (cfg.JWT_SECRET.startsWith('dev-secret'))
      throw new Error('JWT_SECRET precisa ser definido em produção');
    if (cfg.ENABLE_DEV_ROUTES) throw new Error('ENABLE_DEV_ROUTES não pode ser usado em produção');
    if (cfg.ADMIN_PASSWORD === 'admin12345')
      throw new Error('ADMIN_PASSWORD padrão não pode ser usado em produção');
  }
  return cfg;
}
