import {
  CAR_COLORS,
  DEFAULT_SETUP,
  defaultPitStops,
  formatLapTime,
  type CarSetup,
  type RaceDetailDto,
  type Tyre,
  type Weather,
} from '@tracado/shared';
import { estimateLap, simulateRace, type CarResult } from '@tracado/sim';
import { offsetsToTrace, racingLine, type TrackGeometry } from '@tracado/trackgen';
import clsx from 'clsx';
import { FastForward, Pause, Play, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CameraControls, TrackCanvas } from '../../components/TrackCanvas';
import { CarIcon, Segmented } from '../../components/ui';
import { CAR_CSS } from '../../game/assets';
import { FrameBuffer } from '../../game/playback';
import type { CarView, TrackScene } from '../../game/scene';
import { WEATHER_ICON, WEATHER_LABEL } from '../../lib/format';
import { speedColors, type PracticeInfo } from './common';

interface PracticeCar {
  id: string;
  name: string;
  color: string;
  model: number;
  number: number;
}
interface LapPath {
  /** x, y da linha do carro por amostra. */
  path: Float64Array;
  /** Tempo acumulado (ms) até a amostra i; t[n] = volta. */
  t: Float64Array;
  /** Tempo (ms) em que cada setor termina. */
  sectorEnds: number[];
}
type Anim =
  | { kind: 'idle' }
  | { kind: 'lap'; t: number; rate: number; lap: LapPath; weather: Weather; sectors: number[] }
  | {
      kind: 'race';
      t: number;
      rate: number;
      playing: boolean;
      buf: FrameBuffer;
      durationMs: number;
      cars: PracticeCar[];
      results: CarResult[];
    };

const LAP_RATES = [1, 2, 5] as const;
const RACE_RATES = [10, 30, 60] as const;

/** Posição e direção do carro no instante `ms` de uma volta lançada. */
function lapPose(lap: LapPath, ms: number) {
  const n = lap.path.length / 2;
  const t = lap.t;
  let lo = 0,
    hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= ms) lo = mid;
    else hi = mid;
  }
  const i = lo % n,
    j = (lo + 1) % n;
  const k = Math.max(0, Math.min(1, (ms - t[lo]!) / Math.max(1e-6, t[lo + 1]! - t[lo]!)));
  const ax = lap.path[i * 2]!,
    ay = lap.path[i * 2 + 1]!,
    bx = lap.path[j * 2]!,
    by = lap.path[j * 2 + 1]!;
  return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, heading: Math.atan2(by - ay, bx - ax) };
}

export function PracticeTab({
  race,
  g,
  offsets,
  setup,
  practice,
}: {
  race: RaceDetailDto;
  g: TrackGeometry;
  offsets: Float64Array;
  setup: CarSetup;
  practice: PracticeInfo;
}) {
  const [scene, setScene] = useState<TrackScene | null>(null);
  const [weather, setWeather] = useState<Weather>(practice.weather.base);
  const [runs, setRuns] = useState<{ n: number; lapMs: number; sectors: number[]; weather: Weather }[]>([]);
  const [lapRate, setLapRate] = useState<(typeof LAP_RATES)[number]>(2);
  const [follow, setFollow] = useState(true);
  const [, setTick] = useState(0);
  const anim = useRef<Anim>({ kind: 'idle' });
  const trace = useMemo(() => offsetsToTrace(offsets, 256), [offsets]);
  const est = useMemo(
    () => estimateLap(g, setup, trace, weather, practice.weather.temperature, practice.laps),
    [g, setup, trace, weather, practice],
  );
  const path = useMemo(() => racingLine(g, offsets), [g, offsets]);

  const entry = race.me?.entry;
  const me: PracticeCar = {
    id: 'voce',
    name: 'Você',
    color: entry?.carColor ?? 'red',
    model: entry?.carModel || 1,
    number: entry?.carNumber || 1,
  };
  const meRef = useRef(me);
  meRef.current = me;

  useEffect(() => {
    scene?.setLine('line', path, { closed: true, widthPx: 4, colors: speedColors(est.profile) });
  }, [scene, path, est.profile]);

  // Carro parado na linha de largada enquanto nada roda.
  const idlePose = useMemo(() => {
    const n = path.length / 2;
    const k = Math.min(2, n - 1);
    return {
      x: path[0]!,
      y: path[1]!,
      heading: Math.atan2(path[k * 2 + 1]! - path[1]!, path[k * 2]! - path[0]!),
    };
  }, [path]);

  // Laço de animação: volta de treino (só o seu carro) ou corrida de teste (replay dos frames).
  useEffect(() => {
    if (!scene) return;
    let acc = 0;
    scene.onUserCamera = () => setFollow(false);
    scene.onFrame = (dt) => {
      const a = anim.current;
      const m = meRef.current;
      const view = (c: PracticeCar, p: { x: number; y: number; heading: number }, status = 0): CarView => ({
        id: c.id,
        ...p,
        color: c.color,
        model: c.model,
        number: c.number,
        status,
        highlight: c.id === 'voce',
      });
      if (a.kind === 'lap') {
        a.t = Math.min(a.lap.t[a.lap.t.length - 1]!, a.t + dt * a.rate);
        scene.setCars([view(m, lapPose(a.lap, a.t))]);
        const total = a.lap.t[a.lap.t.length - 1]!;
        if (a.t >= total) {
          const lapMs = Math.round(total);
          const sectors = a.sectors;
          const w = a.weather;
          setRuns((r) => [{ n: (r[0]?.n ?? 0) + 1, lapMs, sectors, weather: w }, ...r].slice(0, 12));
          anim.current = { kind: 'idle' };
        }
      } else if (a.kind === 'race') {
        if (a.playing) a.t = Math.min(a.durationMs, a.t + dt * a.rate);
        const st = a.buf.sample(a.t, a.cars.length);
        if (st) scene.setCars(a.cars.map((c, i) => view(c, st[i]!, st[i]!.status)));
      } else scene.setCars([view(m, idlePose)]);
      acc += dt;
      if (acc > 120) {
        acc = 0;
        setTick((x) => x + 1);
      }
    };
    return () => {
      scene.onFrame = null;
      scene.onUserCamera = null;
    };
  }, [scene, idlePose]);
  useEffect(() => {
    if (scene) scene.followId = follow && anim.current.kind !== 'idle' ? 'voce' : null;
  });

  function startLap() {
    const n = path.length / 2;
    const v = est.profile;
    const t = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const seg = Math.hypot(path[j * 2]! - path[i * 2]!, path[j * 2 + 1]! - path[i * 2 + 1]!);
      t[i + 1] = t[i]! + (seg / Math.max(1, (v[i]! + v[j]!) / 2)) * 1000;
    }
    // Ajusta à estimativa oficial (mesma conta, só arredondamento).
    const scale = est.lapTimeMs / t[n]!;
    for (let i = 0; i <= n; i++) t[i] = t[i]! * scale;
    const sectorEnds = g.sectors.map((_, k) => t[g.sectors[k + 1] ?? n]!);
    anim.current = {
      kind: 'lap',
      t: 0,
      rate: lapRate,
      lap: { path, t, sectorEnds },
      weather,
      sectors: est.sectorMs,
    };
    setFollow(true);
    // Perto o bastante para ver o carro (o número some a partir do zoom 6).
    if (scene && scene.zoom < 6) scene.setZoom(7);
  }

  function runRace() {
    // Corrida de teste local contra 5 "fantasmas" com a linha sugerida e setups variados.
    const ghostTyres: Tyre[] = ['soft', 'medium', 'hard', 'medium', 'soft'];
    const ghosts = ghostTyres.map((t, i) => ({
      setup: {
        ...DEFAULT_SETUP,
        tyre: t,
        aero: 3 + i,
        // Todos cumprem a parada obrigatória; quem larga de macio para duas vezes.
        pitStops: defaultPitStops(practice.laps, ['medium', 'hard'], t === 'soft' ? 2 : 1),
      } satisfies CarSetup,
      car: {
        id: `fantasma-${i + 1}`,
        name: `Fantasma ${i + 1}`,
        color: CAR_COLORS.filter((c) => c !== me.color)[i % 4]!,
        model: (i % 5) + 1,
        number: 90 + i,
      },
    }));
    const out = simulateRace({
      geometry: g,
      cars: [
        { id: 'voce', setup, trace },
        ...ghosts.map((x) => ({ id: x.car.id, setup: x.setup, trace: practice.suggestedTrace })),
      ],
      laps: practice.laps,
      seed: `treino-${Date.now()}`,
      weather: { ...practice.weather, base: weather },
      randomEvents: { safetyCar: false, oil: false, mechanical: false },
    });
    const buf = new FrameBuffer();
    buf.setAll(out.frames);
    anim.current = {
      kind: 'race',
      t: 0,
      rate: 30,
      playing: true,
      buf,
      durationMs: out.durationMs,
      cars: [me, ...ghosts.map((x) => x.car)],
      results: out.results,
    };
    setFollow(true);
    if (scene && scene.zoom < 3) scene.setZoom(3.5);
    setTick((x) => x + 1);
  }
  const stop = () => {
    anim.current = { kind: 'idle' };
    setTick((x) => x + 1);
  };

  const a = anim.current;
  const best = runs.length ? Math.min(...runs.map((r) => r.lapMs)) : null;
  // Classificação ao vivo da corrida de teste.
  const live =
    a.kind === 'race'
      ? (() => {
          const st = a.buf.sample(a.t, a.cars.length) ?? [];
          return a.cars
            .map((c, i) => ({ c, st: st[i] }))
            .filter((x) => x.st)
            .sort((x, y) => y.st!.progress - x.st!.progress);
        })()
      : [];
  const raceDone = a.kind === 'race' && a.t >= a.durationMs;
  const lapNow =
    a.kind === 'race' && live[0] ? Math.min(practice.laps, Math.floor(live[0].st!.progress) + 1) : 0;
  const nameOf = (id: string) => (a.kind === 'race' ? (a.cars.find((c) => c.id === id) ?? me) : me);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="relative self-start">
        <TrackCanvas
          geometry={g}
          onReady={setScene}
          className="h-[55dvh] min-h-[340px]"
          label="Treino: seu carro na pista"
        />
        <CameraControls
          scene={scene}
          extra={
            a.kind !== 'idle' ? (
              <button
                className={clsx('btn-ghost size-10 !p-0 text-xs', follow && '!bg-race !text-night')}
                aria-pressed={follow}
                aria-label="Seguir meu carro"
                title="Seguir meu carro"
                onClick={() => setFollow((f) => !f)}
              >
                🎥
              </button>
            ) : undefined
          }
        />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
          {a.kind === 'lap' ? (
            <div className="rounded-2xl bg-night/85 px-3 py-2 backdrop-blur">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                Volta lançada · {WEATHER_ICON[a.weather]} · {a.rate}×
              </div>
              <div className="font-mono text-2xl font-bold">{formatLapTime(Math.round(a.t))}</div>
              <div className="mt-1 flex gap-1 font-mono text-[11px]">
                {a.lap.sectorEnds.map((end, k) => (
                  <span
                    key={k}
                    className={clsx(
                      'rounded px-1.5',
                      a.t >= end ? 'bg-go/20 text-go' : 'bg-night-3 text-muted',
                    )}
                  >
                    S{k + 1} {a.t >= end ? (a.sectors[k]! / 1000).toFixed(2) : '—'}
                  </span>
                ))}
              </div>
            </div>
          ) : a.kind === 'race' ? (
            <div className="rounded-2xl bg-night/85 px-3 py-2 backdrop-blur">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                Corrida de teste
              </div>
              <div className="font-display text-xl">
                {raceDone ? 'Bandeirada 🏁' : `Volta ${lapNow}/${practice.laps}`}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-night/80 px-3 py-1.5 text-xs font-bold">
              <span className="text-sky">lento</span> → <span className="text-race">rápido</span>
            </div>
          )}
        </div>
        {a.kind === 'race' && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-2xl bg-night/85 p-1 backdrop-blur">
            <button
              className="rounded-xl p-2 hover:bg-night-3"
              aria-label={a.playing ? 'Pausar' : 'Continuar'}
              onClick={() => {
                a.playing = !a.playing;
                setTick((x) => x + 1);
              }}
              disabled={raceDone}
            >
              {a.playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            {RACE_RATES.map((r) => (
              <button
                key={r}
                className={clsx(
                  'rounded-xl px-2 py-1 text-xs font-bold',
                  a.rate === r ? 'bg-race text-night' : 'hover:bg-night-3',
                )}
                aria-pressed={a.rate === r}
                onClick={() => {
                  a.rate = r;
                  setTick((x) => x + 1);
                }}
              >
                {r}×
              </button>
            ))}
            <button
              className="rounded-xl p-2 hover:bg-night-3"
              aria-label="Pular para o fim"
              title="Pular para o fim"
              onClick={() => {
                a.t = a.durationMs;
                setTick((x) => x + 1);
              }}
            >
              <FastForward size={16} />
            </button>
            <button
              className="rounded-xl p-2 hover:bg-night-3"
              aria-label="Encerrar"
              title="Encerrar"
              onClick={stop}
            >
              <Square size={14} />
            </button>
          </div>
        )}
      </div>
      <aside className="space-y-3">
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <CarIcon color={me.color} model={me.model} className="h-10" />
            <div className="min-w-0 flex-1">
              <div className="font-bold">Seu carro #{me.number}</div>
              <Link to={`/corridas/${race.id}/box?aba=setup`} className="text-xs text-race hover:underline">
                Trocar carro ou setup
              </Link>
            </div>
          </div>
          <div>
            <div className="label">Clima do treino</div>
            <Segmented
              label="Clima do treino"
              value={weather}
              onChange={setWeather}
              options={(['dry', 'cloudy', 'light_rain', 'rain'] as Weather[]).map((w) => ({
                value: w,
                label: <span title={WEATHER_LABEL[w]}>{WEATHER_ICON[w]}</span>,
              }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-go flex-1" onClick={startLap} disabled={a.kind === 'lap'}>
              ⏱️ Volta de treino
            </button>
            <Segmented
              label="Velocidade da volta"
              value={lapRate}
              onChange={(v) => setLapRate(v)}
              options={LAP_RATES.map((r) => ({ value: r, label: `${r}×` }))}
            />
          </div>
          <button className="btn-ghost w-full" onClick={runRace}>
            🏁 Corrida de teste ({practice.laps} voltas, 6 carros)
          </button>
          <p className="text-xs text-muted">
            O treino roda no seu aparelho e não vale para o resultado oficial. Referência do servidor (linha
            sugerida, setup padrão): {formatLapTime(practice.reference.suggestedLapMs)}.
          </p>
        </div>
        {a.kind === 'race' && (
          <div className="card">
            <div className="label">{raceDone ? 'Resultado da corrida de teste' : 'Posições'}</div>
            <ol className="space-y-1 text-sm">
              {(raceDone
                ? a.results.map((r) => ({
                    id: r.id,
                    right: r.status === 'finished' ? formatLapTime(r.totalTimeMs!) : 'abandono',
                    pits: r.pitStops,
                  }))
                : live.map((x) => ({
                    id: x.c.id,
                    right:
                      x.st!.status === 1
                        ? 'nos boxes'
                        : `volta ${Math.min(practice.laps, Math.floor(x.st!.progress) + 1)}`,
                    pits: null,
                  }))
              ).map((row, i) => {
                const c = nameOf(row.id);
                return (
                  <li
                    key={row.id}
                    className={clsx('flex items-center gap-2', row.id === 'voce' && 'font-bold text-race')}
                  >
                    <span className="w-5 text-right font-mono">{i + 1}</span>
                    <span className="size-3 rounded-full" style={{ background: CAR_CSS[c.color] }} />
                    <span className="flex-1 truncate">
                      {c.name} {row.pits ? `🔧${row.pits}` : ''}
                    </span>
                    <span className="font-mono text-xs">{row.right}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        {runs.length > 0 && (
          <div className="card">
            <div className="label">Voltas</div>
            <ol className="space-y-1 text-sm">
              {runs.map((r) => (
                <li key={r.n} className="flex justify-between font-mono">
                  <span>
                    #{r.n} {WEATHER_ICON[r.weather]}
                  </span>
                  <span className={r.lapMs === best ? 'font-bold text-violet' : ''}>
                    {formatLapTime(r.lapMs)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <Link to={`/corridas/${race.id}/box?aba=tracado`} className="btn-ghost w-full">
          Ajustar traçado
        </Link>
      </aside>
    </div>
  );
}
