import { DRIVER_TRAITS, driverStyle, type DriverProfile } from '@tracado/shared';
import clsx from 'clsx';

const ICON: Record<keyof DriverProfile, string> = { attack: '⚔️', defense: '🛡️', pace: '⏱️' };

/** Selo com o nome do estilo do piloto ("Agressivo", "Muralha"...). */
export function DriverStyleBadge({ value, className }: { value: DriverProfile; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border border-race/50 bg-race/10 px-2.5 py-0.5 text-xs font-bold text-race',
        className,
      )}
    >
      {driverStyle(value)}
    </span>
  );
}

/** Três controles (ataque, defesa, ritmo) de 0 a 100, com o que cada extremo faz na corrida. */
export function DriverSliders({
  value,
  onChange,
  disabled,
}: {
  value: DriverProfile;
  onChange: (v: DriverProfile) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      {DRIVER_TRAITS.map((t) => {
        const v = value[t.key];
        return (
          <label key={t.key} className="block">
            <span className="flex items-center justify-between text-sm">
              <span className="font-bold">
                {ICON[t.key]} {t.label}
              </span>
              <span className="font-mono text-muted">{v}</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={v}
              disabled={disabled}
              aria-label={t.label}
              onChange={(e) => onChange({ ...value, [t.key]: Number(e.target.value) })}
              className="mt-1 w-full accent-[#ffcc00] disabled:opacity-50"
            />
            <span className="flex justify-between gap-3 text-[11px] text-muted">
              <span className={clsx(v <= 35 && 'text-ink')}>{t.low}</span>
              <span className={clsx('text-right', v >= 65 && 'text-ink')}>{t.high}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
