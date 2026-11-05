import type { TrackGeometry } from '@tracado/trackgen';
import { useMemo } from 'react';
import { CAR_CSS } from '../game/assets';

/** Cores do piso no minimapa (as mesmas da pista desenhada). */
const SURFACE: Record<string, string> = { asphalt: '#a6c9cb', dirt: '#bb8044', sand: '#ecdcb8' };

/**
 * Minimapa em SVG: contorno da pista colorido pelo piso (asfalto, terra, areia), setores e posição dos carros
 * (atualizado pela classificação, ~4 Hz).
 */
export function Minimap({
  g,
  cars,
  highlight,
}: {
  g: TrackGeometry;
  cars: { id: string; x: number; y: number; color: string; status: number }[];
  highlight?: string | null;
}) {
  const { path, view, sectors, runs } = useMemo(() => {
    const pad = 30;
    const b = g.bounds;
    const d = [];
    for (let i = 0; i < g.count; i += 2)
      d.push(`${i === 0 ? 'M' : 'L'}${g.points[i * 2]!.toFixed(0)},${g.points[i * 2 + 1]!.toFixed(0)}`);
    // Trechos de terra e areia por cima do asfalto.
    const runs: { d: string; color: string }[] = [];
    const pt = (i: number) => {
      const k = i % g.count;
      return `${g.points[k * 2]!.toFixed(0)},${g.points[k * 2 + 1]!.toFixed(0)}`;
    };
    let i = 0;
    while (i < g.count) {
      const t = g.terrain[i] ?? 'asphalt';
      let j = i;
      while (j + 1 < g.count && (g.terrain[j + 1] ?? 'asphalt') === t) j++;
      if (t !== 'asphalt') {
        const seg = [];
        for (let k = i; k <= j + 1; k += 2) seg.push(`${k === i ? 'M' : 'L'}${pt(k)}`);
        seg.push(`L${pt(j + 1)}`);
        runs.push({ d: seg.join(' '), color: SURFACE[t] ?? SURFACE.asphalt! });
      }
      i = j + 1;
    }
    return {
      runs,
      path: d.join(' ') + 'Z',
      view: `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`,
      sectors: g.sectors.map((s) => ({ x: g.points[s * 2]!, y: g.points[s * 2 + 1]! })),
    };
  }, [g]);
  const r = Math.max(g.bounds.maxX - g.bounds.minX, g.bounds.maxY - g.bounds.minY) / 45;
  return (
    <svg viewBox={view} className="h-full w-full" role="img" aria-label="Minimapa da corrida">
      <path
        d={path}
        fill="none"
        stroke={SURFACE.asphalt}
        strokeWidth={r * 0.9}
        strokeLinejoin="round"
        opacity={0.9}
      />
      {runs.map((run, k) => (
        <path
          key={k}
          d={run.d}
          fill="none"
          stroke={run.color}
          strokeWidth={r * 0.9}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {sectors.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={r * 0.5}
          fill={i === 0 ? '#fff' : i === 1 ? '#ffcc00' : '#4cc9f0'}
        />
      ))}
      {cars
        .filter((c) => c.status !== 2)
        .map((c) => (
          <circle
            key={c.id}
            cx={c.x}
            cy={c.y}
            r={c.id === highlight ? r * 1.1 : r * 0.75}
            fill={CAR_CSS[c.color] ?? '#fff'}
            stroke={c.id === highlight ? '#ffcc00' : '#fff'}
            strokeWidth={r * 0.25}
          />
        ))}
    </svg>
  );
}

/** Camada de chuva sobre a pista (CSS), intensidade conforme o clima. Respeita "reduzir animações". */
export function RainOverlay({ intensity }: { intensity: 0 | 1 | 2 }) {
  if (!intensity) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
      style={{ background: `rgba(20,30,60,${intensity === 2 ? 0.28 : 0.15})` }}
    >
      <div
        className="absolute -inset-[50%] motion-safe:animate-[rain_0.5s_linear_infinite]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(105deg, rgba(200,220,255,0.35) 0 1px, transparent 1px 14px)',
          backgroundSize: intensity === 2 ? '14px 40px' : '28px 60px',
          opacity: intensity === 2 ? 0.8 : 0.45,
        }}
      />
      <style>{`@keyframes rain { from { transform: translate(0,0); } to { transform: translate(-10px, 40px); } }`}</style>
    </div>
  );
}
