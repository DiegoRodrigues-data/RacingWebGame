import { DRIVER_TRAITS, driverStyle, type DriverProfile } from '@tracado/shared';
import clsx from 'clsx';

const ICON: Record<keyof DriverProfile, string> = { attack: '⚔️', defense: '🛡️', pace: '⏱️' };

/** Selo com o nome do estilo do piloto ("Agressivo", "Muralha"...). */
export function DriverStyleBadge({ value, className }: { value: DriverProfile; className?: string }) {
  return (
    <span className={clsx('chip border-race/50 bg-race/10 font-bold text-race', className)}>
      {driverStyle(value)}
    </span>
  );
}

/** Controle de 0 a 100 com o rótulo, o valor e o que cada extremo significa (o lado mais perto fica em destaque). */
export function RangeRow({
  label,
  value,
  shown = String(value),
  onChange,
  low,
  high,
  disabled,
}: {
  label: string;
  value: number;
  /** Valor exibido ao lado do rótulo (padrão: o número). */
  shown?: string;
  onChange: (v: number) => void;
  low: string;
  high: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm">
        <span className="font-bold">{label}</span>
        <span className="font-mono text-muted">{shown}</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[#ffcc00] disabled:opacity-50"
      />
      <span className="flex justify-between gap-3 text-[11px] text-muted">
        <span className={clsx(value <= 35 && 'text-ink')}>{low}</span>
        <span className={clsx('text-right', value >= 65 && 'text-ink')}>{high}</span>
      </span>
    </label>
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
      {DRIVER_TRAITS.map((t) => (
        <RangeRow
          key={t.key}
          label={`${ICON[t.key]} ${t.label}`}
          value={value[t.key]}
          low={t.low}
          high={t.high}
          disabled={disabled}
          onChange={(v) => onChange({ ...value, [t.key]: v })}
        />
      ))}
    </div>
  );
}
