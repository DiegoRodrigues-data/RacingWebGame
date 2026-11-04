import {
  checkSetupLimits,
  DEFAULT_SETUP,
  formatLapTime,
  ROOM,
  TYRE_LABELS,
  type CarSetup,
  type CategoryConfig,
  type RaceDetailDto,
  type TracePoint,
  type Tyre,
  type Weather,
} from '@tracado/shared';
import { estimateLap, simulateRace, type CarResult } from '@tracado/sim';
import {
  chaikin,
  enforceLateralRate,
  offsetsToTrace,
  projectToTrack,
  racingLine,
  strokeToOffsets,
  traceToOffsets,
  traceToWorld,
  validateTrace,
  type TrackGeometry,
} from '@tracado/trackgen';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Eraser, Hand, PenLine, Redo2, Sparkles, Undo2, AlignCenter, Send, Gauge } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CameraControls, TrackCanvas } from '../components/TrackCanvas';
import { Countdown, Empty, PhaseBadge, Segmented, Spinner, Tabs, toast } from '../components/ui';
import type { TrackScene } from '../game/scene';
import { ApiError, errorMessage, get, put } from '../lib/api';
import { TYRE_COLOR, WEATHER_ICON, WEATHER_LABEL } from '../lib/format';
import { useGeometry, useRace } from '../lib/queries';
import { useRoom, useServerNow } from '../lib/realtime';
import { useSession } from '../lib/session';

interface PracticeInfo {
  laps: number;
  weather: { base: Weather; rainChance: number; temperature: number };
  limits: CategoryConfig['setupLimits'];
  suggestedTrace: TracePoint[];
  reference: { suggestedLapMs: number; centerlineLapMs: number };
}

/** Corridas cujo rascunho já foi enviado automaticamente nesta aba (sobrevive a remontagens do componente). */
const autoSubmitted = new Set<string>();

const draftKey = (raceId: string, kind: 'trace' | 'setup') => `tracado:draft:${kind}:${raceId}`;
const loadDraft = <T,>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const saveDraft = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* armazenamento indisponível: rascunho só em memória */
  }
};

function speedColors(v: Float64Array): number[] {
  let mn = Infinity,
    mx = 0;
  for (const s of v) {
    mn = Math.min(mn, s);
    mx = Math.max(mx, s);
  }
  return Array.from(v, (s) => {
    const t = (s - mn) / Math.max(1, mx - mn);
    const r = Math.round(255 * Math.min(1, t * 2)),
      g = Math.round(200 * (1 - Math.abs(t - 0.5) * 2) + 40),
      b = Math.round(255 * Math.max(0, 1 - t * 2));
    return (r << 16) | (g << 8) | b;
  });
}

export default function Box() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') as 'tracado' | 'setup' | 'treino') ?? 'tracado';
  const me = useSession((s) => s.me);
  const { data: race, isLoading } = useRace(id);
  const geo = useGeometry(race?.track.versionId);
  const practice = useQuery({
    queryKey: ['practice', id],
    queryFn: () => get<PracticeInfo>(`/races/${id}/practice`),
    enabled: !!id,
  });
  const serverTrace = useQuery({
    queryKey: ['trace', id, me?.id],
    queryFn: () =>
      get<{ points: TracePoint[]; version: number; submittedAt: string } | null>(`/races/${id}/trace`),
    enabled: !!id,
  });
  const serverSetup = useQuery({
    queryKey: ['setup', id, me?.id],
    queryFn: () => get<{ setup: CarSetup; updatedAt: string } | null>(`/races/${id}/setup`),
    enabled: !!id,
  });

  const [offsets, setOffsets] = useState<Float64Array | null>(null);
  const [setup, setSetup] = useState<CarSetup | null>(null);

  // Estado inicial: servidor > rascunho local > padrão.
  useEffect(() => {
    if (!geo.data || offsets || serverTrace.isLoading) return;
    const pts = serverTrace.data?.points ?? loadDraft<TracePoint[]>(draftKey(id!, 'trace'));
    setOffsets(pts ? traceToOffsets(geo.data, pts) : new Float64Array(geo.data.count));
  }, [geo.data, serverTrace.isLoading, serverTrace.data, offsets, id]);
  useEffect(() => {
    if (setup || serverSetup.isLoading || !practice.data) return;
    const lim = practice.data.limits;
    const fallback: CarSetup = {
      ...DEFAULT_SETUP,
      tyre: lim.allowedTyres.includes('medium') ? 'medium' : lim.allowedTyres[0]!,
      terrainPrep:
        race?.track.terrain === 'dirt' || race?.track.terrain === 'sand' ? race.track.terrain : 'asphalt',
    };
    setSetup(serverSetup.data?.setup ?? loadDraft<CarSetup>(draftKey(id!, 'setup')) ?? fallback);
  }, [serverSetup.isLoading, serverSetup.data, setup, practice.data, id, race?.track.terrain]);

  if (isLoading || !race) return <Spinner />;
  const entry = race.me?.entry;
  if (!entry || (entry.status !== 'confirmed' && entry.status !== 'waitlisted'))
    return (
      <Empty title="Você não está inscrito nesta corrida" icon="🔒">
        <Link className="btn-primary mt-3" to={`/corridas/${id}`}>
          Ver corrida
        </Link>
      </Empty>
    );
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/corridas/${id}`} className="text-sm text-muted hover:text-ink">
            ← {race.name}
          </Link>
          <h1 className="font-display text-2xl">Box · {race.track.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          <PhaseBadge phase={race.status} />
          {race.phaseDeadline && <Countdown to={race.phaseDeadline} className="text-2xl" />}
        </div>
      </header>
      <Tabs
        value={tab}
        onChange={(v) => setParams({ aba: v }, { replace: true })}
        items={[
          { value: 'tracado', label: '✍️ Traçado' },
          { value: 'setup', label: '🔧 Setup' },
          { value: 'treino', label: '⏱️ Treino' },
        ]}
      />
      {!geo.data || !offsets || !setup || !practice.data ? (
        <Spinner />
      ) : tab === 'tracado' ? (
        <TraceTab
          race={race}
          g={geo.data}
          offsets={offsets}
          setOffsets={setOffsets}
          setup={setup}
          practice={practice.data}
          serverVersion={serverTrace.data?.version ?? null}
        />
      ) : tab === 'setup' ? (
        <SetupTab
          race={race}
          g={geo.data}
          offsets={offsets}
          setup={setup}
          setSetup={setSetup}
          practice={practice.data}
        />
      ) : (
        <PracticeTab race={race} g={geo.data} offsets={offsets} setup={setup} practice={practice.data} />
      )}
    </div>
  );
}

// ======================================================================================
// Traçado
// ======================================================================================

type Mode = 'draw' | 'erase' | 'pan';

function TraceTab({
  race,
  g,
  offsets,
  setOffsets,
  setup,
  practice,
  serverVersion,
}: {
  race: RaceDetailDto;
  g: TrackGeometry;
  offsets: Float64Array;
  setOffsets: (o: Float64Array) => void;
  setup: CarSetup;
  practice: PracticeInfo;
  serverVersion: number | null;
}) {
  const me = useSession((s) => s.me);
  const qc = useQueryClient();
  const [scene, setScene] = useState<TrackScene | null>(null);
  const [mode, setMode] = useState<Mode>('draw');
  const [hist, setHist] = useState<{ past: Float64Array[]; future: Float64Array[] }>({
    past: [],
    future: [],
  });
  const [heat, setHeat] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err' | 'pending' | 'idle'; text: string }>(
    serverVersion
      ? { tone: 'ok', text: `Traçado oficial v${serverVersion} salvo no servidor.` }
      : { tone: 'idle', text: 'Nenhum traçado enviado ainda.' },
  );
  const stroke = useRef<{ x: number; y: number }[]>([]);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const now = useServerNow(500);
  const deadline = Date.parse(race.timeline.setupLockAt);
  const windowOpen = race.status === 'trace_window' && now < deadline;
  const editable = ['registration_open', 'practice', 'trace_window'].includes(race.status) && now < deadline;
  const submitTimer = useRef<number | null>(null);
  const lastSent = useRef(0);

  const trace = useMemo(() => offsetsToTrace(offsets, 256), [offsets]);
  const validation = useMemo(() => validateTrace(g, trace), [g, trace]);
  const est = useMemo(
    () => estimateLap(g, setup, trace, practice.weather.base, practice.weather.temperature, practice.laps),
    [g, setup, trace, practice],
  );

  // Desenha a linha do jogador.
  useEffect(() => {
    if (!scene) return;
    const path = racingLine(g, offsets);
    scene.setLine('line', path, {
      closed: true,
      widthPx: 4,
      color: validation.ok ? 0xffcc00 : 0xff5a5a,
      ...(heat ? { colors: speedColors(est.profile) } : {}),
    });
  }, [scene, g, offsets, validation.ok, heat, est.profile]);
  useEffect(() => {
    if (scene) scene.mode = mode === 'pan' || !editable ? 'pan' : 'draw';
  }, [scene, mode, editable]);

  const submit = useCallback(
    async (pts: TracePoint[]) => {
      const wait = 2100 - (Date.now() - lastSent.current);
      if (wait > 0) {
        if (submitTimer.current) clearTimeout(submitTimer.current);
        submitTimer.current = window.setTimeout(
          () => void submit(offsetsToTrace(offsetsRef.current, 256)),
          wait,
        );
        return;
      }
      lastSent.current = Date.now();
      setStatus({ tone: 'pending', text: 'Enviando…' });
      try {
        const r = await put<{ version: number; submittedAt: string }>(`/races/${race.id}/trace`, {
          points: pts,
        });
        setStatus({
          tone: 'ok',
          text: `Traçado oficial v${r.version} salvo às ${new Date(r.submittedAt).toLocaleTimeString('pt-BR')}.`,
        });
        scene?.setMarkers('err', null);
        qc.setQueryData(['trace', race.id, me?.id], {
          points: pts,
          version: r.version,
          submittedAt: r.submittedAt,
        });
        void qc.invalidateQueries({ queryKey: ['race', race.id] });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'TRACE_RATE_LIMITED') {
          // Outro envio acabou de passar: tenta de novo com a versão mais recente em instantes.
          lastSent.current = Date.now();
          if (submitTimer.current) clearTimeout(submitTimer.current);
          submitTimer.current = window.setTimeout(
            () => void submit(offsetsToTrace(offsetsRef.current, 256)),
            2200,
          );
          setStatus({ tone: 'pending', text: 'Aguardando para reenviar…' });
          return;
        }
        setStatus({ tone: 'err', text: errorMessage(e) });
        if (e instanceof ApiError && (e.details as { indices?: number[] })?.indices && scene) {
          const idx = (e.details as { indices: number[] }).indices;
          scene.setMarkers(
            'err',
            idx.map((i) => ({
              ...traceToWorld(g, pts[i]!.s, Math.max(-1, Math.min(1, pts[i]!.d))),
              color: 0xff3030,
              r: 6,
            })),
          );
        }
      }
    },
    [race.id, scene, g, qc, me?.id],
  );

  const commit = useCallback(
    (next: Float64Array) => {
      setHist((h) => ({ past: [...h.past.slice(-40), offsetsRef.current], future: [] }));
      setOffsets(next);
      const pts = offsetsToTrace(next, 256);
      saveDraft(draftKey(race.id, 'trace'), pts);
      if (windowOpen && validateTrace(g, pts).ok) {
        if (submitTimer.current) clearTimeout(submitTimer.current);
        submitTimer.current = window.setTimeout(() => void submit(pts), 600);
      }
    },
    [setOffsets, race.id, windowOpen, g, submit],
  );

  // Envio automático do rascunho quando a janela abre com a página aberta.
  useEffect(() => {
    if (windowOpen && !serverVersion && !autoSubmitted.has(race.id) && validation.ok) {
      autoSubmitted.add(race.id);
      void submit(trace);
      toast(
        'Janela de traçado aberta!',
        'Seu rascunho foi enviado. Você pode continuar ajustando por 5 minutos.',
        'warn',
      );
    }
  }, [windowOpen, serverVersion, validation.ok, submit, trace, race.id]);
  useRoom(me ? ROOM.user(me.id) : null, (env) => {
    if (env.type === 'trace.rejected')
      setStatus({ tone: 'err', text: (env.payload as { message: string }).message });
  });

  // Entrada de desenho.
  useEffect(() => {
    if (!scene) return;
    scene.onPointer = (e) => {
      if (e.type === 'down') stroke.current = [{ x: e.x, y: e.y }];
      else if (e.type === 'move') {
        const last = stroke.current[stroke.current.length - 1];
        if (last && Math.hypot(e.x - last.x, e.y - last.y) < 0.8) return;
        stroke.current.push({ x: e.x, y: e.y });
        scene.setLine(
          'stroke',
          stroke.current.flatMap((p) => [p.x, p.y]),
          { widthPx: 3, color: mode === 'erase' ? 0xffffff : 0x4cc9f0, alpha: 0.9 },
        );
      } else if (e.type === 'cancel') {
        stroke.current = [];
        scene.setLine('stroke', null);
      } else if (e.type === 'up') {
        const pts = stroke.current;
        stroke.current = [];
        scene.setLine('stroke', null);
        if (pts.length < 2) return;
        const cur = offsetsRef.current;
        let next: Float64Array;
        if (mode === 'erase') {
          // Borracha: volta o trecho tocado para a linha central.
          const centered = pts.map((p) => {
            const pr = projectToTrack(g, p.x, p.y);
            return traceToWorld(g, pr.s, 0);
          });
          next = strokeToOffsets(g, cur, centered).offsets;
        } else {
          const r = strokeToOffsets(g, cur, chaikin(pts, 2));
          next = r.offsets;
          if (r.outside > 0) {
            scene.setMarkers(
              'out',
              pts
                .filter((p) => Math.abs(projectToTrack(g, p.x, p.y).d) > 1)
                .map((p) => ({ ...p, color: 0xff3030, r: 4 })),
            );
            setTimeout(() => scene.setMarkers('out', null), 2000);
            toast(
              'Fora da pista',
              `${r.outside} ponto(s) do traço estavam fora dos limites e foram trazidos para a borda.`,
              'warn',
            );
          }
        }
        commit(enforceLateralRate(g, next));
      }
    };
    return () => {
      scene.onPointer = null;
    };
  }, [scene, g, mode, commit]);

  const undo = () => {
    setHist((h) => {
      const prev = h.past[h.past.length - 1];
      if (!prev) return h;
      setOffsets(prev);
      return { past: h.past.slice(0, -1), future: [offsetsRef.current, ...h.future] };
    });
  };
  const redo = () => {
    setHist((h) => {
      const [next, ...rest] = h.future;
      if (!next) return h;
      setOffsets(next);
      return { past: [...h.past, offsetsRef.current], future: rest };
    });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const delta = est.lapTimeMs - practice.reference.suggestedLapMs;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="relative">
          <TrackCanvas
            geometry={g}
            onReady={setScene}
            className="h-[62dvh] min-h-[380px]"
            label="Pista para desenhar o traçado"
          />
          <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
            <div
              className="pointer-events-auto flex gap-1 rounded-2xl bg-night/85 p-1 backdrop-blur"
              role="toolbar"
              aria-label="Ferramentas de desenho"
            >
              {(
                [
                  ['draw', PenLine, 'Desenhar'],
                  ['erase', Eraser, 'Borracha'],
                  ['pan', Hand, 'Mover'],
                ] as const
              ).map(([m, Icon, label]) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  aria-label={label}
                  title={label}
                  disabled={!editable && m !== 'pan'}
                  onClick={() => setMode(m)}
                  className={clsx(
                    'rounded-xl p-2',
                    mode === m ? 'bg-race text-night' : 'text-ink hover:bg-night-3',
                  )}
                >
                  <Icon size={18} />
                </button>
              ))}
              <span className="mx-1 w-px bg-line" />
              <button
                aria-label="Desfazer"
                title="Desfazer (Ctrl+Z)"
                disabled={!hist.past.length || !editable}
                onClick={undo}
                className="rounded-xl p-2 hover:bg-night-3 disabled:opacity-40"
              >
                <Undo2 size={18} />
              </button>
              <button
                aria-label="Refazer"
                title="Refazer (Ctrl+Shift+Z)"
                disabled={!hist.future.length || !editable}
                onClick={redo}
                className="rounded-xl p-2 hover:bg-night-3 disabled:opacity-40"
              >
                <Redo2 size={18} />
              </button>
            </div>
          </div>
          <CameraControls
            scene={scene}
            extra={
              <button
                className={clsx('btn-ghost size-10 !p-0', heat && '!bg-race !text-night')}
                aria-pressed={heat}
                aria-label="Mapa de velocidade"
                title="Colorir por velocidade"
                onClick={() => setHeat((h) => !h)}
              >
                <Gauge size={18} />
              </button>
            }
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          Desenhe com o mouse ou o dedo por cima da pista, no sentido da corrida. Use dois dedos para mover e
          dar zoom. Trechos não desenhados mantêm a linha anterior.
        </p>
      </div>
      <aside className="space-y-3">
        <div className={clsx('card', windowOpen && 'border-race')}>
          <div className="label">
            {windowOpen
              ? 'Janela de traçado aberta'
              : race.status === 'trace_window'
                ? 'Janela encerrada'
                : ['registration_open', 'practice'].includes(race.status)
                  ? 'Rascunho local'
                  : 'Traçado travado'}
          </div>
          {windowOpen ? (
            <Countdown to={deadline} className="text-4xl" />
          ) : ['registration_open', 'practice'].includes(race.status) ? (
            <p className="text-sm text-muted">
              A janela de 5 minutos abre às{' '}
              <b className="text-ink">{new Date(race.timeline.traceWindowAt).toLocaleTimeString('pt-BR')}</b>.
              Seu rascunho fica salvo neste aparelho e é enviado automaticamente quando a janela abrir, se
              esta página estiver aberta.
            </p>
          ) : (
            <p className="text-sm text-muted">Não é mais possível alterar o traçado.</p>
          )}
          <p
            role="status"
            className={clsx(
              'mt-2 rounded-xl p-2 text-sm',
              status.tone === 'ok'
                ? 'bg-go/10 text-go'
                : status.tone === 'err'
                  ? 'bg-hot/10 text-hot'
                  : 'bg-night-3 text-muted',
            )}
          >
            {status.text}
          </p>
          {windowOpen && (
            <button
              className="btn-primary mt-2 w-full"
              disabled={!validation.ok}
              onClick={() => void submit(trace)}
            >
              <Send size={16} /> Enviar agora
            </button>
          )}
          {!validation.ok && <p className="mt-2 text-xs text-hot">{validation.message}</p>}
        </div>
        <div className="card space-y-2">
          <div className="label">Linhas prontas</div>
          <button
            className="btn-ghost w-full"
            disabled={!editable}
            onClick={() => commit(enforceLateralRate(g, traceToOffsets(g, practice.suggestedTrace)))}
          >
            <Sparkles size={16} /> Linha sugerida
          </button>
          <button
            className="btn-ghost w-full"
            disabled={!editable}
            onClick={() => commit(new Float64Array(g.count))}
          >
            <AlignCenter size={16} /> Linha central
          </button>
        </div>
        <div className="card">
          <div className="label">Tempo estimado (seu setup)</div>
          <div className="font-mono text-3xl font-bold">{formatLapTime(est.lapTimeMs)}</div>
          <div className={clsx('text-sm font-bold', delta <= 0 ? 'text-go' : 'text-race')}>
            {delta <= 0 ? '−' : '+'}
            {(Math.abs(delta) / 1000).toFixed(3)}s vs. linha sugerida
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
            {est.sectorMs.map((s, i) => (
              <div key={i} className="rounded-lg bg-night p-1.5">
                <div className="text-muted">S{i + 1}</div>
                <div className="font-mono font-bold">{(s / 1000).toFixed(2)}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Estimativa de volta lançada no clima previsto. Na corrida contam tráfego, desgaste, clima real e
            estratégia.
          </p>
        </div>
      </aside>
    </div>
  );
}

// ======================================================================================
// Setup
// ======================================================================================

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  left,
  right,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  left?: string;
  right?: string;
  format?: (v: number) => string;
}) {
  return (
    <label className="block">
      <span className="label flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-ink">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#ffcc00]"
      />
      {(left || right) && (
        <span className="flex justify-between text-[11px] text-muted">
          <span>{left}</span>
          <span>{right}</span>
        </span>
      )}
    </label>
  );
}

function SetupTab({
  race,
  g,
  offsets,
  setup,
  setSetup,
  practice,
}: {
  race: RaceDetailDto;
  g: TrackGeometry;
  offsets: Float64Array;
  setup: CarSetup;
  setSetup: (s: CarSetup) => void;
  practice: PracticeInfo;
}) {
  const qc = useQueryClient();
  const now = useServerNow(1000);
  const editable =
    ['registration_open', 'practice', 'trace_window'].includes(race.status) &&
    now < Date.parse(race.timeline.setupLockAt);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lim = practice.limits;
  const trace = useMemo(() => offsetsToTrace(offsets, 256), [offsets]);
  const update = (patch: Partial<CarSetup>) => {
    const next = { ...setup, ...patch };
    setSetup(next);
    setDirty(true);
    saveDraft(draftKey(race.id, 'setup'), next);
  };
  const problems = checkSetupLimits(setup, { setupLimits: lim } as CategoryConfig, practice.laps);
  const dry = useMemo(
    () => estimateLap(g, setup, trace, 'dry', practice.weather.temperature, practice.laps),
    [g, setup, trace, practice],
  );
  const wet = useMemo(
    () => estimateLap(g, setup, trace, 'rain', practice.weather.temperature, practice.laps),
    [g, setup, trace, practice],
  );
  // Desgaste por volta ao longo da estratégia.
  const stint = useMemo(() => {
    const out: { lap: number; wear: number; tyre: Tyre; pit: boolean }[] = [];
    let wear = 0,
      tyre = setup.tyre;
    for (let lap = 1; lap <= practice.laps; lap++) {
      const e = estimateLap(
        g,
        { ...setup, tyre },
        trace,
        practice.weather.base,
        practice.weather.temperature,
        practice.laps,
      );
      wear += e.wearPerLap;
      const stop = setup.pitStops.find((p) => p.lap === lap);
      out.push({ lap, wear, tyre, pit: !!stop });
      if (stop) {
        tyre = stop.tyre;
        wear = 0;
      }
    }
    return out;
  }, [g, setup, trace, practice]);
  async function save() {
    setSaving(true);
    try {
      await put(`/races/${race.id}/setup`, setup);
      setDirty(false);
      toast('Setup salvo ✅', undefined, 'ok');
      void qc.invalidateQueries({ queryKey: ['race', race.id] });
    } catch (e) {
      toast('Setup recusado', errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }
  const tyreOpt = (t: Tyre) => ({
    value: t,
    disabled: !lim.allowedTyres.includes(t),
    label: (
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-full" style={{ background: TYRE_COLOR[t] }} />
        {TYRE_LABELS[t]}
      </span>
    ),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {!editable && (
          <p className="card border-violet text-sm">
            🔒 Parque fechado: o setup está travado para a classificação e a corrida.
          </p>
        )}
        <fieldset className="card space-y-4" disabled={!editable}>
          <legend className="font-display text-lg">Pneus e estratégia</legend>
          <div>
            <span className="label">Composto de largada</span>
            <Segmented
              label="Composto de largada"
              value={setup.tyre}
              onChange={(v) => update({ tyre: v })}
              options={(['soft', 'medium', 'hard', 'wet'] as Tyre[]).map(tyreOpt)}
            />
          </div>
          <div>
            <span className="label">Paradas nos boxes (máx. {lim.maxPitStops})</span>
            <ul className="space-y-2">
              {setup.pitStops.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-night p-2">
                  <label className="flex items-center gap-2 text-sm">
                    Fim da volta
                    <input
                      type="number"
                      min={1}
                      max={practice.laps - 1}
                      value={p.lap}
                      className="input !w-20 !py-1"
                      onChange={(e) =>
                        update({
                          pitStops: setup.pitStops.map((x, k) =>
                            k === i ? { ...x, lap: Number(e.target.value) } : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <Segmented
                    label={`Composto da parada ${i + 1}`}
                    value={p.tyre}
                    onChange={(v) =>
                      update({ pitStops: setup.pitStops.map((x, k) => (k === i ? { ...x, tyre: v } : x)) })
                    }
                    options={(['soft', 'medium', 'hard', 'wet'] as Tyre[]).map(tyreOpt)}
                  />
                  <button
                    type="button"
                    className="ml-auto text-sm text-hot"
                    onClick={() => update({ pitStops: setup.pitStops.filter((_, k) => k !== i) })}
                  >
                    remover
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn-ghost mt-2 !py-1.5"
              disabled={setup.pitStops.length >= lim.maxPitStops || practice.laps < 2}
              onClick={() =>
                update({
                  pitStops: [
                    ...setup.pitStops,
                    {
                      lap: Math.min(
                        practice.laps - 1,
                        (setup.pitStops.at(-1)?.lap ?? 0) + Math.max(1, Math.floor(practice.laps / 2)),
                      ),
                      tyre: 'medium',
                    },
                  ],
                })
              }
            >
              + adicionar parada
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Slider
              label="Calibragem dianteira"
              value={setup.tyrePressure.front}
              min={18}
              max={28}
              step={0.5}
              format={(v) => `${v} psi`}
              onChange={(v) => update({ tyrePressure: { ...setup.tyrePressure, front: v } })}
              left="mais aderência"
              right="menos atrito"
            />
            <Slider
              label="Calibragem traseira"
              value={setup.tyrePressure.rear}
              min={18}
              max={28}
              step={0.5}
              format={(v) => `${v} psi`}
              onChange={(v) => update({ tyrePressure: { ...setup.tyrePressure, rear: v } })}
              left="mais aderência"
              right="menos atrito"
            />
          </div>
        </fieldset>
        <fieldset className="card space-y-4" disabled={!editable}>
          <legend className="font-display text-lg">Carro</legend>
          <Slider
            label="Pressão aerodinâmica"
            value={setup.aero}
            min={lim.aero.min}
            max={lim.aero.max}
            onChange={(v) => update({ aero: v })}
            left="reta veloz"
            right="curvas coladas"
          />
          <div>
            <span className="label">Mapa do motor</span>
            <Segmented
              label="Mapa do motor"
              value={setup.engine}
              onChange={(v) => update({ engine: v })}
              options={[
                {
                  value: 'economy',
                  label: '🍃 Econômico',
                  disabled: !lim.allowedEngines.includes('economy'),
                },
                {
                  value: 'balanced',
                  label: '⚖️ Equilibrado',
                  disabled: !lim.allowedEngines.includes('balanced'),
                },
                { value: 'power', label: '🔥 Potência', disabled: !lim.allowedEngines.includes('power') },
              ]}
            />
            <p className="mt-1 text-xs text-muted">
              Potência acelera mais, mas gasta pneus e pode quebrar. Econômico poupa pneus.
            </p>
          </div>
          <Slider
            label="Relação de câmbio"
            value={setup.gearing}
            min={1}
            max={10}
            onChange={(v) => update({ gearing: v })}
            left="curta (arrancada)"
            right="longa (velocidade final)"
          />
          <div>
            <span className="label">Preparação para o terreno</span>
            <Segmented
              label="Preparação para o terreno"
              value={setup.terrainPrep}
              onChange={(v) => update({ terrainPrep: v })}
              options={[
                { value: 'asphalt', label: 'Asfalto' },
                { value: 'dirt', label: 'Terra' },
                { value: 'sand', label: 'Areia' },
              ]}
            />
          </div>
          <div>
            <span className="label">Aposta de clima</span>
            <Segmented
              label="Aposta de clima"
              value={setup.weatherBet}
              onChange={(v) => update({ weatherBet: v })}
              options={[
                { value: 'dry', label: '☀️ Seco' },
                { value: 'mixed', label: '⛅ Misto' },
                { value: 'wet', label: '🌧️ Chuva' },
              ]}
            />
            <p className="mt-1 text-xs text-muted">
              Previsão: {WEATHER_ICON[practice.weather.base]} {WEATHER_LABEL[practice.weather.base]}, chance
              de chuva {Math.round(practice.weather.rainChance * 100)}%.
            </p>
          </div>
        </fieldset>
      </div>
      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div className="card">
          <div className="label">Prévia</div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-night p-2">
              <dt className="text-xs text-muted">Volta no seco</dt>
              <dd className="font-mono font-bold">{formatLapTime(dry.lapTimeMs)}</dd>
            </div>
            <div className="rounded-xl bg-night p-2">
              <dt className="text-xs text-muted">Volta na chuva</dt>
              <dd className="font-mono font-bold">{formatLapTime(wet.lapTimeMs)}</dd>
            </div>
            <div className="rounded-xl bg-night p-2">
              <dt className="text-xs text-muted">Velocidade máx.</dt>
              <dd className="font-mono font-bold">{dry.topSpeedKmh} km/h</dd>
            </div>
            <div className="rounded-xl bg-night p-2">
              <dt className="text-xs text-muted">Pneu até o limite</dt>
              <dd className="font-mono font-bold">{dry.lapsToCliff} voltas</dd>
            </div>
          </dl>
          <div className="mt-3">
            <div className="label">Desgaste por volta</div>
            <div
              className="flex h-24 items-end gap-1"
              role="img"
              aria-label="Gráfico de desgaste dos pneus por volta"
            >
              {stint.map((s) => (
                <div key={s.lap} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5">
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max(2, Math.min(1, s.wear) * 80)}px`,
                      background: s.wear > 0.75 ? '#ff5a5a' : TYRE_COLOR[s.tyre],
                    }}
                    title={`Volta ${s.lap}: ${Math.round(s.wear * 100)}%`}
                  />
                  <span className="text-[9px] text-muted">{s.pit ? '🔧' : s.lap}</span>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">
              Acima de 75% o pneu perde aderência rapidamente e pode furar.
            </p>
          </div>
        </div>
        {problems.length > 0 && (
          <div className="card border-hot text-sm text-hot">
            {problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        )}
        <button
          className="btn-primary w-full"
          disabled={!editable || saving || problems.length > 0}
          onClick={save}
        >
          {saving ? 'Salvando…' : dirty || !race.me?.hasSetup ? 'Salvar setup' : 'Setup salvo ✓'}
        </button>
      </aside>
    </div>
  );
}

// ======================================================================================
// Treino
// ======================================================================================

function PracticeTab({
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
  const [raceSim, setRaceSim] = useState<{ results: CarResult[]; me: string } | null>(null);
  const trace = useMemo(() => offsetsToTrace(offsets, 256), [offsets]);
  const est = useMemo(
    () => estimateLap(g, setup, trace, weather, practice.weather.temperature, practice.laps),
    [g, setup, trace, weather, practice],
  );
  useEffect(() => {
    scene?.setLine('line', racingLine(g, offsets), {
      closed: true,
      widthPx: 4,
      colors: speedColors(est.profile),
    });
  }, [scene, g, offsets, est.profile]);
  const best = runs.length ? Math.min(...runs.map((r) => r.lapMs)) : null;
  function runRace() {
    // Corrida de teste local contra 5 "fantasmas" com a linha sugerida e setups variados.
    const ghosts: CarSetup[] = (['soft', 'medium', 'hard', 'medium', 'soft'] as Tyre[]).map((t, i) => ({
      ...DEFAULT_SETUP,
      tyre: t,
      aero: 3 + i,
      pitStops:
        t === 'soft' && practice.laps > 3
          ? [{ lap: Math.floor(practice.laps / 2), tyre: 'medium' as Tyre }]
          : [],
    }));
    const cars = [
      { id: 'voce', setup, trace },
      ...ghosts.map((s, i) => ({ id: `Fantasma ${i + 1}`, setup: s, trace: practice.suggestedTrace })),
    ];
    const out = simulateRace({
      geometry: g,
      cars,
      laps: practice.laps,
      seed: `treino-${Date.now()}`,
      weather: { ...practice.weather, base: weather },
      randomEvents: { safetyCar: false, oil: false, mechanical: false },
    });
    setRaceSim({ results: out.results, me: 'voce' });
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="relative self-start">
        <TrackCanvas
          geometry={g}
          onReady={setScene}
          className="h-[55dvh] min-h-[340px]"
          label="Mapa de velocidade do treino"
        />
        <CameraControls scene={scene} />
        <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-night/80 px-3 py-1.5 text-xs font-bold">
          <span className="text-sky">lento</span> → <span className="text-race">rápido</span>
        </div>
      </div>
      <aside className="space-y-3">
        <div className="card space-y-3">
          <div className="label">Condição do treino</div>
          <Segmented
            label="Clima do treino"
            value={weather}
            onChange={setWeather}
            options={(['dry', 'cloudy', 'light_rain', 'rain'] as Weather[]).map((w) => ({
              value: w,
              label: WEATHER_ICON[w],
            }))}
          />
          <button
            className="btn-go w-full"
            onClick={() =>
              setRuns((r) =>
                [{ n: r.length + 1, lapMs: est.lapTimeMs, sectors: est.sectorMs, weather }, ...r].slice(
                  0,
                  12,
                ),
              )
            }
          >
            ⏱️ Volta de treino
          </button>
          <button className="btn-ghost w-full" onClick={runRace}>
            🏁 Corrida de teste ({practice.laps} voltas)
          </button>
          <p className="text-xs text-muted">
            O treino roda no seu aparelho e não vale para o resultado oficial. Referência do servidor (linha
            sugerida, setup padrão): {formatLapTime(practice.reference.suggestedLapMs)}.
          </p>
        </div>
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
        {raceSim && (
          <div className="card">
            <div className="label">Corrida de teste</div>
            <ol className="space-y-1 text-sm">
              {raceSim.results.map((r) => (
                <li
                  key={r.id}
                  className={clsx('flex justify-between', r.id === raceSim.me && 'font-bold text-race')}
                >
                  <span>
                    {r.position}. {r.id === 'voce' ? 'Você' : r.id} {r.pitStops ? `🔧${r.pitStops}` : ''}
                  </span>
                  <span className="font-mono">
                    {r.status === 'finished' ? formatLapTime(r.totalTimeMs) : 'abandono'}
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
