import { DEFAULT_SCORING, type CategoryConfig, type RaceCreate } from '@tracado/shared';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { ensureAdmin } from '../src/db/bootstrap';
import { signAccessToken } from '../src/lib/auth';
import { createDb } from '../src/db/client';
import { ManualClock } from '../src/lib/clock';
import { MemoryStore } from '../src/lib/store';

const expect200 = (r: { status: number; body: unknown }) => {
  if (r.status !== 200) throw new Error(`esperado 200: ${JSON.stringify(r.body)}`);
};

export const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);

export const TEST_CATEGORY: CategoryConfig = {
  laps: 30,
  trackLength: { min: 1500, max: 1800 },
  trackComplexity: 0.4,
  terrains: ['asphalt'],
  weathers: ['dry'],
  rainChance: 0,
  randomEvents: { safetyCar: false, oil: false, mechanical: false },
  setupLimits: {
    allowedTyres: ['soft', 'medium', 'hard', 'wet'],
    aero: { min: 1, max: 10 },
    allowedEngines: ['economy', 'balanced', 'power'],
    maxPitStops: 1,
  },
  scoring: DEFAULT_SCORING,
  entryRequirement: { minLevel: 'rookie', minRaces: 0 },
  playbackSpeed: 4,
};

export async function setupApp(overrides: Partial<Config> = {}) {
  const config = loadConfig(
    { NODE_ENV: 'test' },
    {
      LOG_LEVEL: 'silent',
      ENABLE_DEV_ROUTES: true,
      ENGINE_ENABLED: false,
      DEMO_BOTS: 0,
      MAX_SIGNUPS_PER_IP_PER_DAY: 100000,
      FLAG_SIGNUPS_PER_IP_PER_DAY: 100000,
      ...overrides,
    },
  );
  const clock = new ManualClock(T0);
  const dbHandle = await createDb({});
  await dbHandle.migrate();
  const adminId = await ensureAdmin(dbHandle.db, config);
  const store = new MemoryStore(() => clock.now());
  const { app, ctx, engine } = await buildApp({ config, dbHandle, store, clock, logger: false });
  await app.ready();

  const json = async <T = any>(
    method: string,
    url: string,
    body?: unknown,
    token?: string,
    headers: Record<string, string> = {},
  ) => {
    // 'ADMIN' é um marcador: gera um token de admin válido no relógio atual (o relógio de teste avança).
    if (token === 'ADMIN')
      token = await signAccessToken(
        config.JWT_SECRET,
        { id: adminId, roles: ['player', 'admin'] },
        clock.now(),
      );
    // 'USER:<id>' gera um token de jogador válido no relógio atual (simula o refresh automático do cliente).
    else if (token?.startsWith('USER:'))
      token = await signAccessToken(
        config.JWT_SECRET,
        { id: token.slice(5), roles: ['player'] },
        clock.now(),
      );
    const res = await app.inject({
      method: method as 'GET',
      url,
      ...(body !== undefined ? { payload: body as object } : {}),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
    return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : null) as T, res };
  };

  let n = 0;
  const register = async (
    nick?: string,
    extra: Partial<{ country: string; region: string; city: string }> = {},
  ) => {
    n++;
    const nickname = nick ?? `piloto${n}`;
    const r = await json('POST', '/auth/register', {
      email: `${nickname.toLowerCase()}@teste.dev`,
      password: 'senha-forte-1',
      nickname,
      country: 'BR',
      region: 'SP',
      city: 'Campinas',
      ...extra,
    });
    if (r.status !== 201) throw new Error(`register falhou: ${JSON.stringify(r.body)}`);
    return {
      token: `USER:${r.body.me.id}`,
      jwt: r.body.accessToken as string,
      userId: r.body.me.id as string,
      nickname,
      cookie: r.res.cookies.find((c) => c.name === 'tracado_rt')!.value,
    };
  };

  const login = async (email: string, password: string) => json('POST', '/auth/login', { email, password });
  const admin = 'ADMIN';
  expect200(await login(config.ADMIN_EMAIL, config.ADMIN_PASSWORD));

  const cat = await json(
    'POST',
    '/admin/categories',
    {
      slug: 'teste',
      name: 'Categoria Teste',
      level: 'rookie',
      description: '',
      config: TEST_CATEGORY,
      active: true,
    },
    admin,
  );
  const categoryId = cat.body.id as string;

  const createRace = async (over: Partial<RaceCreate> = {}, startInMs = 30 * 60_000) => {
    const r = await json(
      'POST',
      '/admin/races',
      {
        name: 'Corrida Teste',
        categoryId,
        startAt: new Date(clock.now() + startInMs).toISOString(),
        registrationLeadMinutes: Math.ceil(startInMs / 60_000) + 5,
        practiceMinutes: 2,
        // Os testes antigos exercitam a janela de traçado (ainda suportada nas corridas que a têm).
        traceWindowSeconds: 120,
        setupLockSeconds: 10,
        qualifyingSeconds: 20,
        track: { type: 'procedural', seed: 'teste' },
        ...over,
      },
      admin,
    );
    if (r.status !== 201) throw new Error(`createRace falhou: ${JSON.stringify(r.body)}`);
    await engine.tick(); // scheduled → registration_open
    return r.body.id as string;
  };

  const advance = async (ms: number) => {
    clock.advance(ms);
    await engine.tick();
  };
  const advanceTo = async (t: number) => {
    if (t > clock.now()) clock.set(t);
    await engine.tick();
  };
  const race = async (id: string) => (await json('GET', `/races/${id}`)).body;

  return {
    app,
    ctx,
    engine,
    clock,
    config,
    json,
    register,
    login,
    admin,
    adminId,
    categoryId,
    createRace,
    advance,
    advanceTo,
    race,
    close: async () => {
      await app.close();
      await dbHandle.close();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof setupApp>>;
