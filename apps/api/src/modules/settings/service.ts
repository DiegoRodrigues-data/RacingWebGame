import {
  DEFAULT_GAME_SETTINGS,
  gameSettingsSchema,
  type GameSettings,
  type PublicSettingsDto,
} from '@tracado/shared';
import { eq } from 'drizzle-orm';
import type { Config } from '../../config';
import type { Ctx } from '../../context';
import { gameSettings } from '../../db/schema';

const ROW = 'main';
/** Várias instâncias da API: cada uma relê o banco a cada poucos segundos. */
const TTL_MS = 5000;
let cache: { at: number; value: GameSettings; cfg: Config } | null = null;

/** Padrões herdados das variáveis de ambiente antigas, para nada mudar até o admin salvar. */
export function settingsFromConfig(cfg: Config): GameSettings {
  const d = DEFAULT_GAME_SETTINGS;
  return {
    ...d,
    autoRaces: {
      ...d.autoRaces,
      enabled: cfg.AUTO_RACES_PER_DAY > 0,
      perDay: cfg.AUTO_RACES_PER_DAY || d.autoRaces.perDay,
      lookaheadHours: cfg.AUTO_RACES_LOOKAHEAD_HOURS,
      ranked: cfg.AUTO_RACES_RANKED,
      categories: [cfg.AUTO_RACES_CATEGORY],
      bots: cfg.DEMO_BOTS,
    },
    testRaces: {
      ...d.testRaces,
      enabled: cfg.AUTO_TEST_RACES_GAP_MIN > 0,
      gapMin: cfg.AUTO_TEST_RACES_GAP_MIN || d.testRaces.gapMin,
      laps: cfg.AUTO_TEST_RACES_LAPS,
      bots: cfg.DEMO_BOTS,
      keepHours: cfg.AUTO_TEST_RACES_KEEP_HOURS,
    },
    adminRaceBots: cfg.DEMO_BOTS,
  };
}

/** Configuração salva por cima dos padrões (campos novos de versões futuras ganham o padrão). */
function merge(base: GameSettings, saved: Partial<GameSettings>): GameSettings {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(saved))
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v)
        ? { ...((base as unknown as Record<string, object>)[k] ?? {}), ...(v as object) }
        : v;
  const parsed = gameSettingsSchema.safeParse(out);
  return parsed.success ? parsed.data : base;
}

export async function getSettings(ctx: Pick<Ctx, 'db' | 'config' | 'clock'>): Promise<GameSettings> {
  const now = ctx.clock.now();
  if (cache && cache.cfg === ctx.config && now - cache.at < TTL_MS && now >= cache.at) return cache.value;
  const [row] = await ctx.db.select().from(gameSettings).where(eq(gameSettings.id, ROW));
  const base = settingsFromConfig(ctx.config);
  const value = row ? merge(base, row.value) : base;
  cache = { at: now, value, cfg: ctx.config };
  return value;
}

export async function saveSettings(
  ctx: Pick<Ctx, 'db' | 'config' | 'clock'>,
  value: GameSettings,
  actorId: string,
): Promise<GameSettings> {
  const now = new Date(ctx.clock.now());
  await ctx.db
    .insert(gameSettings)
    .values({ id: ROW, value, updatedAt: now, updatedBy: actorId })
    .onConflictDoUpdate({ target: gameSettings.id, set: { value, updatedAt: now, updatedBy: actorId } });
  cache = null;
  return getSettings(ctx);
}

export function forgetSettingsCache() {
  cache = null;
}

export function publicSettings(s: GameSettings): PublicSettingsDto {
  return { phases: s.phases, crazy: s.crazy };
}
