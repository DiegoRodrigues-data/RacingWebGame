import { formatLapTime, type LiveCarDto, type RaceSummaryDto, type ReplayFrame } from '@tracado/shared';
import type { TrackGeometry } from '@tracado/trackgen';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CAR_CSS } from '../game/assets';
import { audio } from '../game/audio';
import { FrameBuffer } from '../game/playback';
import type { TrackScene } from '../game/scene';
import { get } from '../lib/api';
import { realtime } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Minimap } from './Minimap';
import { CameraControls, TrackCanvas } from './TrackCanvas';

interface QualiRun {
  userId: string;
  startMs: number;
  sectorMs: number[];
  lapTimeMs: number | null;
}
interface QualiLiveDto {
  complete: boolean;
  startedAt: number;
  playbackSpeed: number;
  durationMs: number;
  sectors: number;
  cars: LiveCarDto[];
  runs: QualiRun[];
  fromFrame: number;
  frames: ReplayFrame[];
}

/** Atraso de exibição (ms reais): maior que o intervalo de busca, para sempre haver frames à frente. */
const DELAY_MS = 2500;
const POLL_MS = 1500;

type RowState = 'box' | 'pista' | 'volta';
interface TowerRow {
  car: LiveCarDto;
  state: RowState;
  sectors: number[];
  lapTimeMs: number | null;
  /** Tempo correndo da volta lançada (ms), só para quem está na pista. */
  runningMs: number;
}

/**
 * Classificação ao vivo: cada carro sai do box e faz uma volta lançada; a torre de tempos se forma conforme as
 * voltas fecham. Os dados chegam aos poucos do servidor (nada do futuro) e a tela mostra só o que o espectador
 * já viu acontecer na pista.
 */
export function QualifyingLive({
  race,
  geometry,
  variant,
  className = '',
}: {
  race: RaceSummaryDto;
  geometry: TrackGeometry | undefined;
  variant: 'full' | 'compact';
  className?: string;
}) {
  const me = useSession((s) => s.me);
  const [scene, setScene] = useState<TrackScene | null>(null);
  const buffer = useRef(new FrameBuffer());
  const next = useRef(0);
  const [meta, setMeta] = useState<Omit<QualiLiveDto, 'frames' | 'fromFrame'> | null>(null);
  const live = useQuery({
    queryKey: ['quali-live', race.id],
    queryFn: async () => {
      const d = await get<QualiLiveDto>(`/races/${race.id}/qualifying/live?from=${next.current}`);
      buffer.current.put(d.fromFrame, d.frames);
      next.current = d.fromFrame + d.frames.length;
      setMeta(d);
      return d.complete;
    },
    refetchInterval: (q) => (q.state.data ? false : POLL_MS),
    staleTime: 0,
    gcTime: 0,
  });
  void live;

  const [t, setT] = useState(0);
  const [follow, setFollow] = useState<string | null>(null);
  const userCamera = useRef(false);
  const [dots, setDots] = useState<{ id: string; x: number; y: number; color: string; status: number }[]>([]);
  useEffect(() => {
    if (!scene || !meta) return;
    const cars = meta.cars;
    let acc = 0;
    scene.onUserCamera = () => {
      userCamera.current = true;
      setFollow(null);
    };
    scene.onFrame = (dt) => {
      const now = (realtime.clock.now() - DELAY_MS - meta.startedAt) * meta.playbackSpeed;
      const st = buffer.current.sample(Math.max(0, now), cars.length);
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
          // Quem já fechou a volta aparece esmaecido na via dos boxes.
          status: st[i]!.status === 3 ? 2 : st[i]!.status,
          highlight: c.userId === me?.id,
        })),
      );
      acc += dt;
      if (acc > 200) {
        acc = 0;
        setT(Math.max(0, now));
        setDots(
          cars.map((c, i) => ({
            id: c.userId,
            x: st[i]!.x,
            y: st[i]!.y,
            color: c.carColor,
            status: st[i]!.status === 0 ? 0 : 2,
          })),
        );
      }
    };
    return () => {
      scene.onFrame = null;
      scene.onUserCamera = null;
    };
  }, [scene, meta, me?.id]);

  // Torre de tempos com o que já aconteceu até o instante exibido.
  const rows = useMemo<TowerRow[]>(() => {
    if (!meta) return [];
    const runs = new Map(meta.runs.map((r) => [r.userId, r]));
    return meta.cars.map((car) => {
      const r = runs.get(car.userId);
      if (!r || r.startMs > t) return { car, state: 'box', sectors: [], lapTimeMs: null, runningMs: 0 };
      const sectors: number[] = [];
      let acc = r.startMs;
      for (const s of r.sectorMs) {
        acc += s;
        if (acc <= t) sectors.push(s);
      }
      const lap = r.lapTimeMs != null && r.startMs + r.lapTimeMs <= t ? r.lapTimeMs : null;
      return {
        car,
        state: lap != null ? 'volta' : 'pista',
        sectors,
        lapTimeMs: lap,
        runningMs: t - r.startMs,
      };
    });
  }, [meta, t]);
  const done = rows.filter((r) => r.state === 'volta').sort((a, b) => a.lapTimeMs! - b.lapTimeMs!);
  const onTrack = rows.filter((r) => r.state === 'pista').sort((a, b) => b.runningMs - a.runningMs);
  const waiting = rows.filter((r) => r.state === 'box');
  const pole = done[0]?.lapTimeMs ?? null;
  const bestSector = useMemo(() => {
    const out: number[] = [];
    for (const r of rows) r.sectors.forEach((s, k) => (out[k] = Math.min(out[k] ?? Infinity, s)));
    return out;
  }, [rows]);

  // Câmera: acompanha o carro que saiu por último para a volta lançada (ou o seu, se estiver na pista).
  const target =
    onTrack.find((r) => r.car.userId === me?.id)?.car.userId ?? onTrack.at(-1)?.car.userId ?? null;
  useEffect(() => {
    if (!scene || userCamera.current) return;
    if (target && target !== follow) {
      setFollow(target);
      if (scene.zoom < 4) scene.setZoom(5);
    }
  }, [scene, target, follow]);
  useEffect(() => {
    if (scene) scene.followId = follow;
  }, [scene, follow]);

  // Trilha da classificação na transmissão em tela cheia (no mapa compacto da página da corrida, silêncio).
  useEffect(() => {
    if (variant !== 'full') return;
    audio.music('quali');
    return () => audio.music(null);
  }, [variant]);

  const nSectors = meta?.sectors ?? 3;
  const sessionOver = meta ? t >= meta.durationMs - 1500 : false;

  const towerRow = (r: TowerRow, pos: number | null) => (
    <li
      key={r.car.userId}
      className={clsx(
        'flex items-center gap-2 rounded-lg px-2 py-1 text-sm',
        r.car.userId === me?.id && 'text-race',
        r.state === 'pista' && 'bg-night-3',
      )}
    >
      <span className="w-5 text-right font-mono text-muted">{pos ?? ''}</span>
      <span
        className="grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-black"
        style={{ background: CAR_CSS[r.car.carColor], color: r.car.carColor === 'yellow' ? '#111' : '#fff' }}
      >
        {r.car.carNumber}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold">{r.car.nickname}</span>
      {r.state === 'box' ? (
        <span className="text-xs text-muted">no box</span>
      ) : (
        <>
          <span className="hidden gap-0.5 sm:flex">
            {Array.from({ length: nSectors }, (_, k) => {
              const s = r.sectors[k];
              return (
                <span
                  key={k}
                  title={s != null ? `Setor ${k + 1}: ${(s / 1000).toFixed(3)} s` : `Setor ${k + 1}`}
                  className={clsx(
                    'h-1.5 w-4 rounded-full',
                    s == null ? 'bg-night-3' : s <= bestSector[k]! ? 'bg-violet' : 'bg-race',
                  )}
                />
              );
            })}
          </span>
          <span className="w-20 text-right font-mono text-xs">
            {r.lapTimeMs != null ? (
              pos === 1 ? (
                <b className="text-violet">{formatLapTime(r.lapTimeMs)}</b>
              ) : (
                `+${((r.lapTimeMs - pole!) / 1000).toFixed(3)}`
              )
            ) : (
              <span className="text-go">{formatLapTime(Math.round(r.runningMs))}</span>
            )}
          </span>
        </>
      )}
    </li>
  );

  const tower = (
    <ol className="space-y-0.5">
      {done.map((r, i) => towerRow(r, i + 1))}
      {onTrack.map((r) => towerRow(r, null))}
      {waiting.map((r) => towerRow(r, null))}
    </ol>
  );

  const header = (
    <div className="flex items-center justify-between gap-2 px-2 pt-1">
      <span className="label !mb-0">Classificação {sessionOver ? '· encerrada' : 'ao vivo'}</span>
      <span className="text-[11px] text-muted">
        {done.length}/{rows.length} voltas fechadas
      </span>
    </div>
  );

  const canvas = (
    <div className="relative h-full">
      <TrackCanvas geometry={geometry} onReady={setScene} className="h-full" label="Classificação ao vivo" />
      <CameraControls scene={scene} />
      {variant === 'full' && geometry && dots.length > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 hidden size-32 rounded-xl bg-night/70 p-1.5 backdrop-blur sm:block">
          <Minimap g={geometry} cars={dots} highlight={follow} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-2xl bg-night/85 px-4 py-2 text-center backdrop-blur">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
          ⏱️ Classificação · volta lançada
        </div>
        {sessionOver ? (
          <div className="font-display text-lg">Grid definido! Pole: {done[0]?.car.nickname ?? '—'}</div>
        ) : pole != null ? (
          <div className="font-display text-lg">
            Pole provisória: {done[0]!.car.nickname}{' '}
            <span className="font-mono text-violet">{formatLapTime(pole)}</span>
          </div>
        ) : (
          <div className="font-display text-lg">
            {meta ? `${onTrack.length} na pista, ${waiting.length} no box` : 'Carros saindo do box…'}
          </div>
        )}
      </div>
      {variant === 'compact' && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-violet px-2 py-0.5 text-[11px] font-bold text-white">
            <span className="size-1.5 animate-pulse-soft rounded-full bg-white" /> CLASSIFICAÇÃO
          </span>
          <Link to={`/corridas/${race.id}/ao-vivo`} className="btn-danger !px-3 !py-1.5 text-xs">
            Abrir transmissão
          </Link>
        </div>
      )}
    </div>
  );

  if (variant === 'compact') return <div className={className}>{canvas}</div>;
  return (
    <div className={clsx('grid gap-3 lg:grid-cols-[1fr_340px]', className)}>
      <div className="h-[64dvh] min-h-[360px]">{canvas}</div>
      <aside className="card !p-2">
        {header}
        <div className="max-h-[60dvh] overflow-auto">{tower}</div>
        <p className="px-2 pt-2 text-[11px] text-muted">
          Cada piloto faz uma volta lançada com o setup e o traçado travados no parque fechado. Roxo = melhor
          setor da sessão. O grid da corrida sai desta tabela.
        </p>
      </aside>
    </div>
  );
}

export { type QualiLiveDto };
