import {
  AppError,
  CAR_COLORS,
  CAR_MODELS,
  carChoiceSchema,
  LATE_ENTRY_PHASES,
  MAX_OVERLAPPING_ENTRIES,
  meetsLevel,
  SETUP_EDITABLE_PHASES,
  WITHDRAW_PHASES,
  type EntryStatus,
} from '@tracado/shared';
import { and, asc, desc, eq, gt, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import type { Tx } from '../../db/client';
import { botPersonas, crazyMembers, entries, profiles, races, users } from '../../db/schema';
import type { AuthUser } from '../../lib/auth';
import { parse } from '../../lib/validate';
import { notify } from '../notifications/service';
import { broadcastRace, capacityOf, getCategory, getRaceRow, type RaceRow } from './service';

const RACE_WINDOW_AFTER_MS = 30 * 60_000;

export async function assignCar(tx: Tx, raceId: string, preferred: string) {
  const used = await tx
    .select({ c: entries.carColor, m: entries.carModel, n: entries.carNumber })
    .from(entries)
    .where(and(eq(entries.raceId, raceId), eq(entries.status, 'confirmed')));
  const taken = new Set(used.map((u) => `${u.c}-${u.m}`));
  const nums = new Set(used.map((u) => u.n));
  const colors = [preferred, ...CAR_COLORS.filter((c) => c !== preferred)];
  let carColor = preferred,
    carModel: number = 1;
  outer: for (const c of colors)
    for (const m of CAR_MODELS)
      if (!taken.has(`${c}-${m}`)) {
        carColor = c;
        carModel = m;
        break outer;
      }
  let carNumber = 1;
  while (nums.has(carNumber)) carNumber++;
  return { carColor, carModel, carNumber };
}

async function checkEligibility(ctx: Ctx, tx: Tx, race: RaceRow, user: AuthUser) {
  const cat = await getCategory(tx, race.categoryId);
  const [p] = await tx.select().from(profiles).where(eq(profiles.userId, user.id));
  const [u] = await tx
    .select({ verified: users.emailVerified, guest: users.isGuest })
    .from(users)
    .where(eq(users.id, user.id));
  if (!p || !u) throw new AppError('UNAUTHORIZED');
  await checkCrazyAccess(tx, race, user.id, u.guest);
  // Grupo da Corrida Maluca: a categoria só empresta pista e clima, não exige nível.
  if (race.crazyGroupId) return p;
  const req = cat.config.entryRequirement;
  if (!meetsLevel(p.level, req.minLevel) || p.careerRaces < req.minRaces)
    throw new AppError(
      'INELIGIBLE_LEVEL',
      `Esta categoria exige nível ${req.minLevel} e ${req.minRaces} corrida(s) disputada(s).`,
    );
  if (race.ranked && ctx.config.REQUIRE_VERIFIED_EMAIL_FOR_RANKED && !u.verified)
    throw new AppError('EMAIL_NOT_VERIFIED', 'Confirme seu e-mail para disputar corridas ranqueadas.');
  return p;
}

export async function checkScheduleConflict(tx: Tx, race: RaceRow, userId: string) {
  const start = race.practiceAt;
  const end = new Date((race.raceEndsAt ?? race.raceAt).getTime() + RACE_WINDOW_AFTER_MS);
  const rows = await tx
    .select({ id: races.id })
    .from(entries)
    .innerJoin(races, eq(races.id, entries.raceId))
    .where(
      and(
        eq(entries.userId, userId),
        inArray(entries.status, ['confirmed', 'waitlisted']),
        ne(races.id, race.id),
        notInArray(races.status, ['finished', 'archived', 'cancelled']),
        lt(races.practiceAt, end),
        gt(sql`coalesce(${races.raceEndsAt}, ${races.raceAt}) + interval '30 minutes'`, start),
      ),
    );
  if (rows.length >= MAX_OVERLAPPING_ENTRIES)
    throw new AppError('SCHEDULE_CONFLICT', 'Você já está inscrito em uma corrida no mesmo horário.');
}

/** Corrida de grupo fechado: só membros se inscrevem; convidados só correm nos grupos. */
async function checkCrazyAccess(tx: Tx, race: RaceRow, userId: string, guest: boolean) {
  if (race.crazyGroupId) {
    const [m] = await tx
      .select({ u: crazyMembers.userId })
      .from(crazyMembers)
      .where(and(eq(crazyMembers.groupId, race.crazyGroupId), eq(crazyMembers.userId, userId)));
    if (!m) throw new AppError('FORBIDDEN', 'Esta corrida é de um grupo fechado. Peça o link de convite.');
  } else if (guest)
    throw new AppError(
      'FORBIDDEN',
      'Convidados correm só na Corrida Maluca. Crie sua conta para disputar as corridas abertas.',
    );
}

/** Vaga liberada com as inscrições abertas: o primeiro da fila de espera é confirmado. */
export async function promoteNext(tx: Tx, raceId: string, now: number): Promise<string | null> {
  const [next] = await tx
    .select({ e: entries, color: profiles.carColor })
    .from(entries)
    .innerJoin(profiles, eq(profiles.userId, entries.userId))
    .where(and(eq(entries.raceId, raceId), eq(entries.status, 'waitlisted')))
    .orderBy(asc(entries.createdAt))
    .limit(1);
  if (!next) return null;
  const car = await assignCar(tx, raceId, next.color);
  await tx
    .update(entries)
    .set({ status: 'confirmed', ...car, confirmedAt: new Date(now), updatedAt: new Date(now) })
    .where(eq(entries.id, next.e.id));
  return next.e.userId;
}

/** Tira do grid o piloto simulado (com persona) que entrou por último. Devolve se liberou uma vaga. */
async function yieldBotSeat(tx: Tx, raceId: string, now: number): Promise<boolean> {
  const [bot] = await tx
    .select({ id: entries.id })
    .from(entries)
    .innerJoin(botPersonas, eq(botPersonas.userId, entries.userId))
    .where(and(eq(entries.raceId, raceId), eq(entries.status, 'confirmed')))
    .orderBy(desc(entries.confirmedAt))
    .limit(1);
  if (!bot) return false;
  await tx
    .update(entries)
    .set({ status: 'cancelled', updatedAt: new Date(now) })
    .where(eq(entries.id, bot.id));
  return true;
}

export interface RegisterResult {
  status: EntryStatus;
  waitlistPosition: number | null;
}

/**
 * Inscrição. Vale com as inscrições abertas e, se houver vaga no grid, também no treino e na janela de traçado
 * (inscrição tardia, sem fila de espera) até o parque fechado.
 * A linha da corrida é travada (SELECT ... FOR UPDATE) e há um mutex por corrida no processo,
 * então duas tentativas simultâneas pela última vaga são serializadas: a primeira confirma, a segunda vai para a fila.
 */
/** A conta de administração só administra: não corre nem entra em grupos. */
export function assertPlayer(user: AuthUser) {
  if (user.roles.includes('admin'))
    throw new AppError('FORBIDDEN', 'A conta de administração não corre. Use uma conta de jogador.');
}

export async function register(ctx: Ctx, raceId: string, user: AuthUser): Promise<RegisterResult> {
  assertPlayer(user);
  const res = await ctx.mutex
    .run(`race:${raceId}`, () =>
      ctx.db.transaction(async (tx) => {
        const now = ctx.clock.now();
        const race = await getRaceRow(tx, raceId, true);
        const late = LATE_ENTRY_PHASES.includes(race.status) && now < race.setupLockAt.getTime();
        if (
          !late &&
          (race.status !== 'registration_open' ||
            now >= race.practiceAt.getTime() ||
            now < race.registrationOpensAt.getTime())
        )
          throw new AppError('REGISTRATION_CLOSED', 'As inscrições desta corrida não estão abertas.');
        const profile = await checkEligibility(ctx, tx, race, user);
        const [existing] = await tx
          .select()
          .from(entries)
          .where(and(eq(entries.raceId, raceId), eq(entries.userId, user.id)));
        if (existing && (existing.status === 'confirmed' || existing.status === 'waitlisted'))
          throw new AppError('ALREADY_REGISTERED', 'Você já está inscrito nesta corrida.');
        await checkScheduleConflict(tx, race, user.id);
        const cap = await capacityOf(tx, race);
        // Grid cheio: um piloto simulado cede a vaga (o último que entrou), como se tivesse desistido.
        if (cap.confirmed >= race.capacity && (await yieldBotSeat(tx, raceId, now))) cap.confirmed--;
        let status: EntryStatus;
        let car = { carColor: profile.carColor, carModel: 0, carNumber: 0 };
        if (cap.confirmed < race.capacity) {
          status = 'confirmed';
          car = await assignCar(tx, raceId, profile.carColor);
        } else if (late) throw new AppError('RACE_FULL', 'O grid já está completo.');
        else if (cap.waitlisted < race.waitlistMax) status = 'waitlisted';
        else throw new AppError('RACE_FULL', 'Corrida lotada e fila de espera completa.');
        const values = {
          status,
          ...car,
          gridSlot: null,
          confirmedAt: status === 'confirmed' ? new Date(now) : null,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        };
        if (existing) await tx.update(entries).set(values).where(eq(entries.id, existing.id));
        else await tx.insert(entries).values({ raceId, userId: user.id, ...values });
        return {
          status,
          waitlistPosition: status === 'waitlisted' ? cap.waitlisted + 1 : null,
          raceName: race.name,
        };
      }),
    )
    .catch((e: unknown) => {
      ctx.metrics.entries.inc({ result: e instanceof AppError ? e.code : 'error' });
      throw e;
    });
  ctx.metrics.entries.inc({ result: res.status });
  await notify(ctx, [user.id], res.status === 'confirmed' ? 'entry_confirmed' : 'entry_waitlisted', {
    raceId,
    raceName: res.raceName,
    position: res.waitlistPosition,
  });
  await broadcastRace(ctx, raceId);
  return { status: res.status, waitlistPosition: res.waitlistPosition };
}

/** Cancelamento antes do treino libera a vaga e promove o primeiro da fila; depois disso vira desistência. */
export async function cancel(
  ctx: Ctx,
  raceId: string,
  user: AuthUser,
): Promise<{ status: EntryStatus; promoted: string | null }> {
  const res = await ctx.mutex.run(`race:${raceId}`, () =>
    ctx.db.transaction(async (tx) => {
      const now = ctx.clock.now();
      const race = await getRaceRow(tx, raceId, true);
      const [e] = await tx
        .select()
        .from(entries)
        .where(and(eq(entries.raceId, raceId), eq(entries.userId, user.id)));
      if (!e || (e.status !== 'confirmed' && e.status !== 'waitlisted'))
        throw new AppError('NOT_REGISTERED', 'Você não está inscrito nesta corrida.');
      if (!WITHDRAW_PHASES.includes(race.status) || now >= race.setupLockAt.getTime())
        throw new AppError('REGISTRATION_CLOSED', 'Não é mais possível desistir desta corrida.');
      let promoted: string | null = null;
      if (race.status === 'registration_open') {
        await tx
          .update(entries)
          .set({ status: 'cancelled', updatedAt: new Date(now) })
          .where(eq(entries.id, e.id));
        if (e.status === 'confirmed') promoted = await promoteNext(tx, raceId, now);
        return { status: 'cancelled' as EntryStatus, promoted, raceName: race.name };
      }
      await tx
        .update(entries)
        .set({ status: 'withdrawn', updatedAt: new Date(now) })
        .where(eq(entries.id, e.id));
      return { status: 'withdrawn' as EntryStatus, promoted, raceName: race.name };
    }),
  );
  if (res.promoted) await notify(ctx, [res.promoted], 'entry_promoted', { raceId, raceName: res.raceName });
  await broadcastRace(ctx, raceId);
  return { status: res.status, promoted: res.promoted };
}

/**
 * Troca de carro (cor e modelo) enquanto o setup ainda pode mudar. Só para inscrições confirmadas:
 * quem está na fila recebe um carro livre ao ser promovido. A combinação é única entre os confirmados.
 */
export async function chooseCar(
  ctx: Ctx,
  raceId: string,
  user: AuthUser,
  body: unknown,
): Promise<{ carColor: string; carModel: number; carNumber: number }> {
  const choice = parse(carChoiceSchema, body);
  const res = await ctx.mutex.run(`race:${raceId}`, () =>
    ctx.db.transaction(async (tx) => {
      const now = ctx.clock.now();
      const race = await getRaceRow(tx, raceId, true);
      if (!SETUP_EDITABLE_PHASES.includes(race.status) || now >= race.setupLockAt.getTime())
        throw new AppError('SETUP_LOCKED', 'O carro não pode mais ser trocado (parque fechado).');
      const [e] = await tx
        .select()
        .from(entries)
        .where(and(eq(entries.raceId, raceId), eq(entries.userId, user.id)));
      if (!e || (e.status !== 'confirmed' && e.status !== 'waitlisted'))
        throw new AppError('NOT_REGISTERED', 'Você não está inscrito nesta corrida.');
      if (e.status !== 'confirmed')
        throw new AppError('CONFLICT', 'Quem está na fila de espera escolhe o carro ao ser confirmado.');
      if (e.carColor === choice.carColor && e.carModel === choice.carModel) return e;
      const [taken] = await tx
        .select({ id: entries.id })
        .from(entries)
        .where(
          and(
            eq(entries.raceId, raceId),
            eq(entries.status, 'confirmed'),
            eq(entries.carColor, choice.carColor),
            eq(entries.carModel, choice.carModel),
            ne(entries.id, e.id),
          ),
        );
      if (taken) throw new AppError('CAR_TAKEN', 'Outro piloto já está com este carro nesta corrida.');
      const [row] = await tx
        .update(entries)
        .set({ ...choice, updatedAt: new Date(now) })
        .where(eq(entries.id, e.id))
        .returning();
      return row!;
    }),
  );
  await broadcastRace(ctx, raceId);
  return { carColor: res.carColor, carModel: res.carModel, carNumber: res.carNumber };
}
