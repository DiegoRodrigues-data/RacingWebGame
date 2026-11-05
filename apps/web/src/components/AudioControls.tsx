import clsx from 'clsx';
import { Music, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { audio, useAudioPrefs } from '../game/audio';

/** Botão de som no topo: liga/desliga e volumes da música e dos efeitos (salvos neste aparelho). */
export function AudioControls() {
  const { music, sfx, muted, set } = useAudioPrefs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const silent = muted || (music === 0 && sfx === 0);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="rounded-xl p-2 hover:bg-night-3"
        aria-label="Som"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          audio.unlock();
          setOpen((o) => !o);
        }}
      >
        {silent ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Volume"
          className="absolute right-0 top-11 z-50 w-64 space-y-3 rounded-2xl border border-line bg-night-2 p-3 shadow-xl"
        >
          <label className="flex items-center justify-between gap-2 text-sm font-bold">
            Som do jogo
            <input
              type="checkbox"
              checked={!muted}
              onChange={(e) => set({ muted: !e.target.checked })}
              className="size-4 accent-[#ffcc00]"
            />
          </label>
          <Slider
            label="Música"
            icon={<Music size={14} />}
            value={music}
            disabled={muted}
            onChange={(v) => set({ music: v })}
          />
          <Slider
            label="Efeitos (motor, largada, box)"
            icon={<Volume2 size={14} />}
            value={sfx}
            disabled={muted}
            onChange={(v) => set({ sfx: v })}
            onRelease={() => audio.blip()}
          />
          <p className="text-[11px] text-muted">
            Trilha original no estilo 16 bits. Toca na classificação e na corrida ao vivo.
          </p>
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  icon,
  value,
  disabled,
  onChange,
  onRelease,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  onRelease?: () => void;
}) {
  return (
    <label className={clsx('block', disabled && 'opacity-40')}>
      <span className="mb-1 flex items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-1">
          {icon} {label}
        </span>
        <span className="font-mono">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
        className="w-full accent-[#ffcc00]"
      />
    </label>
  );
}
