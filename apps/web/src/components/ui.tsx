import {
  formatDuration,
  PHASE_LABELS,
  type CapacityDto,
  type Level,
  type RacePhase,
  type RaceSummaryDto,
} from '@tracado/shared';
import { LEVEL_LABELS } from '@tracado/shared';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { create } from 'zustand';
import { carImage } from '../game/assets';
import { flag, LEVEL_COLOR, PHASE_COLOR } from '../lib/format';
import { useServerNow } from '../lib/realtime';

export function PhaseBadge({ phase, className }: { phase: RacePhase; className?: string }) {
  const live = ['practice', 'trace_window', 'setup_lock', 'qualifying', 'race'].includes(phase);
  return (
    <span
      className={clsx('chip', className)}
      style={{ borderColor: PHASE_COLOR[phase], color: PHASE_COLOR[phase] }}
    >
      {live && (
        <span className="size-2 animate-pulse-soft rounded-full" style={{ background: PHASE_COLOR[phase] }} />
      )}
      {PHASE_LABELS[phase]}
    </span>
  );
}

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span className="chip" style={{ borderColor: LEVEL_COLOR[level], color: LEVEL_COLOR[level] }}>
      {LEVEL_LABELS[level]}
    </span>
  );
}

/** Contagem regressiva sincronizada com o relógio do servidor. */
export function Countdown({
  to,
  className,
  urgentBelowMs = 60_000,
}: {
  to: string | number | null;
  className?: string;
  urgentBelowMs?: number;
}) {
  const now = useServerNow(250);
  if (to == null) return null;
  const left = (typeof to === 'string' ? Date.parse(to) : to) - now;
  return (
    <span
      className={clsx(
        'font-mono font-bold tabular-nums',
        left < urgentBelowMs && left > 0 && 'text-hot animate-pulse-soft',
        className,
      )}
      aria-live="off"
    >
      {formatDuration(left)}
    </span>
  );
}

export function CapacityMeter({ cap, compact }: { cap: CapacityDto; compact?: boolean }) {
  const pct = (cap.confirmed / cap.capacity) * 100;
  return (
    <div aria-label={`${cap.confirmed} de ${cap.capacity} vagas ocupadas`}>
      {!compact && (
        <div className="mb-1 flex justify-between text-xs font-semibold text-muted">
          <span>
            <b className="text-ink">{cap.confirmed}</b>/{cap.capacity} carros
          </span>
          <span>
            {cap.free > 0
              ? `${cap.free} vaga${cap.free > 1 ? 's' : ''}`
              : cap.waitlisted
                ? `fila: ${cap.waitlisted}/${cap.waitlistMax}`
                : 'lotada'}
          </span>
        </div>
      )}
      <div className="h-2.5 overflow-hidden rounded-full bg-night-3">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500',
            cap.free === 0 ? 'race-stripes animate-stripes' : 'bg-go',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const PHASE_STEPS: RacePhase[] = [
  'registration_open',
  'practice',
  'trace_window',
  'setup_lock',
  'qualifying',
  'race',
  'finished',
];
/** Treino ou janela de traçado com duração zero (o padrão): a fase passa direto e some das telas. */
export function isEmptyPhase(p: RacePhase, t: RaceSummaryDto['timeline']): boolean {
  if (p === 'practice') return t.traceWindowAt <= t.practiceAt;
  if (p === 'trace_window') return t.setupLockAt <= t.traceWindowAt;
  return false;
}

export function PhaseTimeline({ race }: { race: RaceSummaryDto }) {
  const steps = PHASE_STEPS.filter((p) => race.status === p || !isEmptyPhase(p, race.timeline));
  const idx = steps.indexOf(race.status === 'archived' ? 'finished' : race.status);
  const times: Partial<Record<RacePhase, string | null>> = {
    registration_open: race.timeline.registrationOpensAt,
    practice: race.timeline.practiceAt,
    trace_window: race.timeline.traceWindowAt,
    setup_lock: race.timeline.setupLockAt,
    qualifying: race.timeline.qualifyingAt,
    race: race.timeline.raceAt,
    finished: race.timeline.raceEndsAt,
  };
  return (
    <ol
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label="Fases da corrida"
    >
      {steps.map((p, i) => (
        <li key={p} className="min-w-0">
          <div
            className={clsx(
              'h-1.5 rounded-full',
              i < idx ? 'bg-go' : i === idx ? 'bg-race animate-pulse-soft' : 'bg-night-3',
            )}
          />
          <div
            className={clsx(
              'mt-1 truncate text-[10px] font-bold uppercase sm:text-[11px]',
              i === idx ? 'text-race' : 'text-muted',
            )}
          >
            {PHASE_LABELS[p]}
          </div>
          <div className="hidden text-[10px] text-muted/80 sm:block">
            {times[p]
              ? new Date(times[p]!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : '—'}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Carro deitado (sprite vertical girado), com caixa de layout já na orientação horizontal. */
export function CarIcon({
  color,
  model,
  className = 'h-8',
}: {
  color: string;
  model: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={clsx('relative inline-block shrink-0', className)}
      style={{ aspectRatio: '131 / 71' }}
    >
      <img
        src={carImage(color, model)}
        alt=""
        className="absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 -rotate-90"
        style={{ width: '54.2%', height: '184.5%' }}
      />
    </span>
  );
}

export function Flag({ country }: { country: string }) {
  return (
    <span role="img" aria-label={country}>
      {flag(country)}
    </span>
  );
}

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <div className="grid place-items-center p-10" role="status">
      <div className="size-10 animate-spin rounded-full border-4 border-night-3 border-t-race" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Empty({
  title,
  children,
  icon = '🏁',
}: {
  title: string;
  children?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="card grid place-items-center gap-2 py-10 text-center">
      <div className="text-4xl" aria-hidden>
        {icon}
      </div>
      <div className="font-display text-lg">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-xl bg-night-3/70', className)} />;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode }[];
}) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-2xl border border-line bg-night-2 p-1">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            'rounded-xl px-3 py-1.5 text-sm font-bold transition',
            value === it.value ? 'bg-race text-night' : 'text-muted hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  disabled,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-xl border px-3 py-2 text-sm font-bold transition disabled:opacity-40',
            value === o.value
              ? 'border-race bg-race/15 text-race'
              : 'border-line bg-night text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Toasts
interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: 'info' | 'ok' | 'warn' | 'error';
}
export const useToasts = create<{
  items: Toast[];
  push(t: Omit<Toast, 'id'>): void;
  remove(id: number): void;
}>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), 5000);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));
export const toast = (title: string, body?: string, tone: Toast['tone'] = 'info') =>
  useToasts.getState().push({ title, ...(body ? { body } : {}), tone });

export function Toaster() {
  const { items, remove } = useToasts();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end"
      aria-live="polite"
    >
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => remove(t.id)}
          className={clsx(
            'pointer-events-auto w-full max-w-sm animate-pop rounded-2xl border-l-4 bg-night-2 p-3 text-left shadow-2xl',
            t.tone === 'ok'
              ? 'border-go'
              : t.tone === 'warn'
                ? 'border-race'
                : t.tone === 'error'
                  ? 'border-hot'
                  : 'border-sky',
          )}
        >
          <div className="font-bold">{t.title}</div>
          {t.body && <div className="text-sm text-muted">{t.body}</div>}
        </button>
      ))}
    </div>
  );
}
