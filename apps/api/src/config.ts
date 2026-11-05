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
  // O login compara o e-mail em minúsculas e sem espaços: o do admin precisa estar igual.
  ADMIN_EMAIL: z.string().trim().toLowerCase().email().default('admin@tracado.local'),
  ADMIN_PASSWORD: z.string().min(8).default('admin12345'),
  /**
   * Recuperação de acesso: com "true", a cada boot a senha do admin volta a ser ADMIN_PASSWORD (e o bloqueio por
   * tentativas é zerado). Ligue, faça o deploy, entre e desligue (senão a troca de senha não dura).
   */
  ADMIN_RESET_PASSWORD: bool.default(false),
  ENABLE_DEV_ROUTES: bool.default(false),
  SEED_DEMO: bool.default(false),
  DEMO_BOTS: z.coerce.number().int().min(0).max(21).default(0),
  /** Corridas criadas automaticamente por dia (0 desliga; 24 = uma por hora). */
  AUTO_RACES_PER_DAY: z.coerce.number().int().min(0).max(96).default(0),
  /** Categoria (slug) das corridas automáticas; a padrão aceita qualquer nível. */
  AUTO_RACES_CATEGORY: z.string().default('copa-novatos'),
  /** Corridas automáticas valem ranking? As competições ranqueadas ficam com o admin. */
  AUTO_RACES_RANKED: bool.default(false),
  /** Pilotos simulados na grade automática (padrão até o admin salvar em Admin → Pilotos simulados). */
  SIMULATED_DRIVERS: bool.default(true),
  /** Quantas horas à frente a grade automática fica preenchida. */
  AUTO_RACES_LOOKAHEAD_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  /** Corridas teste com bots, em ciclo: a próxima larga N minutos depois da bandeirada da anterior (0 desliga). */
  AUTO_TEST_RACES_GAP_MIN: z.coerce.number().int().min(0).max(240).default(0),
  AUTO_TEST_RACES_LAPS: z.coerce.number().int().min(3).max(60).default(10),
  AUTO_TEST_RACES_KEEP_HOURS: z.coerce.number().min(0.5).max(168).default(3),
  REQUIRE_VERIFIED_EMAIL_FOR_RANKED: bool.default(false),
  RANKING_MIN_RACES: z.coerce.number().int().min(0).default(1),
  ENGINE_TICK_MS: z.coerce.number().int().min(50).default(500),
  ENGINE_ENABLED: bool.default(true),
  /** Login com Google (OAuth). Sem os dois, o botão não aparece. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
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
