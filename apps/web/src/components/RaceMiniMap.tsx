import {
  ROOM,
  type LiveCarDto,
  type RaceSummaryDto,
  type ReplayFrame,
  type ServerEvents,
} from '@tracado/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { decode } from '../game/playback';
import { get } from '../lib/api';
import { useGeometry } from '../lib/queries';
import { realtime, useRoom } from '../lib/realtime';
import { BIOME_MINI_BG, Minimap } from './Minimap';

interface TailDto {
  startedAt: number;
  playbackSpeed: number;
  cars: LiveCarDto[];
  fromFrame: number;
  frames: ReplayFrame[];
}
type Dot = { id: string; x: number; y: number; color: string; status: number };

/** Atraso de exibição (ms reais) para sempre haver um frame à frente para interpolar. */
const LIVE_DELAY_MS = 1500;
/** Frames guardados por card: só o suficiente para interpolar (o card não volta no tempo). */
const KEEP = 24;

/** Posição dos carros de uma corrida ao vivo: a cauda do replay + os ticks do WebSocket. */
function useLiveDots(raceId: string | null): Dot[] {
  const tail = useQuery({
    queryKey: ['replay-tail', raceId],
    queryFn: () => get<TailDto>(`/races/${raceId}/replay?tail=8`),
    enabled: !!raceId,
    staleTime: 0,
  });
  const frames = useRef<ReplayFrame[]>([]);
  const push = (list: ReplayFrame[]) => {
    const f = frames.current;
    for (const fr of list) if (!f.length || fr.t > f[f.length - 1]!.t) f.push(fr);
    if (f.length > KEEP) f.splice(0, f.length - KEEP);
  };
  useEffect(() => {
    if (tail.data) push(tail.data.frames);
  }, [tail.data]);
  useRoom(raceId ? ROOM.race(raceId) : null, (env) => {
    if (env.type === 'race.tick') push((env.payload as ServerEvents['race.tick']).frames);
  });
  const [dots, setDots] = useState<Dot[]>([]);
  useEffect(() => {
    const meta = tail.data;
    if (!meta) return;
    const n = meta.cars.length;
    const id = window.setInterval(() => {
      const f = frames.current;
      if (!f.length) return;
      const t = (realtime.clock.now() - LIVE_DELAY_MS - meta.startedAt) * meta.playbackSpeed;
      let b = f.findIndex((x) => x.t >= t);
      if (b < 0) b = f.length - 1;
      const a = Math.max(0, b - 1);
      const sa = decode(f[a]!, n),
        sb = decode(f[b]!, n);
      const k = Math.max(0, Math.min(1, (t - f[a]!.t) / Math.max(1, f[b]!.t - f[a]!.t)));
      setDots(
        meta.cars.map((c, i) => ({
          id: c.userId,
          x: sa[i]!.x + (sb[i]!.x - sa[i]!.x) * k,
          y: sa[i]!.y + (sb[i]!.y - sa[i]!.y) * k,
          color: c.carColor,
          status: sb[i]!.status,
        })),
      );
    }, 200);
    return () => clearInterval(id);
  }, [tail.data]);
  return dots;
}

/** Mini mapa do card: o desenho da pista e, se a corrida estiver no ar, os carros correndo. */
export function RaceMiniMap({ race, className = '' }: { race: RaceSummaryDto; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const geo = useGeometry(visible ? race.track.versionId : undefined);
  const live = race.status === 'race';
  const dots = useLiveDots(visible && live ? race.id : null);
  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-xl border border-line ${className}`}
      style={{
        backgroundColor: BIOME_MINI_BG[race.track.biome] ?? BIOME_MINI_BG.grass,
        backgroundImage: 'repeating-linear-gradient(90deg, rgb(0 0 0 / 0.06) 0 12px, transparent 12px 24px)',
      }}
    >
      {geo.data ? (
        <div className="absolute inset-1.5">
          <Minimap g={geo.data} cars={dots} />
        </div>
      ) : (
        <div className="absolute inset-0 animate-pulse bg-night-3/40" />
      )}
      {live && (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-hot px-2 py-0.5 text-[10px] font-bold text-white">
          <span className="size-1.5 animate-pulse-soft rounded-full bg-white" /> AO VIVO
          {dots.length > 0 && ` · ${dots.filter((d) => d.status !== 2).length} carros`}
        </span>
      )}
    </div>
  );
}
