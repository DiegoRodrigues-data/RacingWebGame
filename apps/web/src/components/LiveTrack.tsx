import {
  ROOM,
  type LiveCarDto,
  type RaceSummaryDto,
  type ReplayFrame,
  type ServerEvents,
} from '@tracado/shared';
import type { TrackGeometry } from '@tracado/trackgen';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FrameBuffer } from '../game/playback';
import type { TrackScene } from '../game/scene';
import { get } from '../lib/api';
import { realtime, useRoom } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Minimap } from './Minimap';
import { CameraControls, TrackCanvas } from './TrackCanvas';

interface TailDto {
  startedAt: number;
  playbackSpeed: number;
  cars: LiveCarDto[];
  fromFrame: number;
  frames: ReplayFrame[];
}

/** Atraso de exibição (ms reais), igual ao da tela ao vivo, para sempre haver um frame à frente. */
const LIVE_DELAY_MS = 1500;
/** Frames guardados: o mapa só mostra o presente, não volta no tempo. */
const KEEP = 60;

/**
 * Pista com a corrida em andamento, como na tela ao vivo: carros andando, câmera seguindo o líder (ou o seu
 * carro) e minimapa. Usa a cauda do replay e os ticks do WebSocket, sem baixar o replay inteiro.
 */
export function LiveTrack({
  race,
  geometry,
  className = '',
}: {
  race: RaceSummaryDto;
  geometry: TrackGeometry | undefined;
  className?: string;
}) {
  const me = useSession((s) => s.me);
  const [scene, setScene] = useState<TrackScene | null>(null);
  const tail = useQuery({
    queryKey: ['replay-tail', race.id, 'detail'],
    queryFn: () => get<TailDto>(`/races/${race.id}/replay?tail=12`),
    staleTime: 0,
  });
  const buffer = useRef(new FrameBuffer());
  const low = useRef(0);
  const put = (from: number, frames: ReplayFrame[]) => {
    const f = buffer.current.frames;
    buffer.current.put(from, frames);
    const keepFrom = from + frames.length - KEEP;
    for (; low.current < keepFrom; low.current++) delete f[low.current];
  };
  useEffect(() => {
    if (tail.data) {
      low.current = tail.data.fromFrame;
      put(tail.data.fromFrame, tail.data.frames);
    }
  }, [tail.data]);
  useRoom(ROOM.race(race.id), (env) => {
    if (env.type === 'race.tick') {
      const p = env.payload as ServerEvents['race.tick'];
      put(p.fromFrame, p.frames);
    }
  });

  const [follow, setFollow] = useState<string | null>(null);
  const [dots, setDots] = useState<{ id: string; x: number; y: number; color: string; status: number }[]>([]);
  const zoomed = useRef(false);
  useEffect(() => {
    const meta = tail.data;
    if (!scene || !meta) return;
    const cars = meta.cars;
    let acc = 0;
    scene.onUserCamera = () => setFollow(null);
    scene.onFrame = (dt) => {
      const t = (realtime.clock.now() - LIVE_DELAY_MS - meta.startedAt) * meta.playbackSpeed;
      const st = buffer.current.sample(Math.max(0, t), cars.length);
      if (!st) return;
      scene.setCars(
        cars.map((c, i) => ({
          id: c.userId,
          x: st[i]!.x,
          y: st[i]!.y,
          heading: st[i]!.heading,
          color: c.carColor,
          model: c.carModel,
          number: c.carNumber,
          status: st[i]!.status,
          highlight: c.userId === me?.id,
        })),
      );
      acc += dt;
      if (acc > 250) {
        acc = 0;
        setDots(
          cars.map((c, i) => ({
            id: c.userId,
            x: st[i]!.x,
            y: st[i]!.y,
            color: c.carColor,
            status: st[i]!.status,
          })),
        );
        // Primeira amostra: segue o seu carro ou o líder, de perto, para ver os carros.
        if (!zoomed.current) {
          zoomed.current = true;
          const mine = me && cars.some((c) => c.userId === me.id) ? me.id : null;
          const leader = cars
            .map((c, i) => ({ id: c.userId, p: st[i]!.status === 2 ? -1 : st[i]!.progress }))
            .sort((a, b) => b.p - a.p)[0]?.id;
          setFollow(mine ?? leader ?? null);
          if (scene.zoom < 4) scene.setZoom(5.5);
        }
      }
    };
    return () => {
      scene.onFrame = null;
      scene.onUserCamera = null;
    };
  }, [scene, tail.data, me]);
  useEffect(() => {
    if (scene) scene.followId = follow;
  }, [scene, follow]);

  return (
    <div className={`relative ${className}`}>
      <TrackCanvas geometry={geometry} onReady={setScene} className="h-full" label="Corrida ao vivo" />
      <CameraControls scene={scene} />
      {geometry && dots.length > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 hidden size-32 rounded-xl bg-night/70 p-1.5 backdrop-blur sm:block">
          <Minimap g={geometry} cars={dots} highlight={follow} />
        </div>
      )}
      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <span className="flex items-center gap-1 rounded-full bg-hot px-2 py-0.5 text-[11px] font-bold text-white">
          <span className="size-1.5 animate-pulse-soft rounded-full bg-white" /> AO VIVO
        </span>
        <Link to={`/corridas/${race.id}/ao-vivo`} className="btn-danger !px-3 !py-1.5 text-xs">
          Abrir transmissão
        </Link>
      </div>
    </div>
  );
}
