import {
  AppError,
  carSetupSchema,
  checkSetupLimits,
  ROOM,
  SETUP_EDITABLE_PHASES,
  TRACE_SUBMIT_MIN_INTERVAL_MS,
  traceSubmitSchema,
  type CarSetup,
} from '@tracado/shared';
import { validateTrace } from '@tracado/trackgen';
import { and, eq, inArray } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { entries, setups, traces } from '../../db/schema';
import type { AuthUser } from '../../lib/auth';
import { parse } from '../../lib/validate';
import { getGeometry } from '../tracks/service';
import { getCategory, getRaceRow, publishEntries } from './service';

async function requireEntry(
  ctx: Ctx,
  raceId: string,
  userId: string,
  statuses: ('confirmed' | 'waitlisted')[],
) {
  const [e] = await ctx.db
    .select()
    .from(entries)
    .where(and(eq(entries.raceId, raceId), eq(entries.userId, userId), inArray(entries.status, statuses)));
  if (!e) throw new AppError('NOT_REGISTERED', 'Você não está confirmado nesta corrida.');
  return e;
}

/** Envio do traçado: da inscrição até o fim da janela de traçado, validado geometricamente no servidor. */
export async function submitTrace(ctx: Ctx, raceId: string, user: AuthUser, body: unknown) {
  const reject = async (err: AppError) => {
    await ctx.hub.publish(ROOM.user(user.id), 'trace.rejected', {
      raceId,
      code: err.code,
      message: err.message,
    });
    throw err;
  };
  const input = parse(traceSubmitSchema, body);
  const race = await getRaceRow(ctx.db, raceId);
  const now = ctx.clock.now();
  // O traçado pode ser salvo desde a inscrição até o parque fechado (como o setup): o que o jogador desenha
  // antes da janela vale mesmo que ele feche a página. A janela de traçado é a última chance de ajustar.
  if (!SETUP_EDITABLE_PHASES.includes(race.status) || now >= race.setupLockAt.getTime())
    return reject(new AppError('TRACE_WINDOW_CLOSED', 'O traçado está travado (parque fechado).'));
  await requireEntry(ctx, raceId, user.id, ['confirmed']);
  if (!(await ctx.store.setNx(`trace:rl:${raceId}:${user.id}`, '1', TRACE_SUBMIT_MIN_INTERVAL_MS)))
    throw new AppError('TRACE_RATE_LIMITED', 'Aguarde 2 segundos entre envios.');
  const g = await getGeometry(ctx, race.trackVersionId);
  const v = validateTrace(g, input.points);
  if (!v.ok) return reject(new AppError(v.code!, v.message!, { indices: v.indices?.slice(0, 50) }));
  const [prev] = await ctx.db
    .select({ version: traces.version })
    .from(traces)
    .where(and(eq(traces.raceId, raceId), eq(traces.userId, user.id)));
  const version = (prev?.version ?? 0) + 1;
  await ctx.db
    .insert(traces)
    .values({ raceId, userId: user.id, points: input.points, version, submittedAt: new Date(now) })
    .onConflictDoUpdate({
      target: [traces.raceId, traces.userId],
      set: { points: input.points, version, submittedAt: new Date(now) },
    });
  await ctx.hub.publish(ROOM.user(user.id), 'trace.saved', {
    raceId,
    version,
    submittedAt: now,
    points: input.points.length,
  });
  // Primeiro traçado do piloto: atualiza o painel de quem assiste ("traçado enviado").
  if (version === 1) await publishEntries(ctx, raceId);
  return { version, submittedAt: new Date(now).toISOString() };
}

export async function getMyTrace(ctx: Ctx, raceId: string, userId: string) {
  const [t] = await ctx.db
    .select()
    .from(traces)
    .where(and(eq(traces.raceId, raceId), eq(traces.userId, userId)));
  return t ? { points: t.points, version: t.version, submittedAt: t.submittedAt.toISOString() } : null;
}

export async function saveSetup(ctx: Ctx, raceId: string, user: AuthUser, body: unknown): Promise<CarSetup> {
  const setup = parse(carSetupSchema, body);
  const race = await getRaceRow(ctx.db, raceId);
  const now = ctx.clock.now();
  if (!SETUP_EDITABLE_PHASES.includes(race.status) || now >= race.setupLockAt.getTime())
    throw new AppError('SETUP_LOCKED', 'A configuração do carro está travada (parque fechado).');
  await requireEntry(ctx, raceId, user.id, ['confirmed', 'waitlisted']);
  const cat = await getCategory(ctx.db, race.categoryId);
  const g = await getGeometry(ctx, race.trackVersionId);
  const problems = checkSetupLimits(setup, cat.config, race.laps, g.count * g.ds);
  if (problems.length) throw new AppError('SETUP_INVALID', problems[0]!, problems);
  const [had] = await ctx.db
    .select({ at: setups.updatedAt })
    .from(setups)
    .where(and(eq(setups.raceId, raceId), eq(setups.userId, user.id)));
  await ctx.db
    .insert(setups)
    .values({ raceId, userId: user.id, setup, updatedAt: new Date(now) })
    .onConflictDoUpdate({ target: [setups.raceId, setups.userId], set: { setup, updatedAt: new Date(now) } });
  if (!had) await publishEntries(ctx, raceId);
  return setup;
}

export async function getMySetup(ctx: Ctx, raceId: string, userId: string) {
  const [s] = await ctx.db
    .select()
    .from(setups)
    .where(and(eq(setups.raceId, raceId), eq(setups.userId, userId)));
  return s ? { setup: s.setup, updatedAt: s.updatedAt.toISOString() } : null;
}
