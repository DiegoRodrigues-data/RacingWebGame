import {
  checkSetupLimits,
  formatLapTime,
  MIN_PIT_STOPS,
  TYRE_LABELS,
  type CarSetup,
  type CategoryConfig,
  type RaceDetailDto,
  type Tyre,
} from '@tracado/shared';
import {
  COEF,
  engineRaceRisk,
  estimateLap,
  optimalPressure,
  tyreLife,
  WETNESS,
  type TyreLife,
} from '@tracado/sim';
import { offsetsToTrace, type TrackGeometry } from '@tracado/trackgen';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Lock, Minus, Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { CarPicker, CarShowcase } from '../../components/CarPicker';
import { toast } from '../../components/ui';
import { errorMessage, put } from '../../lib/api';
import { TERRAIN_LABEL, TYRE_COLOR, TYRE_SHORT, WEATHER_ICON, WEATHER_LABEL } from '../../lib/format';
import { useServerNow } from '../../lib/realtime';
import { draftKey, isSetupEditable, saveDraft, type PracticeInfo } from './common';

const TYRES: Tyre[] = ['soft', 'medium', 'hard', 'wet'];
/** Estrelas (1–3) lidas dos coeficientes do modelo: aderência no seco. A duração vem da estimativa em voltas. */
const TYRE_STARS: Record<Tyre, { grip: number; note: string }> = {
  soft: { grip: 3, note: 'Mais rápido, gasta primeiro' },
  medium: { grip: 2, note: 'Equilíbrio' },
  hard: { grip: 1, note: 'Aguenta stints longos' },
  wet: { grip: 1, note: 'Só brilha na chuva' },
};
const lapsLabel = (n: number) => `${n} ${n === 1 ? 'volta' : 'voltas'}`;
/** "~12 voltas (10–14)": média e faixa da variação sorteada; avisa quando aguenta a corrida inteira. */
function LifeText({ life, laps }: { life: TyreLife; laps: number }) {
  return (
    <span
      className="block text-[11px] text-muted"
      title={`Rende em média ${lapsLabel(life.avg)} antes de perder rendimento; com a variação do clima, de ${life.min} a ${life.max}. A corrida tem ${lapsLabel(laps)}.`}
    >
      <span className={clsx('font-bold', life.min >= laps ? 'text-go' : 'text-ink')}>~{life.avg}</span> voltas{' '}
      <span className="whitespace-nowrap">
        ({life.min}–{life.max})
      </span>
    </span>
  );
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp01 = (v: number, worst: number, best: number) =>
  best === worst ? 0.5 : clamp01((v - worst) / (best - worst));

// ------------------------------------------------------------------ Peças de interface

function Stars({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted" title={`${label}: ${n} de 3`}>
      <span className="w-14">{label}</span>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? 'text-race' : 'text-line'}>
          ★
        </span>
      ))}
    </span>
  );
}

function TyreBadge({ tyre, size = 34 }: { tyre: Tyre; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-display text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `radial-gradient(circle, #222 0 44%, ${TYRE_COLOR[tyre]} 45% 58%, #111 59%)`,
        boxShadow: 'inset 0 0 0 2px #000',
      }}
    >
      {TYRE_SHORT[tyre]}
    </span>
  );
}

function ChoiceCards<T extends string>({
  label,
  value,
  onChange,
  options,
  cols = 3,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; icon: ReactNode; title: string; hint: string; disabled?: boolean; tag?: string }[];
  cols?: 2 | 3 | 4;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(
        'grid gap-2',
        cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2',
      )}
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={clsx(
              'relative flex flex-col items-center gap-1 rounded-2xl border p-2.5 text-center transition disabled:cursor-not-allowed disabled:opacity-35',
              on
                ? 'border-race bg-race/10 shadow-[0_0_0_3px_rgb(255_204_0/0.18)]'
                : 'border-line bg-night hover:-translate-y-0.5 hover:border-race/50',
            )}
          >
            {o.tag && (
              <span className="absolute -top-2 right-2 rounded-full bg-go px-1.5 text-[10px] font-bold text-night">
                {o.tag}
              </span>
            )}
            {o.disabled && <Lock size={12} className="absolute left-2 top-2 text-muted" />}
            <span className="text-2xl leading-none">{o.icon}</span>
            <span className={clsx('text-sm font-bold', on ? 'text-race' : 'text-ink')}>{o.title}</span>
            <span className="text-[11px] leading-tight text-muted">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Seletor em "blocos" (estilo barra de nível) para valores inteiros. */
function Pips({
  label,
  value,
  min,
  max,
  onChange,
  left,
  right,
  disabledFrom,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  left: string;
  right: string;
  /** Valores fora de [min,max] da categoria ficam bloqueados. */
  disabledFrom?: { min: number; max: number };
}) {
  const all = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div>
      <div className="label flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-race">{value}</span>
      </div>
      <div role="radiogroup" aria-label={label} className="flex h-9 items-end gap-1">
        {all.map((v) => {
          const blocked = disabledFrom && (v < disabledFrom.min || v > disabledFrom.max);
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={v === value}
              aria-label={`${label} ${v}`}
              disabled={blocked}
              onClick={() => onChange(v)}
              className={clsx(
                'flex-1 rounded-md border transition disabled:cursor-not-allowed disabled:opacity-25',
                v === value
                  ? 'border-race bg-race'
                  : v < value
                    ? 'border-race/40 bg-race/35'
                    : 'border-line bg-night hover:border-race/50',
              )}
              style={{ height: `${55 + (45 * (v - min)) / Math.max(1, max - min)}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

/** Manômetro de calibragem com faixa ideal para o clima previsto. */
function PressureGauge({
  label,
  value,
  onChange,
  ideal,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  ideal: number;
}) {
  const pct = (v: number) => ((v - 18) / 10) * 100;
  const off = Math.abs(value - ideal);
  const tone = off <= 1 ? 'text-go' : off <= 2.5 ? 'text-race' : 'text-hot';
  const set = (v: number) => onChange(Math.max(18, Math.min(28, Math.round(v * 2) / 2)));
  return (
    <div className="rounded-2xl border border-line bg-night p-3">
      <div className="label flex justify-between">
        <span>{label}</span>
        <span className={clsx('font-mono', tone)}>{value.toFixed(1)} psi</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-ghost size-9 shrink-0 !p-0"
          aria-label={`Diminuir ${label}`}
          onClick={() => set(value - 0.5)}
          disabled={value <= 18}
        >
          <Minus size={16} />
        </button>
        <div className="relative h-3 flex-1 rounded-full bg-night-3">
          <div
            className="absolute inset-y-0 rounded-full bg-go/40"
            style={{ left: `${pct(ideal - 1)}%`, width: `${pct(ideal + 1) - pct(ideal - 1)}%` }}
            title={`Faixa ideal para o clima previsto: ${(ideal - 1).toFixed(1)}–${(ideal + 1).toFixed(1)} psi`}
          />
          <div
            className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-race shadow transition-[left]"
            style={{ left: `${pct(value)}%` }}
          />
          <input
            type="range"
            min={18}
            max={28}
            step={0.5}
            value={value}
            aria-label={label}
            onChange={(e) => set(Number(e.target.value))}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
        </div>
        <button
          type="button"
          className="btn-ghost size-9 shrink-0 !p-0"
          aria-label={`Aumentar ${label}`}
          onClick={() => set(value + 0.5)}
          disabled={value >= 28}
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>mais aderência</span>
        <span>ideal ≈ {ideal.toFixed(1)}</span>
        <span>menos atrito</span>
      </div>
    </div>
  );
}

function StatBar({ label, value, hint, icon }: { label: string; value: number; hint: string; icon: string }) {
  const pct = Math.round(clamp01(value) * 100);
  const color = pct >= 70 ? 'bg-go' : pct >= 40 ? 'bg-race' : 'bg-hot';
  return (
    <div title={hint}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold">
          {icon} {label}
        </span>
        <span className="font-mono text-muted">{pct}</span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-night-3">
        <div
          className={clsx('h-full rounded-full transition-[width] duration-300', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <section className="card space-y-4">
      <h3 className="flex items-center gap-2 font-display text-lg">
        <span className="grid size-8 place-items-center rounded-xl bg-night-3 text-base">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ Aba

export function SetupTab({
  race,
  g,
  offsets,
  setup,
  setSetup,
  practice,
}: {
  race: RaceDetailDto;
  g: TrackGeometry;
  offsets: Float64Array;
  setup: CarSetup;
  setSetup: (s: CarSetup) => void;
  practice: PracticeInfo;
}) {
  const qc = useQueryClient();
  const now = useServerNow(1000);
  const editable = isSetupEditable(race.status, race.timeline.setupLockAt, now);
  const status = race.me?.entry?.status;
  const guest = status !== 'confirmed' && status !== 'waitlisted';
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lim = practice.limits;
  const laps = practice.laps;
  const temp = practice.weather.temperature;
  const trace = useMemo(() => offsetsToTrace(offsets, 256), [offsets]);
  const update = (patch: Partial<CarSetup>) => {
    if (!editable) return;
    const next = { ...setup, ...patch };
    setSetup(next);
    setDirty(true);
    saveDraft(draftKey(race.id, 'setup'), next);
  };
  const problems = checkSetupLimits(setup, { setupLimits: lim } as CategoryConfig, laps);
  const dry = useMemo(() => estimateLap(g, setup, trace, 'dry', temp, laps), [g, setup, trace, temp, laps]);
  const wet = useMemo(() => estimateLap(g, setup, trace, 'rain', temp, laps), [g, setup, trace, temp, laps]);

  // Extremos possíveis nesta pista para normalizar as barras da ficha técnica.
  const range = useMemo(() => {
    const base: CarSetup = { ...setup, pitStops: [], weatherBet: 'mixed' };
    const fast: CarSetup = {
      ...base,
      aero: lim.aero.min,
      engine: 'power',
      gearing: 10,
      tyrePressure: { front: 28, rear: 28 },
    };
    const slow: CarSetup = {
      ...base,
      aero: lim.aero.max,
      engine: 'economy',
      gearing: 1,
      tyrePressure: { front: 18, rear: 18 },
    };
    const grip: CarSetup = {
      ...base,
      tyre: 'soft',
      aero: lim.aero.max,
      tyrePressure: { front: 23, rear: 23 },
      weatherBet: 'dry',
    };
    const slip: CarSetup = {
      ...base,
      tyre: 'hard',
      aero: lim.aero.min,
      tyrePressure: { front: 28, rear: 18 },
      weatherBet: 'wet',
    };
    const rainBest: CarSetup = {
      ...base,
      tyre: 'wet',
      aero: lim.aero.max,
      weatherBet: 'wet',
      tyrePressure: { front: 21, rear: 21 },
    };
    const rainWorst: CarSetup = {
      ...base,
      tyre: 'soft',
      aero: lim.aero.min,
      weatherBet: 'dry',
      tyrePressure: { front: 28, rear: 28 },
    };
    const est = (s: CarSetup, w: 'dry' | 'rain') => estimateLap(g, s, trace, w, temp, laps);
    return {
      top: [est(slow, 'dry').topSpeedKmh, est(fast, 'dry').topSpeedKmh] as const,
      corner: [cornerSpeed(est(slip, 'dry').profile), cornerSpeed(est(grip, 'dry').profile)] as const,
      rain: [est(rainWorst, 'rain').lapTimeMs, est(rainBest, 'rain').lapTimeMs] as const,
    };
  }, [g, trace, temp, laps, lim.aero.min, lim.aero.max, setup]);

  // Desgaste por volta de cada composto com este carro, no clima previsto, e quantas voltas cada um rende.
  const wearPerLap = useMemo(() => {
    const out = {} as Record<Tyre, number>;
    for (const t of TYRES)
      out[t] = estimateLap(g, { ...setup, tyre: t }, trace, practice.weather.base, temp, laps).wearPerLap;
    return out;
  }, [g, setup, trace, practice.weather.base, temp, laps]);
  const life = useMemo(() => {
    const out = {} as Record<Tyre, TyreLife>;
    for (const t of TYRES) out[t] = tyreLife(wearPerLap[t], practice.weather);
    return out;
  }, [wearPerLap, practice.weather]);
  const spreadPct = Math.round(life.soft.spread * 100);

  // Desgaste ao longo da estratégia: média e o pior caso da variação sorteada.
  const stint = useMemo(() => {
    const wearOf = (t: Tyre) => wearPerLap[t];
    const out: { lap: number; wear: number; tyre: Tyre; pit: boolean }[] = [];
    let wear = 0,
      tyre = setup.tyre;
    for (let lap = 1; lap <= laps; lap++) {
      wear += wearOf(tyre);
      const stop = setup.pitStops.find((p) => p.lap === lap);
      out.push({ lap, wear, tyre, pit: !!stop });
      if (stop) {
        tyre = stop.tyre;
        wear = 0;
      }
    }
    return out;
  }, [setup, laps, wearPerLap]);
  const maxWear = Math.max(...stint.map((s) => s.wear));
  const worst = 1 + life.soft.spread;
  const cliffLap = stint.find((s) => s.wear > COEF.cliffAt)?.lap ?? null;
  const riskLap = stint.find((s) => s.wear * worst > COEF.cliffAt)?.lap ?? null;
  const engine = engineRaceRisk(setup, laps);
  const finishOdds = 1 - engine.risk;
  const stats = {
    speed: lerp01(dry.topSpeedKmh, range.top[0], range.top[1]),
    corners: lerp01(cornerSpeed(dry.profile), range.corner[0], range.corner[1]),
    tyres: clamp01((1 - maxWear) / 0.5),
    reliability: clamp01((finishOdds - 0.4) / 0.6),
    rain: lerp01(wet.lapTimeMs, range.rain[0], range.rain[1]),
  };
  const rating = Math.round(
    40 +
      59 *
        ((stats.speed +
          stats.corners +
          stats.tyres * 1.5 +
          stats.reliability +
          stats.rain * practice.weather.rainChance * 2) /
          (4.5 + practice.weather.rainChance * 2)),
  );

  const ideal = optimalPressure({ wetness: WETNESS[practice.weather.base], temperature: temp });
  const trackTerrain = race.track.terrain === 'mixed' ? null : race.track.terrain;
  const forecastBet =
    practice.weather.rainChance >= 0.6 ? 'wet' : practice.weather.rainChance >= 0.3 ? 'mixed' : 'dry';

  // Dicas do engenheiro: checklist honesto a partir do próprio modelo.
  const tips: { ok: boolean; text: string }[] = [
    cliffLap
      ? {
          ok: false,
          text: `Na média, o pneu passa do limite na volta ${cliffLap}. Pare antes ou use um composto mais duro.`,
        }
      : riskLap
        ? {
            ok: false,
            text: `Com azar no desgaste (±${spreadPct}% neste clima), o pneu pode passar do limite a partir da volta ${riskLap}.`,
          }
        : { ok: true, text: 'Nenhum stint passa do limite de desgaste, nem no pior caso.' },
    Math.abs((setup.tyrePressure.front + setup.tyrePressure.rear) / 2 - ideal) <= 1
      ? { ok: true, text: 'Calibragem na faixa ideal para o clima previsto.' }
      : {
          ok: false,
          text: `Calibragem longe do ideal (≈ ${ideal.toFixed(1)} psi): perde aderência e gasta pneu.`,
        },
    trackTerrain && setup.terrainPrep !== trackTerrain
      ? {
          ok: false,
          text: `A pista é de ${TERRAIN_LABEL[trackTerrain].toLowerCase()}; a suspensão está para ${TERRAIN_LABEL[setup.terrainPrep].toLowerCase()}.`,
        }
      : { ok: true, text: 'Suspensão preparada para o terreno.' },
    setup.engine === 'power'
      ? {
          ok: false,
          text: `Motor em potência: termina ${Math.round(engine.wearAtEnd * 100)}% gasto, ${Math.round(engine.risk * 100)}% de chance de quebrar em ${laps} voltas.`,
        }
      : {
          ok: true,
          text: `Motor confiável: termina ${Math.round(engine.wearAtEnd * 100)}% gasto, ${Math.round(finishOdds * 100)}% de chance de terminar sem quebra.`,
        },
  ];

  async function save() {
    setSaving(true);
    try {
      await put(`/races/${race.id}/setup`, setup);
      setDirty(false);
      toast('Setup salvo ✅', undefined, 'ok');
      void qc.invalidateQueries({ queryKey: ['race', race.id] });
    } catch (e) {
      toast('Setup recusado', errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  const tyreCards = (value: Tyre, onChange: (t: Tyre) => void, label: string) => (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {TYRES.map((t) => {
        const on = value === t;
        const allowed = lim.allowedTyres.includes(t);
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!allowed}
            onClick={() => onChange(t)}
            className={clsx(
              'relative flex items-center gap-2 rounded-2xl border p-2 text-left transition disabled:cursor-not-allowed disabled:opacity-35',
              on
                ? 'border-race bg-race/10 shadow-[0_0_0_3px_rgb(255_204_0/0.18)]'
                : 'border-line bg-night hover:border-race/50',
            )}
          >
            {!allowed && <Lock size={12} className="absolute right-2 top-2 text-muted" />}
            <TyreBadge tyre={t} />
            <span className="min-w-0">
              <span className={clsx('block text-sm font-bold', on && 'text-race')}>{TYRE_LABELS[t]}</span>
              <Stars n={TYRE_STARS[t].grip} label={t === 'wet' ? 'Chuva' : 'Aderência'} />
              <LifeText life={life[t]} laps={laps} />
            </span>
          </button>
        );
      })}
    </div>
  );

  const entry = race.me?.entry;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {!editable && (
          <p className="card border-violet text-sm">
            🔒 Parque fechado: carro e setup estão travados para a classificação e a corrida.
          </p>
        )}

        <section className="card grid gap-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg">🏁 Garagem</h3>
              <span
                className="rounded-xl bg-night px-2 py-1 text-center"
                title="Nota geral do setup nesta pista"
              >
                <span className="block text-[10px] font-bold uppercase text-muted">Nota</span>
                <span className="font-display text-2xl text-race">{rating}</span>
              </span>
            </div>
            <CarShowcase
              color={entry?.carColor ?? 'red'}
              model={entry?.carModel || 1}
              number={entry?.carNumber || undefined}
              className="aspect-[16/9]"
              carClassName="h-24 sm:h-28"
            />
            <div className="space-y-2">
              <StatBar
                icon="🚀"
                label="Velocidade final"
                value={stats.speed}
                hint={`${dry.topSpeedKmh} km/h no seco`}
              />
              <StatBar
                icon="🌀"
                label="Curvas"
                value={stats.corners}
                hint="Velocidade média nas curvas mais lentas"
              />
              <StatBar
                icon="🛞"
                label="Pneus"
                value={stats.tyres}
                hint={`Desgaste máximo previsto: ${Math.round(maxWear * 100)}%`}
              />
              <StatBar
                icon="🔧"
                label="Confiabilidade"
                value={stats.reliability}
                hint={`${Math.round(finishOdds * 100)}% de chance de terminar sem quebra; motor termina ${Math.round(engine.wearAtEnd * 100)}% gasto`}
              />
              <StatBar
                icon="🌧️"
                label="Chuva"
                value={stats.rain}
                hint={`Volta na chuva: ${formatLapTime(wet.lapTimeMs)}`}
              />
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="font-display text-lg">🎨 Seu carro</h3>
            <CarPicker race={race} disabled={!editable} />
          </div>
        </section>

        <fieldset disabled={!editable} className="space-y-4 disabled:opacity-80">
          <Section title="Pneus de largada" icon="🛞">
            {tyreCards(setup.tyre, (t) => update({ tyre: t }), 'Composto de largada')}
            <p className="text-xs text-muted">
              {TYRE_STARS[setup.tyre].note}. Voltas que cada composto rende antes de perder rendimento, com
              este carro e o clima previsto. O desgaste varia até ±{spreadPct}% a cada jogo de pneus
              {spreadPct > 10 ? ' (clima instável, mais incerteza)' : ''}: planeje com margem.
            </p>
          </Section>

          <Section title="Estratégia de boxes" icon="🔧">
            <div>
              <div className="label flex justify-between">
                <span>Stints e desgaste</span>
                <span className="normal-case tracking-normal">
                  parada obrigatória · máx. {lim.maxPitStops}
                </span>
              </div>
              <div
                className="flex h-10 overflow-hidden rounded-xl border border-line"
                role="img"
                aria-label="Stints da corrida"
              >
                {stint.map((s) => (
                  <div
                    key={s.lap}
                    className={clsx('relative flex-1', s.pit && 'border-r-2 border-white')}
                    style={{
                      background:
                        s.wear > COEF.cliffAt
                          ? '#ff5a5a'
                          : s.wear * worst > COEF.cliffAt
                            ? 'repeating-linear-gradient(135deg, #ffb020 0 4px, #ff5a5a 4px 8px)'
                            : TYRE_COLOR[s.tyre],
                      opacity: 0.35 + 0.65 * (1 - Math.min(1, s.wear)),
                    }}
                    title={`Volta ${s.lap}: ${TYRE_LABELS[s.tyre]}, desgaste ${Math.round(s.wear * 100)}% na média (até ${Math.round(s.wear * worst * 100)}% com azar)`}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted">
                <span>volta 1</span>
                <span>listrado = pode passar do limite · vermelho = passa na média</span>
                <span>volta {laps}</span>
              </div>
            </div>
            <ol className="space-y-2">
              {setup.pitStops.map((p, i) => {
                const prev = setup.pitStops[i - 1]?.lap ?? 0;
                const next = setup.pitStops[i + 1]?.lap ?? laps;
                const setLap = (lap: number) =>
                  update({
                    pitStops: setup.pitStops.map((x, k) =>
                      k === i ? { ...x, lap: Math.max(prev + 1, Math.min(next - 1, lap)) } : x,
                    ),
                  });
                return (
                  <li key={i} className="space-y-2 rounded-2xl border border-line bg-night p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display">Parada {i + 1}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="btn-ghost size-8 !p-0"
                          aria-label="Volta anterior"
                          onClick={() => setLap(p.lap - 1)}
                          disabled={p.lap <= prev + 1}
                        >
                          <Minus size={14} />
                        </button>
                        <label className="flex items-center gap-1 text-sm">
                          <span className="text-muted">volta</span>
                          <input
                            type="number"
                            min={prev + 1}
                            max={next - 1}
                            value={p.lap}
                            className="input !w-16 !px-2 !py-1 text-center font-mono"
                            onChange={(e) => setLap(Number(e.target.value))}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn-ghost size-8 !p-0"
                          aria-label="Volta seguinte"
                          onClick={() => setLap(p.lap + 1)}
                          disabled={p.lap >= next - 1}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="ml-auto inline-flex items-center gap-1 text-sm text-hot disabled:opacity-30"
                        disabled={setup.pitStops.length <= MIN_PIT_STOPS}
                        title={
                          setup.pitStops.length <= MIN_PIT_STOPS
                            ? 'A parada nos boxes é obrigatória'
                            : 'Remover parada'
                        }
                        onClick={() => update({ pitStops: setup.pitStops.filter((_, k) => k !== i) })}
                      >
                        <Trash2 size={14} /> remover
                      </button>
                    </div>
                    <div
                      role="radiogroup"
                      aria-label={`Composto da parada ${i + 1}`}
                      className="flex flex-wrap gap-1.5"
                    >
                      {TYRES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          role="radio"
                          aria-checked={p.tyre === t}
                          disabled={!lim.allowedTyres.includes(t)}
                          onClick={() =>
                            update({
                              pitStops: setup.pitStops.map((x, k) => (k === i ? { ...x, tyre: t } : x)),
                            })
                          }
                          className={clsx(
                            'flex items-center gap-1.5 rounded-xl border px-2 py-1 text-xs font-bold disabled:opacity-30',
                            p.tyre === t
                              ? 'border-race bg-race/10 text-race'
                              : 'border-line text-muted hover:text-ink',
                          )}
                        >
                          <TyreBadge tyre={t} size={20} /> {TYRE_LABELS[t]}
                          <span className="font-normal text-muted">~{life[t].avg}v</span>
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              className="btn-ghost !py-1.5"
              disabled={
                setup.pitStops.length >= lim.maxPitStops ||
                laps < 2 ||
                (setup.pitStops.at(-1)?.lap ?? 0) >= laps - 1
              }
              onClick={() => {
                const last = setup.pitStops.at(-1)?.lap ?? 0;
                update({
                  pitStops: [
                    ...setup.pitStops,
                    {
                      lap: Math.min(laps - 1, last + Math.max(1, Math.floor((laps - last) / 2))),
                      tyre: lim.allowedTyres.includes('medium') ? 'medium' : lim.allowedTyres[0]!,
                    },
                  ],
                });
              }}
            >
              <Plus size={16} /> adicionar parada
            </button>
          </Section>

          <Section title="Calibragem" icon="🎯">
            <div className="grid gap-3 sm:grid-cols-2">
              <PressureGauge
                label="Dianteira"
                value={setup.tyrePressure.front}
                ideal={ideal}
                onChange={(v) => update({ tyrePressure: { ...setup.tyrePressure, front: v } })}
              />
              <PressureGauge
                label="Traseira"
                value={setup.tyrePressure.rear}
                ideal={ideal}
                onChange={(v) => update({ tyrePressure: { ...setup.tyrePressure, rear: v } })}
              />
            </div>
          </Section>

          <Section title="Carro" icon="🏎️">
            <Pips
              label="Asa (pressão aerodinâmica)"
              value={setup.aero}
              min={1}
              max={10}
              disabledFrom={lim.aero}
              onChange={(v) => update({ aero: v })}
              left="🚀 reta veloz"
              right="curvas coladas 🌀"
            />
            <Pips
              label="Câmbio"
              value={setup.gearing}
              min={1}
              max={10}
              onChange={(v) => update({ gearing: v })}
              left="⚡ arrancada"
              right="velocidade final 🏁"
            />
            <div>
              <span className="label">Mapa do motor</span>
              <ChoiceCards
                label="Mapa do motor"
                value={setup.engine}
                onChange={(v) => update({ engine: v })}
                options={[
                  {
                    value: 'economy',
                    icon: '🍃',
                    title: 'Econômico',
                    hint: 'Poupa pneus e motor, nunca quebra',
                    disabled: !lim.allowedEngines.includes('economy'),
                  },
                  {
                    value: 'balanced',
                    icon: '⚖️',
                    title: 'Equilibrado',
                    hint: 'Meio-termo',
                    disabled: !lim.allowedEngines.includes('balanced'),
                  },
                  {
                    value: 'power',
                    icon: '🔥',
                    title: 'Potência',
                    hint: 'Mais rápido, gasta o motor e pode quebrar',
                    disabled: !lim.allowedEngines.includes('power'),
                  },
                ]}
              />
            </div>
          </Section>

          <Section title="Pista e clima" icon="🌦️">
            <div>
              <span className="label">Suspensão para o terreno</span>
              <ChoiceCards
                label="Preparação para o terreno"
                value={setup.terrainPrep}
                onChange={(v) => update({ terrainPrep: v })}
                options={[
                  {
                    value: 'asphalt',
                    icon: '🛣️',
                    title: 'Asfalto',
                    hint: 'Baixa e firme',
                    ...(trackTerrain === 'asphalt' ? { tag: 'pista' } : {}),
                  },
                  {
                    value: 'dirt',
                    icon: '🟫',
                    title: 'Terra',
                    hint: 'Mais curso',
                    ...(trackTerrain === 'dirt' ? { tag: 'pista' } : {}),
                  },
                  {
                    value: 'sand',
                    icon: '🏜️',
                    title: 'Areia',
                    hint: 'Alta e macia',
                    ...(trackTerrain === 'sand' ? { tag: 'pista' } : {}),
                  },
                ]}
              />
            </div>
            <div>
              <span className="label">Aposta de clima</span>
              <ChoiceCards
                label="Aposta de clima"
                value={setup.weatherBet}
                onChange={(v) => update({ weatherBet: v })}
                options={[
                  {
                    value: 'dry',
                    icon: '☀️',
                    title: 'Seco',
                    hint: 'Ganha no seco, sofre na chuva',
                    ...(forecastBet === 'dry' ? { tag: 'previsão' } : {}),
                  },
                  {
                    value: 'mixed',
                    icon: '⛅',
                    title: 'Misto',
                    hint: 'Sem ganho, sem susto',
                    ...(forecastBet === 'mixed' ? { tag: 'previsão' } : {}),
                  },
                  {
                    value: 'wet',
                    icon: '🌧️',
                    title: 'Chuva',
                    hint: 'Ganha na chuva, perde no seco',
                    ...(forecastBet === 'wet' ? { tag: 'previsão' } : {}),
                  },
                ]}
              />
              <p className="mt-2 text-xs text-muted">
                Previsão: {WEATHER_ICON[practice.weather.base]} {WEATHER_LABEL[practice.weather.base]}, chance
                de chuva {Math.round(practice.weather.rainChance * 100)}%, {temp}°C.
              </p>
            </div>
          </Section>
        </fieldset>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div className="card">
          <div className="label">Volta estimada</div>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="font-mono text-3xl font-bold">{formatLapTime(dry.lapTimeMs)}</div>
              <div className="text-xs text-muted">no seco · {formatLapTime(wet.lapTimeMs)} na chuva</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-lg font-bold">{dry.topSpeedKmh}</div>
              <div className="text-xs text-muted">km/h máx.</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="label">Engenheiro de pista</div>
          <ul className="space-y-1.5 text-sm">
            {tips.map((t) => (
              <li key={t.text} className="flex gap-2">
                <span aria-hidden>{t.ok ? '✅' : '⚠️'}</span>
                <span className={t.ok ? 'text-muted' : 'text-ink'}>{t.text}</span>
              </li>
            ))}
          </ul>
        </div>
        {problems.length > 0 && (
          <div className="card border-hot text-sm text-hot">
            {problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        )}
        {guest ? (
          <p className="card text-center text-sm text-muted">
            Treino livre: o setup fica neste aparelho. Inscreva-se para levá-lo à corrida.
          </p>
        ) : (
          <>
            <button
              className="btn-primary w-full !py-3 text-base"
              disabled={!editable || saving || problems.length > 0}
              onClick={save}
            >
              <Save size={18} />
              {saving ? 'Salvando…' : dirty || !race.me?.hasSetup ? 'Salvar setup' : 'Setup salvo ✓'}
            </button>
            {dirty && (
              <p className="text-center text-xs text-race">Alterações ainda não salvas no servidor.</p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/** Média dos 25% trechos mais lentos da volta (m/s): mede o carro nas curvas. */
function cornerSpeed(v: Float64Array): number {
  const sorted = Array.from(v).sort((a, b) => a - b);
  const n = Math.max(1, Math.floor(sorted.length / 4));
  let s = 0;
  for (let i = 0; i < n; i++) s += sorted[i]!;
  return s / n;
}
