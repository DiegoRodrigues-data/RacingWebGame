import { MIN_PIT_STOPS } from './constants';
import type { CarSetup, CategoryConfig, Tyre } from './schemas';

/** Verifica o setup contra os limites da categoria. Retorna mensagens de violação (vazio = válido). */
export function checkSetupLimits(setup: CarSetup, cfg: CategoryConfig, laps: number): string[] {
  const out: string[] = [];
  const lim = cfg.setupLimits;
  const tyres = [setup.tyre, ...setup.pitStops.map((p) => p.tyre)];
  for (const t of tyres)
    if (!lim.allowedTyres.includes(t)) out.push(`Pneu ${t} não permitido nesta categoria.`);
  if (setup.aero < lim.aero.min || setup.aero > lim.aero.max)
    out.push(`Aerodinâmica deve ficar entre ${lim.aero.min} e ${lim.aero.max}.`);
  if (!lim.allowedEngines.includes(setup.engine)) out.push(`Mapa de motor ${setup.engine} não permitido.`);
  if (setup.pitStops.length < MIN_PIT_STOPS)
    out.push(`Parada obrigatória: programe ao menos ${MIN_PIT_STOPS} parada(s) nos boxes.`);
  if (setup.pitStops.length > lim.maxPitStops) out.push(`No máximo ${lim.maxPitStops} parada(s).`);
  for (const p of setup.pitStops)
    if (p.lap >= laps) out.push(`Parada na volta ${p.lap} é inválida (corrida de ${laps} voltas).`);
  return [...new Set(out)];
}

/**
 * Paradas padrão para quem não programou nenhuma: cumpre a parada obrigatória
 * com paradas espaçadas igualmente, trocando para um composto seco permitido.
 */
export function defaultPitStops(laps: number, allowedTyres: readonly Tyre[], stops = MIN_PIT_STOPS) {
  const dry = allowedTyres.filter((t) => t !== 'wet');
  const tyre: Tyre =
    (['hard', 'medium'] as const).find((t) => dry.includes(t)) ?? dry[0] ?? allowedTyres[0] ?? 'medium';
  return Array.from({ length: stops }, (_, k) => ({
    lap: Math.max(1, Math.min(laps - 1, Math.round((laps * (k + 1)) / (stops + 1)))),
    tyre,
  }));
}
