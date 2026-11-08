import { randomUUID } from 'node:crypto';
import {
  ARCHIVE_AFTER_MS,
  canTransition,
  nextTransition,
  PHASE_LABELS,
  ROOM,
  SETUP_EDITABLE_PHASES,
  type RacePhase,
} from '@tracado/shared';
import { and, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { entries, qualifyingResults, races } from '../../db/schema';
import { notify } from '../notifications/service';
import { bumpRankingCache } from '../rankings/service';
import { getRaceRow, listEntries, raceSummaries, timelineOf, type RaceRow } from '../races/service';
import { getSettings } from '../settings/service';
import { planBotEntries, planOpenAutoRaces, runBotPlans } from '../bots/service';
import { ensureAutoRaces, ensureAutoTestRaces } from './autoRaces';
import { fillBots, fillCrazyBots, prepareBots } from './bots';
import { forgetQualiLive, qualifyingRows } from './qualiLive';
import {
  elapsedSim,
  forgetReplay,
  loadReplay,
  publishResults,
  resultRows,
  runSimulation,
  START_LIGHTS_MS,
} from './runner';

const LEADER_KEY = 'engine:leader';
const MAX_FAILURES = 3;

/**
 * Motor de fases: autoridade sobre o ciclo de vida das corridas.
 * - Cada transição é um UPDATE condicional (WHERE status = fase atual): idempotente e seguro com várias instâncias.
 * - Apenas a instância líder (chave com TTL no Store) executa o tick.
 * - Recupera automaticamente corridas cujas transições venceram enquanto o servidor estava fora.
 */
export class PhaseEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly id = randomUUID();
  private failures = new Map<string, number>();
  private playback = new Map<string, { frame: number; incidentT: number }>();
  private lastAutoRaces = -Infinity;

  constructor(private readonly ctx: Ctx) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.ctx.config.ENGINE_TICK_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async isLeader(): Promise<boolean> {
    const ttl = this.ctx.config.ENGINE_TICK_MS * 6;
    if (await this.ctx.store.setNx(LEADER_KEY, this.id, ttl)) return true;
    if ((await this.ctx.store.get(LEADER_KEY)) === this.id) {
      await this.ctx.store.set(LEADER_KEY, this.id, ttl);
      return true;
    }
    return false;
  }

  /** Configurações mudaram: confere a grade automática já no próximo tick. */
  nudgeAutoRaces() {
    this.lastAutoRaces = -Infinity;
  }

  /** Um ciclo do motor. Público para testes e para a rota de desenvolvimento. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const end = this.ctx.metrics.engineTick.startTimer();
    try {
      if (!(await this.isLeader())) return;
      for (let guard = 0; guard < 20; guard++) {
        const due = await this.dueRaces();
        if (!due.length) break;
        for (const r of due) await this.advance(r);
      }
      await this.traceWarnings();
      // Pilotos simulados cuja hora de se inscrever chegou.
      await runBotPlans(this.ctx);
      // Grade automática: uma checagem por minuto basta (cada função vê nas configurações se está ligada).
      if (this.ctx.clock.now() - this.lastAutoRaces >= 60_000) {
        this.lastAutoRaces = this.ctx.clock.now();
        const created = (await ensureAutoRaces(this.ctx)) + ((await ensureAutoTestRaces(this.ctx)) ? 1 : 0);
        // Corrida recém-criada já abre as inscrições neste mesmo ciclo.
        if (created) for (const r of await this.dueRaces()) await this.advance(r);
        // Pilotos simulados ligados com a grade já aberta: planeja as corridas que ficaram sem plano.
        await planOpenAutoRaces(this.ctx);
      }
      await this.broadcastPlayback();
    } catch (e) {
      this.recordError(e);
    } finally {
      end();
      this.running = false;
    }
  }

  private recordError(e: unknown, raceId?: string) {
    const message = e instanceof Error ? e.message : String(e);
    this.ctx.log.error({ err: e, raceId }, 'Erro no motor de fases');
    this.ctx.engineErrors.push({ at: this.ctx.clock.now(), message, ...(raceId ? { raceId } : {}) });
    if (this.ctx.engineErrors.length > 50) this.ctx.engineErrors.shift();
  }

  private async dueRaces(): Promise<RaceRow[]> {
    const now = new Date(this.ctx.clock.now());
    const archiveBefore = new Date(this.ctx.clock.now() - ARCHIVE_AFTER_MS);
    return this.ctx.db
      .select()
      .from(races)
      .where(
        or(
          and(eq(races.status, 'scheduled'), lte(races.registrationOpensAt, now)),
          and(eq(races.status, 'registration_open'), lte(races.practiceAt, now)),
          and(eq(races.status, 'practice'), lte(races.traceWindowAt, now)),
          and(eq(races.status, 'trace_window'), lte(races.setupLockAt, now)),
          and(eq(races.status, 'setup_lock'), lte(races.qualifyingAt, now)),
          and(eq(races.status, 'qualifying'), lte(races.raceAt, now)),
          and(eq(races.status, 'race'), lte(races.raceEndsAt, now)),
          and(eq(races.status, 'finished'), lte(races.raceEndsAt, archiveBefore)),
        ),
      )
      .limit(50);
  }

  /** Avança uma fase. Efeitos que precisam ser atômicos ficam na mesma transação da mudança de status. */
  async advance(race: RaceRow): Promise<void> {
    const now = this.ctx.clock.now();
    const next = nextTransition(race.status, timelineOf(race));
    if (!next || next.at > now) return;
    let to: RacePhase = next.to;
    const extra: {
      quali?: Awaited<ReturnType<typeof runSimulation>>;
      results?: Awaited<ReturnType<typeof publishResults>>;
      cancelReason?: string;
    } = {};
    // Configurações lidas fora da transação (no PGlite, ler dentro dela travaria esperando o próprio tx).
    const rules = to === 'qualifying' ? (await getSettings(this.ctx)).drivers : undefined;
    try {
      const changed = await this.ctx.db.transaction(async (tx) => {
        const cur = await getRaceRow(tx, race.id, true);
        if (cur.status !== race.status) return false;
        if (to === 'practice' || to === 'qualifying') {
          const [c] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(entries)
            .where(and(eq(entries.raceId, race.id), eq(entries.status, 'confirmed')));
          if (!c?.n) {
            to = 'cancelled';
            extra.cancelReason = 'Sem pilotos confirmados.';
          }
        }
        if (to === 'qualifying') {
          const q = await runSimulation(this.ctx, tx, cur, rules);
          if (!q) {
            to = 'cancelled';
            extra.cancelReason = 'Sem pilotos confirmados.';
          } else extra.quali = q;
        }
        if (to === 'finished') extra.results = await publishResults(this.ctx, tx, cur);
        if (!canTransition(cur.status, to)) throw new Error(`Transição inválida ${cur.status} → ${to}`);
        const upd = await tx
          .update(races)
          .set({
            status: to,
            statusChangedAt: new Date(now),
            ...(extra.cancelReason ? { cancelReason: extra.cancelReason } : {}),
          })
          .where(and(eq(races.id, race.id), eq(races.status, cur.status)))
          .returning({ id: races.id });
        return upd.length === 1;
      });
      if (!changed) return;
      this.failures.delete(race.id);
    } catch (e) {
      this.recordError(e, race.id);
      const f = (this.failures.get(race.id) ?? 0) + 1;
      this.failures.set(race.id, f);
      if (f >= MAX_FAILURES && canTransition(race.status, 'cancelled')) {
        await this.ctx.db
          .update(races)
          .set({ status: 'cancelled', cancelReason: 'Falha técnica ao processar a corrida.' })
          .where(and(eq(races.id, race.id), eq(races.status, race.status)));
        await this.afterTransition(race, 'cancelled', {});
      }
      return;
    }
    this.ctx.metrics.transitionLag.observe({ to }, Math.max(0, now - next.at) / 1000);
    // Corridas criadas depois do horário da transição (ex.: inscrições "abertas desde antes") não contam como atraso.
    if (now - next.at > 5000 && race.createdAt.getTime() < next.at)
      this.ctx.log.warn({ raceId: race.id, to, lagMs: now - next.at }, 'Transição de fase atrasada > 5 s');
    await this.afterTransition(race, to, extra);
  }

  /** Cancelamento administrativo (qualquer fase anterior à corrida). */
  async cancelRace(raceId: string, reason: string) {
    const race = await getRaceRow(this.ctx.db, raceId);
    if (!canTransition(race.status, 'cancelled'))
      throw new Error(`Não é possível cancelar uma corrida em ${race.status}.`);
    const upd = await this.ctx.db
      .update(races)
      .set({ status: 'cancelled', cancelReason: reason, statusChangedAt: new Date(this.ctx.clock.now()) })
      .where(and(eq(races.id, raceId), eq(races.status, race.status)))
      .returning({ id: races.id });
    if (upd.length) await this.afterTransition(race, 'cancelled', { cancelReason: reason });
  }

  /** Efeitos pós-commit: WebSocket, notificações, bots. */
  private async afterTransition(
    race: RaceRow,
    to: RacePhase,
    extra: {
      quali?: Awaited<ReturnType<typeof runSimulation>>;
      results?: Awaited<ReturnType<typeof publishResults>>;
      cancelReason?: string;
    },
  ) {
    const ctx = this.ctx;
    const fresh = await getRaceRow(ctx.db, race.id);
    const [summary] = await raceSummaries(ctx.db, [fresh]);
    const deadline = summary!.phaseDeadline ? Date.parse(summary!.phaseDeadline) : null;
    await ctx.hub.publish(ROOM.race(race.id), 'race.phase', {
      raceId: race.id,
      from: race.status,
      to,
      phaseDeadline: deadline,
      race: summary!,
    });
    await ctx.hub.publish(ROOM.lobby, 'lobby.race', { race: summary! });
    ctx.log.info(
      { raceId: race.id, from: race.status, to },
      `Corrida "${race.name}": ${PHASE_LABELS[race.status]} → ${PHASE_LABELS[to]}`,
    );
    const confirmedIds = async () =>
      (
        await ctx.db
          .select({ u: entries.userId })
          .from(entries)
          .where(and(eq(entries.raceId, race.id), eq(entries.status, 'confirmed')))
      ).map((r) => r.u);
    const p = { raceId: race.id, raceName: race.name };
    switch (to) {
      case 'registration_open':
        // Grupos da Corrida Maluca: bots só se quem criou liberou (completados na janela de traçado).
        if (!race.crazyGroupId) {
          // Bots por tipo de corrida (configurações do jogo).
          const st = await getSettings(ctx);
          // Grade automática com pilotos simulados: eles se inscrevem aos poucos, no lugar do preenchimento fixo.
          if (race.flags.auto && !race.flags.autoTest && st.botPool.enabled) {
            await planBotEntries(ctx, fresh);
            break;
          }
          const n = race.flags.autoTest
            ? st.testRaces.bots
            : race.flags.auto
              ? st.autoRaces.bots
              : st.adminRaceBots;
          if (n > 0) await fillBots(ctx, race.id, n);
        }
        break;
      case 'trace_window':
        if (race.crazyGroupId) await fillCrazyBots(ctx, race);
        await prepareBots(ctx, race.id);
        await ctx.hub.publish(ROOM.race(race.id), 'trace.window_opened', {
          raceId: race.id,
          deadline: fresh.setupLockAt.getTime(),
        });
        // Preparo pulado (Corrida Maluca): a janela fecha no mesmo instante, sem aviso.
        // Sem janela (padrão: o treino vai direto ao parque fechado) ou preparo pulado: sem aviso.
        if (!fresh.flags.prepSkipped && fresh.setupLockAt.getTime() > fresh.traceWindowAt.getTime())
          await notify(ctx, await confirmedIds(), 'trace_window_open', p);
        break;
      case 'setup_lock':
        await ctx.hub.publish(ROOM.race(race.id), 'trace.window_closed', { raceId: race.id });
        break;
      case 'qualifying':
        // A sessão é transmitida aos poucos (GET /races/:id/qualifying/live); o grid só sai no fim dela.
        break;
      case 'race': {
        const grid = await ctx.db
          .select({ userId: qualifyingResults.userId, position: qualifyingResults.position })
          .from(qualifyingResults)
          .where(eq(qualifyingResults.raceId, race.id));
        if (grid.length) {
          await ctx.hub.publish(ROOM.race(race.id), 'race.qualifying', {
            raceId: race.id,
            rows: await qualifyingRows(ctx, race.id),
          });
          await ctx.hub.publish(ROOM.race(race.id), 'race.entries', {
            raceId: race.id,
            entries: await listEntries(ctx.db, race.id),
          });
          await notify(
            ctx,
            grid.map((r) => ({ userId: r.userId, payload: { position: r.position } })),
            'qualifying_ready',
            p,
          );
        }
        const rep = await loadReplay(ctx, race.id);
        if (rep) {
          await ctx.hub.publish(ROOM.race(race.id), 'race.started', {
            raceId: race.id,
            startedAt: fresh.raceAt.getTime() + START_LIGHTS_MS,
            durationMs: rep.durationMs,
            frameHz: rep.frameHz,
            playbackSpeed: rep.playbackSpeed,
            cars: rep.cars,
            weatherByLap: [],
          });
          this.playback.set(race.id, { frame: 0, incidentT: -1 });
        }
        await notify(ctx, await confirmedIds(), 'race_started', p);
        break;
      }
      case 'finished': {
        this.playback.delete(race.id);
        // Corrida teste acabou: a próxima é criada já (começa `gapMin` depois da bandeirada).
        if (race.flags.autoTest) this.nudgeAutoRaces();
        await bumpRankingCache(ctx);
        await ctx.hub.publish(ROOM.race(race.id), 'race.finished', {
          raceId: race.id,
          results: await resultRows(ctx, race.id),
        });
        if (extra.results)
          await notify(
            ctx,
            extra.results.map((r) => ({
              userId: r.userId,
              payload: { position: r.position, points: r.points },
            })),
            'result_published',
            p,
          );
        break;
      }
      case 'archived':
        forgetReplay(race.id);
        forgetQualiLive(race.id);
        break;
      case 'cancelled': {
        const ids = (
          await ctx.db
            .select({ u: entries.userId })
            .from(entries)
            .where(and(eq(entries.raceId, race.id), inArray(entries.status, ['confirmed', 'waitlisted'])))
        ).map((r) => r.u);
        await notify(ctx, ids, 'race_cancelled', {
          ...p,
          reason: extra.cancelReason ?? fresh.cancelReason ?? '',
        });
        break;
      }
    }
  }

  /**
   * Aviso de 1 minuto para o parque fechado (uma vez por corrida, registrado em flags). Sem treino e sem janela de
   * traçado (padrão), a preparação é com as inscrições abertas e o aviso sai nelas.
   */
  private async traceWarnings() {
    const now = this.ctx.clock.now();
    const rows = await this.ctx.db
      .select()
      .from(races)
      .where(
        and(
          inArray(races.status, [...SETUP_EDITABLE_PHASES]),
          lte(races.setupLockAt, new Date(now + 60_000)),
          gt(races.setupLockAt, new Date(now)),
        ),
      );
    for (const r of rows) {
      if (r.flags.traceWarned) continue;
      const upd = await this.ctx.db
        .update(races)
        .set({ flags: { ...r.flags, traceWarned: true } })
        .where(and(eq(races.id, r.id), sql`not (${races.flags} ? 'traceWarned')`))
        .returning({ id: races.id });
      if (!upd.length) continue;
      const ids = (
        await this.ctx.db
          .select({ u: entries.userId })
          .from(entries)
          .where(and(eq(entries.raceId, r.id), eq(entries.status, 'confirmed')))
      ).map((x) => x.u);
      await notify(this.ctx, ids, 'trace_window_closing', { raceId: r.id, raceName: r.name });
    }
  }

  /** Transmite os frames da corrida conforme o tempo avança (sem revelar o futuro). */
  private async broadcastPlayback() {
    const now = this.ctx.clock.now();
    const live = await this.ctx.db.select().from(races).where(eq(races.status, 'race'));
    for (const r of live) {
      const rep = await loadReplay(this.ctx, r.id);
      if (!rep) continue;
      const elapsed = elapsedSim(r, rep, now);
      let st = this.playback.get(r.id);
      if (!st) {
        // Após reinício: retoma do ponto atual sem reenviar o histórico.
        const idx = rep.frames.findIndex((f) => f.t > elapsed);
        st = { frame: Math.max(0, (idx < 0 ? rep.frames.length : idx) - 1), incidentT: elapsed };
        this.playback.set(r.id, st);
      }
      let upto = st.frame;
      while (upto < rep.frames.length && rep.frames[upto]!.t <= elapsed) upto++;
      if (upto > st.frame) {
        await this.ctx.hub.publish(ROOM.race(r.id), 'race.tick', {
          raceId: r.id,
          fromFrame: st.frame,
          frames: rep.frames.slice(st.frame, upto),
        });
        st.frame = upto;
      }
      const inc = rep.incidents.filter((i) => i.t > st!.incidentT && i.t <= elapsed && i.kind !== 'overtake');
      if (inc.length)
        await this.ctx.hub.publish(ROOM.race(r.id), 'race.incident', { raceId: r.id, incidents: inc });
      st.incidentT = elapsed;
    }
  }
}
