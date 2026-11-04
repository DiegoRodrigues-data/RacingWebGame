import { CAR_COLORS, CAR_MODELS, type RaceDetailDto } from '@tracado/shared';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { CAR_CSS } from '../game/assets';
import { errorMessage, put } from '../lib/api';
import { CarIcon, toast } from './ui';

export const CAR_COLOR_LABEL: Record<string, string> = {
  red: 'Vermelho',
  blue: 'Azul',
  green: 'Verde',
  yellow: 'Amarelo',
  black: 'Grafite',
};

/** Carro em destaque na "garagem": vista de cima, de lado, com holofote e número. */
export function CarShowcase({
  color,
  model,
  number,
  className = '',
  carClassName = 'h-20',
}: {
  color: string;
  model: number;
  number?: number;
  className?: string;
  carClassName?: string;
}) {
  return (
    <div
      className={clsx(
        'relative grid place-items-center overflow-hidden rounded-2xl border border-line',
        className,
      )}
      style={{
        background:
          'radial-gradient(60% 70% at 50% 45%, rgb(255 255 255 / 0.16), transparent 70%), repeating-linear-gradient(90deg, #1b2550 0 38px, #18214a 38px 76px)',
      }}
    >
      <div className="absolute inset-x-6 bottom-[18%] h-3 rounded-full bg-black/50 blur-md" aria-hidden />
      <div className="relative motion-safe:animate-[car-idle_2.4s_ease-in-out_infinite]">
        <CarIcon color={color} model={model} className={carClassName} />
        <span className="sr-only">
          Carro {CAR_COLOR_LABEL[color] ?? color}, modelo {model}
        </span>
      </div>
      {number ? (
        <span
          className="absolute left-3 top-3 grid size-10 place-items-center rounded-full border-2 border-white font-display text-lg shadow"
          style={{ background: CAR_CSS[color], color: color === 'yellow' ? '#111' : '#fff' }}
        >
          {number}
        </span>
      ) : null}
      <style>{`@keyframes car-idle { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }`}</style>
    </div>
  );
}

/**
 * Escolha de cor e modelo entre os carros livres da corrida. Os modelos mudam só o visual:
 * o desempenho vem do setup e do traçado.
 */
export function CarPicker({ race, disabled }: { race: RaceDetailDto; disabled?: boolean }) {
  const qc = useQueryClient();
  const mine = race.me?.entry ?? null;
  const [busy, setBusy] = useState(false);
  const [color, setColor] = useState(mine?.carColor ?? 'red');
  const taken = new Set(
    race.entries
      .filter((e) => e.status === 'confirmed' && e.userId !== mine?.userId)
      .map((e) => `${e.carColor}-${e.carModel}`),
  );
  const confirmed = mine?.status === 'confirmed';
  async function choose(carColor: string, carModel: number) {
    if (!confirmed || busy || disabled) return;
    if (carColor === mine?.carColor && carModel === mine?.carModel) return;
    setBusy(true);
    try {
      await put(`/races/${race.id}/car`, { carColor, carModel });
      await qc.invalidateQueries({ queryKey: ['race', race.id] });
      toast('Carro trocado 🏎️', `${CAR_COLOR_LABEL[carColor]} · modelo ${carModel}`, 'ok');
    } catch (e) {
      toast('Não deu para trocar', errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  if (!confirmed)
    return (
      <p className="text-sm text-muted">
        Quem está na fila de espera recebe um carro livre ao ser confirmado e pode trocá-lo depois.
      </p>
    );
  return (
    <div className="space-y-3">
      <div>
        <span className="label">Cor</span>
        <div role="radiogroup" aria-label="Cor do carro" className="flex flex-wrap gap-2">
          {CAR_COLORS.map((c) => {
            const free = CAR_MODELS.some((m) => !taken.has(`${c}-${m}`));
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={CAR_COLOR_LABEL[c]}
                title={free ? CAR_COLOR_LABEL[c] : `${CAR_COLOR_LABEL[c]}: todos ocupados`}
                disabled={!free || disabled}
                onClick={() => setColor(c)}
                className={clsx(
                  'size-9 rounded-full border-2 transition disabled:opacity-30',
                  color === c ? 'scale-110 border-race ring-2 ring-race/40' : 'border-white/40',
                )}
                style={{ background: CAR_CSS[c] }}
              />
            );
          })}
        </div>
      </div>
      <div>
        <span className="label">Modelo</span>
        <div role="radiogroup" aria-label="Modelo do carro" className="grid grid-cols-5 gap-1.5">
          {CAR_MODELS.map((m) => {
            const isTaken = taken.has(`${color}-${m}`);
            const current = mine?.carColor === color && mine?.carModel === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={current}
                aria-label={`Modelo ${m}${isTaken ? ' (ocupado)' : ''}`}
                title={isTaken ? 'Ocupado por outro piloto' : `Modelo ${m}`}
                disabled={isTaken || busy || disabled}
                onClick={() => void choose(color, m)}
                className={clsx(
                  'relative grid place-items-center rounded-xl border bg-night py-2 transition disabled:cursor-not-allowed',
                  current ? 'border-race bg-race/10' : 'border-line hover:border-race/60',
                  isTaken && 'opacity-35',
                )}
              >
                <CarIcon color={color} model={m} className="h-7" />
                <span className="mt-0.5 text-[10px] font-bold text-muted">{m}</span>
                {isTaken && <Lock size={12} className="absolute right-1 top-1 text-muted" />}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted">
        Cor e modelo são só visuais: todos os carros têm o mesmo desempenho, quem decide é o setup e o
        traçado.
      </p>
    </div>
  );
}
