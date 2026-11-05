import {
  formatLapTime,
  ROOM,
  type CarSetup,
  type LiveCarDto,
  type RaceIncidentDto,
  type ReplayFrame,
  type ServerEvents,
  type Weather,
} from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CarWearPanel, TyreWearMini } from '../components/CarWear';
import { Minimap, RainOverlay } from '../components/Minimap';
import { QualifyingLive } from '../components/QualifyingLive';
import { CameraControls, TrackCanvas } from '../components/TrackCanvas';
import { Countdown, Empty, PhaseBadge, Spinner } from '../components/ui';
import { CAR_CSS } from '../game/assets';
import { audio } from '../game/audio';
import { FrameBuffer, type CarState } from '../game/playback';
import type { TrackScene } from '../game/scene';
import { get } from '../lib/api';
import { WEATHER_ICON } from '../lib/format';
import { useGeometry, useRace } from '../lib/queries';
import { realtime, useRoom } from '../lib/realtime';
import { useSession } from '../lib/session';
import { ShareRace } from '../components/ShareRace';

interface ReplayDto {
  complete: boolean;
  durationMs: number;
  frameHz: number;
  playbackSpeed: number;
  startedAt: number;
  cars: LiveCarDto[];
  frames: ReplayFrame[];
  incidents: RaceIncidentDto[];
  weatherByLap: Weather[];
}

/** Atraso de exibição ao vivo (ms reais) para sempre haver frames à frente para interpolar. */
const LIVE_DELAY_MS = 1500;
const INCIDENT_TEXT: Partial<Record<RaceIncidentDto['kind'], string>> = {
  spin: 'rodou',
  mechanical: 'abandonou com falha mecânica',
  puncture: 'furou um pneu',
  pit: 'parou nos boxes',
  fastest_lap: 'fez a volta mais rápida',
  safety_car: 'Safety car na pista',
  safety_car_end: 'Safety car recolhido',
  oil: 'Óleo na pista!',
  weather: 'O clima mudou',
};

export default function Live({ mode }: { mode: 'live' | 'replay' }) {
  const { id } = useParams();
  const me = useSession((s) => s.me);
  const qc = useQueryClient();
  const { data: race } = useRace(id);
  const geo = useGeometry(race?.track.versionId);
  const [scene, setScene] = useState<TrackScene | null>(null);
  const buffer = useRef(new FrameBuffer());
  const [cars, setCars] = useState<LiveCarDto[]>([]);
  const [meta, setMeta] = useState<{ startedAt: number; speed: number; durationMs: number } | null>(null);
  const [incidents, setIncidents] = useState<RaceIncidentDto[]>([]);
  const [standings, setStandings] = useState<{ car: LiveCarDto; st: CarState; idx: number }[]>([]);
  // Todas as paradas (a lista de acontecimentos guarda só as últimas): dão as voltas de cada jogo de pneus.
  const pitLog = useRef(new Map<string, RaceIncidentDto>());
  const logPits = (list: RaceIncidentDto[]) => {
    for (const i of list) if (i.kind === 'pit' && i.userId) pitLog.current.set(`${i.userId}|${i.t}`, i);
  };
  const [simT, setSimT] = useState(0);
  const [follow, setFollow] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  /** Carro cujo motor se ouve (o seguido, o seu ou o líder). */
  const soundFocus = useRef<string | null>(null);
  // Replay: relógio local controlável.
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(4);
  const replayT = useRef(0);
  const lastPos = useRef<{ i: number; x: number; y: number; t: number } | null>(null);
  const [scrub, setScrub] = useState(0);

  const needReplay =
    !!race && (mode === 'replay' ? ['finished', 'archived'].includes(race.status) : race.status === 'race');
  const replay = useQuery({
    queryKey: ['replay', id, mode],
    queryFn: () => get<ReplayDto>(`/races/${id}/replay`),
    enabled: needReplay,
    staleTime: mode === 'replay' ? Infinity : 0,
  });
  useEffect(() => {
    if (!replay.data) return;
    buffer.current.setAll(replay.data.frames);
    setCars(replay.data.cars);
    setMeta({
      startedAt: replay.data.startedAt,
      speed: replay.data.playbackSpeed,
      durationMs: replay.data.durationMs,
    });
    logPits(replay.data.incidents);
    setIncidents(replay.data.incidents.filter((i) => i.kind !== 'overtake').slice(-30));
  }, [replay.data]);

  useRoom(mode === 'live' && id ? ROOM.race(id) : null, (env) => {
    switch (env.type) {
      case 'race.snapshot': {
        const live = (env.payload as ServerEvents['race.snapshot']).live;
        if (live && !buffer.current.frames.length) {
          setCars(live.cars);
          setMeta({ startedAt: live.startedAt, speed: live.playbackSpeed, durationMs: live.durationMs });
          logPits(live.incidents);
          setIncidents(live.incidents);
          void qc.invalidateQueries({ queryKey: ['replay', id, mode] });
        }
        break;
      }
      case 'race.started': {
        const p = env.payload as ServerEvents['race.started'];
        setCars(p.cars);
        setMeta({ startedAt: p.startedAt, speed: p.playbackSpeed, durationMs: p.durationMs });
        break;
      }
      case 'race.tick': {
        const p = env.payload as ServerEvents['race.tick'];
        buffer.current.put(p.fromFrame, p.frames);
        break;
      }
      case 'race.incident':
        logPits((env.payload as ServerEvents['race.incident']).incidents);
        if (
          (env.payload as ServerEvents['race.incident']).incidents.some(
            (i) => i.kind === 'pit' && i.userId === soundFocus.current,
          )
        )
          audio.pit();
        setIncidents((list) =>
          [...list, ...(env.payload as ServerEvents['race.incident']).incidents].slice(-30),
        );
        break;
      case 'race.finished':
        setFinished(true);
        break;
    }
  });

  // Câmera: segue o próprio carro (ou o líder, para quem só assiste) com zoom de perto, para ver os carros.
  const autoFollowed = useRef(false);
  useEffect(() => {
    if (autoFollowed.current || !cars.length || !scene) return;
    const mine = me && cars.some((c) => c.userId === me.id) ? me.id : null;
    const target = mine ?? standings[0]?.car.userId ?? null;
    if (!target) return;
    autoFollowed.current = true;
    setFollow(target);
    if (scene.zoom < 4) scene.setZoom(5.5);
  }, [cars, me, scene, standings]);

  // Laço de renderização.
  useEffect(() => {
    if (!scene || !meta || !cars.length) return;
    let acc = 0;
    scene.onUserCamera = () => setFollow(null);
    scene.onFrame = (dt) => {
      let t: number;
      if (mode === 'replay') {
        if (playing) replayT.current = Math.min(meta.durationMs, replayT.current + dt * rate);
        t = replayT.current;
      } else t = (realtime.clock.now() - LIVE_DELAY_MS - meta.startedAt) * meta.speed;
      const states = buffer.current.sample(Math.max(0, t), cars.length);
      if (!states) return;
      // Som do motor do carro em foco: velocidade pela distância percorrida entre quadros (tempo simulado).
      let fi = cars.findIndex((c) => c.userId === (follow ?? me?.id));
      if (fi < 0) fi = states.reduce((best, s, i) => (s.progress > states[best]!.progress ? i : best), 0);
      soundFocus.current = cars[fi]?.userId ?? null;
      const fs = states[fi]!;
      const prev = lastPos.current;
      if (prev && prev.i === fi && t > prev.t) {
        const v = Math.hypot(fs.x - prev.x, fs.y - prev.y) / ((t - prev.t) / 1000);
        audio.engineSpeed(v / 60, fs.status === 0 && (mode === 'live' || playing));
      }
      lastPos.current = { i: fi, x: fs.x, y: fs.y, t };
      scene.setCars(
        cars.map((c, i) => ({
          id: c.userId,
          x: states[i]!.x,
          y: states[i]!.y,
          heading: states[i]!.heading,
          color: c.carColor,
          model: c.carModel,
          number: c.carNumber,
          status: states[i]!.status,
          highlight: c.userId === me?.id,
        })),
      );
      scene.followId = follow;
      acc += dt;
      if (acc > 250) {
        acc = 0;
        if (mode === 'replay') setScrub(replayT.current);
        setSimT(t);
        const order = cars
          .map((car, idx) => ({ car, st: states[idx]!, idx }))
          .sort(
            (a, b) =>
              (b.st.status === 2 ? -1 : 0) - (a.st.status === 2 ? -1 : 0) || b.st.progress - a.st.progress,
          );
        setStandings(order);
      }
    };
    return () => {
      scene.onFrame = null;
    };
  }, [scene, meta, cars, mode, playing, rate, follow, me?.id]);

  // Seu setup (só o dono vê): mostra a próxima parada planejada no painel do seu carro.
  const inRace = !!me && cars.some((c) => c.userId === me.id);
  const mySetup = useQuery({
    queryKey: ['setup', id, me?.id],
    queryFn: () => get<{ setup: CarSetup } | null>(`/races/${id}/setup`),
    enabled: !!id && inRace,
    staleTime: Infinity,
  });

  const leader = standings[0];
  const lapNow = leader ? Math.min(race?.laps ?? 0, Math.max(1, Math.floor(leader.st.progress) + 1)) : 1;
  const leaderTimePerLap = useMemo(() => {
    if (!leader || !meta || leader.st.progress < 0.3) return 60_000;
    return meta.durationMs / Math.max(1, race?.laps ?? 1);
  }, [leader, meta, race?.laps]);
  const weatherNow = [...incidents].reverse().find((i) => i.kind === 'weather')?.detail as
    Weather | undefined;
  const focusId = follow ?? (inRace ? me!.id : (leader?.car.userId ?? null));
  const focusPos = standings.findIndex((s) => s.car.userId === focusId);
  const focus = focusPos >= 0 ? standings[focusPos]! : null;
  const focusInfo = focus
    ? (() => {
        const done = Math.max(0, Math.floor(focus.st.progress));
        let lastPit = 0;
        for (const i of pitLog.current.values())
          if (i.userId === focus.car.userId && i.t <= simT) lastPit = Math.max(lastPit, i.lap);
        const isMe = focus.car.userId === me?.id;
        const stops = isMe ? mySetup.data?.setup.pitStops : undefined;
        return {
          nickname: focus.car.nickname,
          carColor: focus.car.carColor,
          carNumber: focus.car.carNumber,
          position: focusPos + 1,
          tyreCode: focus.st.tyre,
          tyreWear: focus.st.tyreWear,
          engineWear: focus.st.engineWear,
          stintLaps: focus.st.progress < 0 ? 0 : done - lastPit,
          status: focus.st.status,
          isMe,
          ...(stops ? { nextStop: stops.find((p) => p.lap > done) ?? null } : {}),
        };
      })()
    : null;

  // Trilha e motor: tocam enquanto a corrida está na tela (ao vivo depois das luzes, ou o replay rodando).
  const racing = !!meta && !finished && (mode === 'replay' ? playing : race?.status === 'race');
  useEffect(() => {
    if (!racing) return;
    audio.music('race');
    audio.engine(true);
    return () => {
      audio.music(null);
      audio.engine(false);
    };
  }, [racing]);
  useEffect(() => {
    if (finished && mode === 'live') audio.finish();
  }, [finished, mode]);

  if (!race) return <Spinner />;
  if (mode === 'replay' && !['finished', 'archived'].includes(race.status))
    return <Empty title="O replay fica disponível após a corrida" icon="📼" />;
  if (mode === 'live' && race.status === 'qualifying')
    return (
      <div className="space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Link to={`/corridas/${id}`} className="text-sm text-muted hover:text-ink">
              ← {race.name}
            </Link>
            <h1 className="flex items-center gap-2 font-display text-2xl">
              <span className="size-3 animate-pulse-soft rounded-full bg-violet" /> Classificação ao vivo
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <ShareRace race={race} compact />
            <PhaseBadge phase={race.status} />
            {race.phaseDeadline && (
              <span className="text-right text-xs text-muted">
                Largada em <Countdown to={race.timeline.raceAt} className="text-xl text-ink" />
              </span>
            )}
          </div>
        </header>
        <QualifyingLive race={race} geometry={geo.data} variant="full" />
      </div>
    );
  const beforeStart = mode === 'live' && meta && realtime.clock.now() < meta.startedAt;
  const waiting = mode === 'live' && !meta && race.status !== 'race';
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to={`/corridas/${id}`} className="text-sm text-muted hover:text-ink">
            ← {race.name}
          </Link>
          <h1 className="flex items-center gap-2 font-display text-2xl">
            {mode === 'live' ? <span className="size-3 animate-pulse-soft rounded-full bg-hot" /> : '📼'}{' '}
            {mode === 'live' ? 'Ao vivo' : 'Replay'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {mode === 'live' && <ShareRace race={race} compact />}
          <PhaseBadge phase={race.status} />
          <span className="font-display text-xl">
            Volta {lapNow}/{race.laps}
          </span>
          {weatherNow && (
            <span className="text-2xl" title="Clima atual">
              {WEATHER_ICON[weatherNow]}
            </span>
          )}
        </div>
      </header>
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="relative self-start">
          <TrackCanvas
            geometry={geo.data}
            onReady={setScene}
            className="h-[64dvh] min-h-[360px]"
            label="Corrida ao vivo"
          />
          <CameraControls scene={scene} />
          <RainOverlay intensity={weatherNow === 'rain' ? 2 : weatherNow === 'light_rain' ? 1 : 0} />
          {geo.data && standings.length > 0 && (
            <div className="pointer-events-none absolute left-3 top-3 hidden size-36 rounded-xl bg-night/70 p-1.5 backdrop-blur sm:block">
              <Minimap
                g={geo.data}
                cars={standings.map(({ car, st }) => ({
                  id: car.userId,
                  x: st.x,
                  y: st.y,
                  color: car.carColor,
                  status: st.status,
                }))}
                highlight={follow}
              />
            </div>
          )}
          {waiting && (
            <div className="absolute inset-0 grid place-items-center bg-night/60 text-center backdrop-blur-sm">
              <div>
                <div className="font-display text-2xl">Aguardando a largada</div>
                {race.status === 'qualifying' && (
                  <p className="mt-2 text-muted">
                    Luzes se apagam em{' '}
                    <Countdown to={Date.parse(race.timeline.raceAt) + 5000} className="text-ink" />
                  </p>
                )}
              </div>
            </div>
          )}
          {beforeStart && meta && <StartLights startedAt={meta.startedAt} />}
          {(finished || (mode === 'replay' && scrub >= (meta?.durationMs ?? Infinity))) && (
            <div className="absolute inset-x-0 top-4 mx-auto w-fit animate-pop rounded-2xl bg-night/90 px-5 py-3 text-center shadow-2xl">
              <div className="checkered mx-auto mb-2 h-3 w-40 rounded" />
              <div className="font-display text-xl">Bandeira quadriculada!</div>
              <Link to={`/corridas/${id}/resultado`} className="btn-primary mt-2">
                Ver resultado
              </Link>
            </div>
          )}
          {mode === 'replay' && meta && (
            <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-2xl bg-night/90 p-2 backdrop-blur sm:right-16">
              <button
                className="btn-ghost size-9 !p-0"
                aria-label={playing ? 'Pausar' : 'Reproduzir'}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <input
                aria-label="Posição do replay"
                type="range"
                min={0}
                max={meta.durationMs}
                value={scrub}
                onChange={(e) => (replayT.current = Number(e.target.value))}
                className="flex-1 accent-[#ffcc00]"
              />
              <span className="w-16 text-right font-mono text-xs">{formatLapTime(scrub)}</span>
              {[1, 4, 8, 16].map((r) => (
                <button
                  key={r}
                  className={clsx(
                    'rounded-lg px-2 py-1 text-xs font-bold',
                    rate === r ? 'bg-race text-night' : 'text-muted',
                  )}
                  onClick={() => setRate(r)}
                >
                  {r}x
                </button>
              ))}
            </div>
          )}
        </div>
        <aside className="space-y-3">
          {focusInfo && <CarWearPanel info={focusInfo} />}
          <div className="card !p-2">
            <div className="label flex justify-between px-2 pt-1">
              <span>Classificação</span>
              <span className="normal-case tracking-normal">toque para acompanhar</span>
            </div>
            <ol className="max-h-[46dvh] overflow-auto">
              {standings.map(({ car, st }, pos) => {
                const gap = pos === 0 ? null : (leader!.st.progress - st.progress) * leaderTimePerLap;
                return (
                  <li key={car.userId}>
                    <button
                      onClick={() => setFollow(car.userId)}
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-night-3',
                        follow === car.userId && 'bg-night-3',
                        car.userId === me?.id && 'text-race',
                      )}
                    >
                      <span className="w-5 text-right font-mono text-muted">{pos + 1}</span>
                      <span
                        className="grid size-6 place-items-center rounded-full text-[10px] font-black"
                        style={{
                          background: CAR_CSS[car.carColor],
                          color: car.carColor === 'yellow' ? '#111' : '#fff',
                        }}
                      >
                        {car.carNumber}
                      </span>
                      <span className="flex-1 truncate font-semibold">{car.nickname}</span>
                      {st.status === 1 ? (
                        <span className="chip !px-1.5 text-sky">PIT</span>
                      ) : st.status === 2 ? (
                        <span className="chip !px-1.5 text-hot">ABD</span>
                      ) : st.status === 3 ? (
                        <span>🏁</span>
                      ) : (
                        <span className="font-mono text-xs text-muted">
                          {gap == null
                            ? 'líder'
                            : gap > leaderTimePerLap
                              ? `+${Math.floor(gap / leaderTimePerLap)}V`
                              : `+${(gap / 1000).toFixed(1)}`}
                        </span>
                      )}
                      <TyreWearMini tyreCode={st.tyre} wear={st.tyreWear} />
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="card !p-3">
            <div className="label">Acontecimentos</div>
            <ul className="space-y-1 text-sm" aria-live="polite">
              {incidents.length === 0 && <li className="text-muted">Nada por enquanto.</li>}
              {[...incidents]
                .reverse()
                .slice(0, 8)
                .map((i, k) => {
                  const who = cars.find((c) => c.userId === i.userId)?.nickname;
                  return (
                    <li key={`${i.t}-${k}`} className="flex gap-2">
                      <span className="font-mono text-xs text-muted">V{i.lap}</span>
                      <span>
                        {who && <b>{who} </b>}
                        {INCIDENT_TEXT[i.kind] ?? i.kind}
                        {i.kind === 'fastest_lap' && i.detail ? ` (${formatLapTime(Number(i.detail))})` : ''}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StartLights({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(realtime.clock.now());
  useEffect(() => {
    const t = setInterval(() => setNow(realtime.clock.now()), 100);
    return () => clearInterval(t);
  }, []);
  const left = startedAt - now;
  const on = Math.max(0, Math.min(5, 5 - Math.ceil(left / 1000) + 1));
  // Bipe a cada luz acesa e um bipe agudo quando apagam. O da largada é agendado antes, porque este componente
  // some da tela no instante em que as luzes apagam.
  const goScheduled = useRef(false);
  useEffect(() => {
    if (on > 0 && left > 0) audio.lights(false);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (left > 0 && left < 1500 && !goScheduled.current) {
      goScheduled.current = true;
      window.setTimeout(() => audio.lights(true), left);
    }
  }, [left]);
  if (left <= 0) return null;
  return (
    <div
      className="absolute inset-0 grid place-items-center bg-night/40"
      role="status"
      aria-label={`Largada em ${Math.ceil(left / 1000)} segundos`}
    >
      <div className="flex gap-3 rounded-3xl bg-[#111] p-4 shadow-2xl">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={clsx(
              'size-10 rounded-full border-4 border-[#333] sm:size-14',
              i < on ? 'bg-hot shadow-[0_0_24px_#ff5a5a]' : 'bg-[#2a2a2a]',
            )}
          />
        ))}
      </div>
    </div>
  );
}
