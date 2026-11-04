import type { CarSetup, CategoryConfig } from './schemas';

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
  if (setup.pitStops.length > lim.maxPitStops) out.push(`No máximo ${lim.maxPitStops} parada(s).`);
  for (const p of setup.pitStops)
    if (p.lap >= laps) out.push(`Parada na volta ${p.lap} é inválida (corrida de ${laps} voltas).`);
  return [...new Set(out)];
}
