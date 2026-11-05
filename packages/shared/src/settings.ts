import { z } from 'zod';
import { MAX_CARS_PER_RACE } from './constants';

/**
 * Configurações do jogo editáveis pelo admin, com efeito na hora (sem deploy). Ficam numa linha do banco;
 * sem ela, valem os padrões abaixo misturados com as variáveis de ambiente antigas (AUTO_RACES_*, DEMO_BOTS).
 * Valem para as corridas criadas daqui em diante: as já agendadas mantêm os horários e a pista.
 */
const terrainWeights = z.object({
  asphalt: z.number().min(0).max(100),
  dirt: z.number().min(0).max(100),
  sand: z.number().min(0).max(100),
  mixed: z.number().min(0).max(100),
});
export type TerrainWeights = z.infer<typeof terrainWeights>;

export const phaseTimesSchema = z.object({
  /** Treino (min). */
  practiceMin: z.number().min(0.5).max(120),
  /** Janela de traçado depois do treino (s); 0 = sem janela (padrão). */
  traceWindowSec: z.number().int().min(0).max(900),
  /** Parque fechado antes da classificação (s). */
  setupLockSec: z.number().int().min(5).max(600),
  /** Sessão de classificação ao vivo (s). */
  qualifyingSec: z.number().int().min(20).max(1800),
});
export type PhaseTimes = z.infer<typeof phaseTimesSchema>;

export const gameSettingsSchema = z
  .object({
    /** Durações das fases das corridas automáticas, das corridas teste e da Corrida Maluca. */
    phases: phaseTimesSchema,
    /** Grade de corridas de hora em hora. */
    autoRaces: z.object({
      enabled: z.boolean(),
      perDay: z.number().int().min(1).max(96),
      lookaheadHours: z.number().int().min(1).max(168),
      ranked: z.boolean(),
      /** null = voltas da categoria. */
      laps: z.number().int().min(3).max(60).nullable(),
      /** Rodízio de categorias (slugs); a corrida de cada horário usa a próxima da lista. */
      categories: z.array(z.string().min(1).max(60)).min(1).max(12),
      bots: z
        .number()
        .int()
        .min(0)
        .max(MAX_CARS_PER_RACE - 1),
    }),
    /** Corridas teste em ciclo (curtas, com bots): uma por vez; `gapMin` = da bandeirada ao treino da próxima. */
    testRaces: z.object({
      enabled: z.boolean(),
      gapMin: z.number().int().min(1).max(240),
      laps: z.number().int().min(3).max(60),
      bots: z
        .number()
        .int()
        .min(0)
        .max(MAX_CARS_PER_RACE - 1),
      keepHours: z.number().min(0.5).max(168),
      /** Rodízio de terrenos, na ordem: cada corrida teste usa o próximo da lista. */
      terrains: z.array(z.enum(['asphalt', 'dirt', 'sand', 'mixed'])).min(1).max(4),
    }),
    /** Bots nas corridas criadas pelo admin (0 = só gente). */
    adminRaceBots: z
      .number()
      .int()
      .min(0)
      .max(MAX_CARS_PER_RACE - 1),
    /** Geração das pistas das corridas automáticas (hora em hora, teste, Corrida Maluca). */
    tracks: z.object({
      /** Peso de cada terreno no sorteio (0 = não sai). */
      terrains: terrainWeights,
      /** null = faixa da categoria. */
      lengthMin: z.number().int().min(800).max(6000).nullable(),
      lengthMax: z.number().int().min(800).max(6000).nullable(),
      /** null = complexidade da categoria. */
      complexity: z.number().min(0).max(1).nullable(),
      width: z.number().int().min(8).max(20),
      /** Seeds: aleatórias, ou com prefixo fixo (ex.: "verao" → "verao-1730…") para reconhecer depois. */
      seedPrefix: z
        .string()
        .trim()
        .max(24)
        .regex(/^[a-z0-9-]*$/i, 'Use letras, números e -'),
      /** Peso de cada cenário (autódromo, deserto, cânion); combinações em que a pista some são evitadas. */
      biomes: z.object({
        grass: z.number().min(0).max(100),
        desert: z.number().min(0).max(100),
        canyon: z.number().min(0).max(100),
      }),
      /** Pistas salvas no rodízio (versões publicadas) e a chance de usar uma delas em vez de gerar. */
      pool: z.array(z.string().uuid()).max(50),
      poolChance: z.number().min(0).max(1),
    }),
    crazy: z.object({
      maxRaces: z.number().int().min(1).max(20),
      maxMembers: z.number().int().min(2).max(MAX_CARS_PER_RACE),
      lapsDefault: z.number().int().min(3).max(60),
      chaosDefault: z.boolean(),
      /** 0 = sem bots por padrão. */
      botFillDefault: z.number().int().min(0).max(MAX_CARS_PER_RACE),
    }),
  })
  .refine(
    (s) => Object.values(s.tracks.terrains).some((w) => w > 0),
    'Libere pelo menos um terreno (peso maior que zero).',
  )
  .refine((s) => Object.values(s.tracks.biomes).some((w) => w > 0), 'Libere pelo menos um cenário.')
  .refine(
    (s) =>
      s.tracks.lengthMin == null || s.tracks.lengthMax == null || s.tracks.lengthMin <= s.tracks.lengthMax,
    'O comprimento mínimo passa do máximo.',
  );
export type GameSettings = z.infer<typeof gameSettingsSchema>;

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  phases: { practiceMin: 2, traceWindowSec: 0, setupLockSec: 30, qualifyingSec: 60 },
  autoRaces: {
    enabled: false,
    perDay: 24,
    lookaheadHours: 24,
    ranked: false,
    laps: null,
    categories: ['copa-novatos'],
    bots: 0,
  },
  testRaces: {
    enabled: false,
    gapMin: 2,
    laps: 10,
    bots: 0,
    keepHours: 3,
    terrains: ['asphalt', 'dirt', 'sand', 'mixed'],
  },
  adminRaceBots: 0,
  tracks: {
    terrains: { asphalt: 100, dirt: 0, sand: 0, mixed: 0 },
    biomes: { grass: 100, desert: 0, canyon: 0 },
    lengthMin: null,
    lengthMax: null,
    complexity: null,
    width: 12,
    seedPrefix: '',
    pool: [],
    poolChance: 0,
  },
  crazy: { maxRaces: 10, maxMembers: 20, lapsDefault: 8, chaosDefault: true, botFillDefault: 0 },
};

/** O que o jogo precisa saber no navegador (sem nada administrativo). */
export interface PublicSettingsDto {
  phases: PhaseTimes;
  crazy: GameSettings['crazy'];
}

/** Sorteio ponderado de terreno com um número em [0, 1). */
export function pickTerrain(w: TerrainWeights, u: number): keyof TerrainWeights {
  const keys = (Object.keys(w) as (keyof TerrainWeights)[]).filter((k) => w[k] > 0);
  const total = keys.reduce((a, k) => a + w[k], 0);
  let x = u * total;
  for (const k of keys) {
    x -= w[k];
    if (x < 0) return k;
  }
  return keys[keys.length - 1]!;
}
