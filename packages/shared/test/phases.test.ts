import { describe, expect, it } from 'vitest';
import { buildTimeline, canTransition, duePhase, nextTransition, TRACE_WINDOW_MS } from '../src';

const t0 = Date.UTC(2026, 10, 3, 12, 0, 0);
const tl = buildTimeline({
  startAt: t0,
  registrationLeadMs: 3600_000,
  practiceMs: 600_000,
  setupLockMs: 30_000,
  qualifyingMs: 60_000,
  // Corrida com janela de traçado (formato antigo, ainda suportado).
  traceWindowMs: 120_000,
});

describe('linha do tempo da corrida', () => {
  it('sem janela de traçado por padrão: o treino vai direto ao parque fechado', () => {
    expect(TRACE_WINDOW_MS).toBe(0);
    const semJanela = buildTimeline({
      startAt: t0,
      registrationLeadMs: 60_000,
      practiceMs: 120_000,
      setupLockMs: 30_000,
      qualifyingMs: 60_000,
    });
    expect(semJanela.setupLockAt).toBe(semJanela.traceWindowAt);
    expect(semJanela.setupLockAt - semJanela.practiceAt).toBe(120_000);
    expect(tl.setupLockAt - tl.traceWindowAt).toBe(120_000);
  });
  it('as fases são estritamente ordenadas', () => {
    const seq = [
      tl.registrationOpensAt,
      tl.practiceAt,
      tl.traceWindowAt,
      tl.setupLockAt,
      tl.qualifyingAt,
      tl.raceAt,
    ];
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
  });
  it('nextTransition segue a sequência e para em race sem raceEndsAt', () => {
    expect(nextTransition('scheduled', tl)).toEqual({ to: 'registration_open', at: tl.registrationOpensAt });
    expect(nextTransition('qualifying', tl)).toEqual({ to: 'race', at: tl.raceAt });
    expect(nextTransition('race', tl)).toBeNull();
    expect(nextTransition('race', { ...tl, raceEndsAt: tl.raceAt + 1000 })).toEqual({
      to: 'finished',
      at: tl.raceAt + 1000,
    });
    expect(nextTransition('cancelled', tl)).toBeNull();
  });
  it('duePhase aplica transições vencidas em cadeia (recuperação após queda)', () => {
    expect(duePhase('scheduled', tl, tl.registrationOpensAt - 1)).toBe('scheduled');
    expect(duePhase('scheduled', tl, tl.traceWindowAt + 1)).toBe('trace_window');
    expect(duePhase('scheduled', tl, tl.raceAt + 999_999)).toBe('race');
  });
  it('transições inválidas são recusadas', () => {
    expect(canTransition('scheduled', 'race')).toBe(false);
    expect(canTransition('race', 'cancelled')).toBe(false);
    expect(canTransition('practice', 'trace_window')).toBe(true);
    expect(canTransition('finished', 'archived')).toBe(true);
  });
});
