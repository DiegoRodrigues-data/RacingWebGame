import { CAR_STATUS } from '@tracado/shared';
import clsx from 'clsx';
import { useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';

/** Fim da escala da barra (km/h). */
const MAX_KMH = 340;

export interface SpeedometerHandle {
  /** Chamado a cada quadro; o texto só é reescrito ~10 vezes por segundo. */
  show(kmh: number, status: number): void;
}

const UNIT: Record<number, string> = {
  [CAR_STATUS.running]: 'km/h',
  [CAR_STATUS.pit]: 'box',
  [CAR_STATUS.dnf]: 'fora',
  [CAR_STATUS.finished]: 'bandeirada',
};

/**
 * Velocímetro digital por cima da pista. O valor muda direto no DOM (sem renderizar a página a cada quadro); a
 * legenda (carro e posição) vem por props.
 */
export function Speedometer({
  ref,
  caption,
  className,
}: {
  ref: Ref<SpeedometerHandle>;
  caption?: ReactNode;
  className?: string;
}) {
  const num = useRef<HTMLSpanElement>(null);
  const unit = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  useImperativeHandle(
    ref,
    () => ({
      show(kmh, status) {
        const now = performance.now();
        if (now - last.current < 100) return;
        last.current = now;
        const out = status === CAR_STATUS.dnf;
        if (num.current) num.current.textContent = out ? '—' : String(Math.round(kmh));
        if (unit.current) {
          unit.current.textContent = UNIT[status] ?? 'km/h';
          unit.current.dataset.status = String(status);
        }
        if (bar.current) bar.current.style.transform = `scaleX(${out ? 0 : Math.min(1, kmh / MAX_KMH)})`;
      },
    }),
    [],
  );
  return (
    <div
      className={clsx(
        'pointer-events-none w-28 rounded-2xl bg-night/85 px-3 py-2 text-right shadow-xl backdrop-blur',
        className,
      )}
      aria-hidden="true"
    >
      <div className="flex items-baseline justify-end gap-1">
        <span ref={num} className="font-mono text-3xl font-bold leading-none tabular-nums">
          0
        </span>
      </div>
      <span
        ref={unit}
        className="block text-[10px] font-bold uppercase tracking-wider text-muted data-[status='1']:text-race data-[status='2']:text-hot"
      >
        km/h
      </span>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-night-3">
        <div
          ref={bar}
          className="absolute inset-0 origin-left bg-linear-to-r from-go via-race to-hot transition-transform duration-100"
          style={{ transform: 'scaleX(0)' }}
        />
      </div>
      {caption && <div className="mt-1 truncate text-[11px] text-muted">{caption}</div>}
    </div>
  );
}
