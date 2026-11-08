import { formatLapTime, ROOM, type CarSetup, type RaceDetailDto, type TracePoint } from '@tracado/shared';
import { estimateLap } from '@tracado/sim';
import {
  CAR_HALF_WIDTH,
  enforceLateralRate,
  handlesToOffsets,
  offsetsToHandles,
  offsetsToTrace,
  racingLine,
  traceHandleIndices,
  traceToOffsets,
  traceToWorld,
  validateTrace,
  type TrackGeometry,
} from '@tracado/trackgen';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlignCenter,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Gauge,
  Redo2,
  Send,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraControls, TrackCanvas } from '../../components/TrackCanvas';
import { Countdown, toast } from '../../components/ui';
import type { Marker, TrackScene } from '../../game/scene';
import { ApiError, errorMessage, put } from '../../lib/api';
import { useRoom, useServerNow } from '../../lib/realtime';
import { useSession } from '../../lib/session';
import {
  draftKey,
  isSetupEditable,
  saveDraft,
  speedColors,
  useRaceDriver,
  type PracticeInfo,
} from './common';

/** Duração da janela de traçado em texto ("2 minutos", "90 segundos"). */
const fmtWindow = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s % 60 === 0 ? `${s / 60} ${s === 60 ? 'minuto' : 'minutos'}` : `${s} segundos`;
};

/** Corridas cujo rascunho já foi enviado automaticamente nesta aba (sobrevive a remontagens do componente). */
const autoSubmitted = new Set<string>();

/** Raio (px de tela) em que um toque pega o ponto de controle. */
const GRAB_PX = 26;
const NUDGE = 0.15;

export function TraceTab({
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
  const [hist, setHist] = useState<{ past: Float64Array[]; future: Float64Array[] }>({
    past: [],
    future: [],
  });
  const [heat, setHeat] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err' | 'pending' | 'idle'; text: string }>(
    serverVersion
      ? { tone: 'ok', text: `Traçado oficial v${serverVersion} salvo no servidor.` }
      : {
          tone: 'idle',
          text: 'Nenhum traçado salvo ainda: sem ele o carro corre na linha central, 1,5% mais lento.',
        },
  );
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const now = useServerNow(500);
  const deadline = Date.parse(race.timeline.setupLockAt);
  const windowOpen = race.status === 'trace_window' && now < deadline;
  // Quem está confirmado salva o traçado no servidor a cada ajuste até o parque fechado.
  const editable = isSetupEditable(race.status, race.timeline.setupLockAt, now);
  const canSend = editable && race.me?.entry?.status === 'confirmed';
  const submitTimer = useRef<number | null>(null);
  const lastSent = useRef(0);

  // Pontos de controle: índices fixos ao longo da pista; o valor é o deslocamento lateral (-1..1).
  const idx = useMemo(() => traceHandleIndices(g), [g]);
  const values = useMemo(() => offsetsToHandles(offsets, idx), [offsets, idx]);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const trace = useMemo(() => offsetsToTrace(offsets, 256), [offsets]);
  const validation = useMemo(() => validateTrace(g, trace), [g, trace]);
  const driver = useRaceDriver(setup);
  const est = useMemo(
    () =>
      estimateLap(
        g,
        setup,
        trace,
        practice.weather.base,
        practice.weather.temperature,
        practice.laps,
        0,
        driver,
      ),
    [g, setup, trace, practice, driver],
  );

  const handlePos = useCallback((k: number, d: number) => traceToWorld(g, idx[k]! / g.count, d), [g, idx]);
  /** O lado "+d" é a esquerda de quem pilota? (para os botões ← →). */
  const plusIsLeft = useCallback(
    (k: number) => {
      const i = idx[k]!,
        j = (i + 1) % g.count;
      const tx = g.points[j * 2]! - g.points[i * 2]!,
        ty = g.points[j * 2 + 1]! - g.points[i * 2 + 1]!;
      // Com y para baixo na tela, a esquerda de quem segue (tx, ty) é (ty, -tx).
      return g.normals[i * 2]! * ty - g.normals[i * 2 + 1]! * tx > 0;
    },
    [g, idx],
  );

  const drawHandles = useCallback(
    (vals: number[], active: number | null) => {
      if (!scene) return;
      const pts: Marker[] = vals.map((d, k) => ({
        ...handlePos(k, d),
        color: k === active ? 0x4cc9f0 : Math.abs(d) < 0.02 ? 0xffffff : 0xffcc00,
        r: k === active ? 10 : 7,
        stroke: 0x0b1026,
        ring: 2.5,
      }));
      scene.setMarkers('handles', editable ? pts : null);
    },
    [scene, handlePos, editable],
  );
  const drawLine = useCallback(
    (off: Float64Array, ok: boolean, colors?: number[]) => {
      scene?.setLine('line', racingLine(g, off), {
        closed: true,
        widthPx: 4,
        color: ok ? 0xffcc00 : 0xff5a5a,
        ...(colors ? { colors } : {}),
      });
    },
    [scene, g],
  );

  useEffect(() => {
    drawLine(offsets, validation.ok, heat ? speedColors(est.profile) : undefined);
  }, [drawLine, offsets, validation.ok, heat, est.profile]);
  useEffect(() => drawHandles(values, selected), [drawHandles, values, selected]);
  useEffect(() => {
    if (scene) scene.mode = editable ? 'draw' : 'pan';
  }, [scene, editable]);

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
          const bad = (e.details as { indices: number[] }).indices;
          scene.setMarkers(
            'err',
            bad.map((i) => ({
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
      saveDraft(draftKey(`${race.id}:${race.track.versionId}`, 'trace'), pts);
      if (canSend && validateTrace(g, pts).ok) {
        if (submitTimer.current) clearTimeout(submitTimer.current);
        submitTimer.current = window.setTimeout(() => void submit(pts), 600);
      }
    },
    [setOffsets, race.id, race.track.versionId, canSend, g, submit],
  );
  const fromHandles = useCallback(
    (vals: number[]) => enforceLateralRate(g, handlesToOffsets(g, idx, vals)),
    [g, idx],
  );
  const setHandle = (k: number, d: number) => {
    const vals = [...valuesRef.current];
    vals[k] = Math.max(-1, Math.min(1, d));
    commit(fromHandles(vals));
  };

  // Rascunho feito antes (neste aparelho) e ainda não salvo no servidor: envia assim que for possível.
  // A linha central intocada não é enviada (sem traçado, a corrida já usa a central, com penalidade).
  const drawn = useMemo(() => offsets.some((v) => Math.abs(v) > 1e-6), [offsets]);
  useEffect(() => {
    if (canSend && drawn && !serverVersion && !autoSubmitted.has(race.id) && validation.ok) {
      autoSubmitted.add(race.id);
      void submit(trace);
      toast('Traçado salvo', 'Seu desenho foi salvo no servidor e já vale para a corrida.', 'ok');
    }
  }, [canSend, drawn, serverVersion, validation.ok, submit, trace, race.id]);
  useRoom(me ? ROOM.user(me.id) : null, (env) => {
    if (env.type === 'trace.rejected')
      setStatus({ tone: 'err', text: (env.payload as { message: string }).message });
  });

  // Arrastar pontos de controle. Fora deles, o arraste move a câmera (a cena decide pelo grabTest).
  const drag = useRef<{ k: number; vals: number[]; moved: boolean; preview: Float64Array | null } | null>(
    null,
  );
  const lastTap = useRef<{ k: number; t: number } | null>(null);
  useEffect(() => {
    if (!scene) return;
    const nearest = (x: number, y: number) => {
      const lim = GRAB_PX / scene.zoom;
      let best = -1,
        bestD = lim;
      valuesRef.current.forEach((d, k) => {
        const p = handlePos(k, d);
        const dist = Math.hypot(p.x - x, p.y - y);
        if (dist < bestD) {
          bestD = dist;
          best = k;
        }
      });
      return best;
    };
    const lateral = (i: number, x: number, y: number) => {
      const usable = Math.max(0.5, g.widths[i]! / 2 - CAR_HALF_WIDTH);
      const d =
        ((x - g.points[i * 2]!) * g.normals[i * 2]! + (y - g.points[i * 2 + 1]!) * g.normals[i * 2 + 1]!) /
        usable;
      return Math.max(-1, Math.min(1, d));
    };
    scene.grabTest = (x, y) => nearest(x, y) >= 0;
    scene.onPointer = (e) => {
      if (e.type === 'down') {
        const k = nearest(e.x, e.y);
        if (k < 0) return;
        drag.current = { k, vals: [...valuesRef.current], moved: false, preview: null };
        setSelected(k);
      } else if (e.type === 'move' && drag.current) {
        const dr = drag.current;
        const d = lateral(idx[dr.k]!, e.x, e.y);
        if (!dr.moved && Math.abs(d - dr.vals[dr.k]!) < 0.03) return;
        dr.moved = true;
        dr.vals[dr.k] = d;
        dr.preview = fromHandles(dr.vals);
        drawLine(dr.preview, true);
        drawHandles(dr.vals, dr.k);
      } else if (e.type === 'cancel') {
        drag.current = null;
        drawLine(offsetsRef.current, true);
        drawHandles(valuesRef.current, null);
      } else if (e.type === 'up' && drag.current) {
        const dr = drag.current;
        drag.current = null;
        if (dr.moved && dr.preview) {
          commit(dr.preview);
          lastTap.current = null;
          return;
        }
        // Toque duplo no mesmo ponto: volta para o centro da pista.
        const t = performance.now();
        if (lastTap.current && lastTap.current.k === dr.k && t - lastTap.current.t < 400) {
          lastTap.current = null;
          const vals = [...valuesRef.current];
          vals[dr.k] = 0;
          commit(fromHandles(vals));
        } else lastTap.current = { k: dr.k, t };
      }
    };
    return () => {
      scene.onPointer = null;
      scene.grabTest = null;
    };
  }, [scene, g, idx, handlePos, fromHandles, drawLine, drawHandles, commit]);

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

  const focusHandle = (k: number) => {
    setSelected(k);
    if (!scene) return;
    const p = handlePos(k, valuesRef.current[k]!);
    if (scene.zoom < 3) scene.setZoom(3);
    scene.centerOn(p.x, p.y);
  };
  const sel = selected !== null && selected < idx.length ? selected : null;
  const selLeft = sel !== null ? plusIsLeft(sel) : true;
  const selValue = sel !== null ? values[sel]! : 0;
  // Lado do piloto: positivo = esquerda.
  const driverSide = sel !== null ? (selLeft ? selValue : -selValue) : 0;
  const nudge = (towardLeft: boolean) => {
    if (sel === null) return;
    const dir = towardLeft === selLeft ? 1 : -1;
    setHandle(sel, selValue + dir * NUDGE);
  };

  const delta = est.lapTimeMs - practice.reference.suggestedLapMs;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="relative">
          <TrackCanvas
            geometry={g}
            biome={race.track.biome}
            onReady={setScene}
            className="h-[62dvh] min-h-[380px]"
            label="Pista para ajustar o traçado arrastando os pontos de controle"
          />
          <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
            <div
              className="pointer-events-auto flex gap-1 rounded-2xl bg-night/85 p-1 backdrop-blur"
              role="toolbar"
              aria-label="Ferramentas do traçado"
            >
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
              <span className="mx-1 w-px bg-line" />
              <button
                aria-label="Centralizar todos os pontos"
                title="Centralizar todos os pontos"
                disabled={!editable}
                onClick={() => commit(new Float64Array(g.count))}
                className="rounded-xl p-2 hover:bg-night-3 disabled:opacity-40"
              >
                <AlignCenter size={18} />
              </button>
              <button
                aria-label="Aplicar sugestão do engenheiro"
                title="Aplicar sugestão do engenheiro"
                disabled={!editable}
                onClick={() => commit(enforceLateralRate(g, traceToOffsets(g, practice.suggestedTrace)))}
                className="rounded-xl p-2 hover:bg-night-3 disabled:opacity-40"
              >
                <Sparkles size={18} />
              </button>
            </div>
          </div>
          {editable && sel !== null && (
            <div
              className="absolute inset-x-3 bottom-3 mr-14 flex flex-wrap items-center gap-2 rounded-2xl bg-night/90 p-2 text-sm backdrop-blur sm:inset-x-auto sm:left-3"
              role="group"
              aria-label={`Ponto ${sel + 1} de ${idx.length}`}
            >
              <button
                className="btn-ghost size-9 !p-0"
                aria-label="Ponto anterior"
                onClick={() => focusHandle((sel - 1 + idx.length) % idx.length)}
              >
                <ChevronLeft size={16} />
              </button>
              <div className="min-w-24 text-center">
                <div className="font-bold">
                  Ponto {sel + 1}/{idx.length}
                </div>
                <div className="text-xs text-muted">
                  {Math.abs(driverSide) < 0.02
                    ? 'no centro'
                    : `${Math.round(Math.abs(driverSide) * 100)}% à ${driverSide > 0 ? 'esquerda' : 'direita'}`}
                </div>
              </div>
              <button
                className="btn-ghost size-9 !p-0"
                aria-label="Próximo ponto"
                onClick={() => focusHandle((sel + 1) % idx.length)}
              >
                <ChevronRight size={16} />
              </button>
              <span className="mx-1 h-6 w-px bg-line" />
              <button
                className="btn-ghost !px-2.5 !py-1.5"
                onClick={() => nudge(true)}
                disabled={driverSide >= 1}
              >
                ← esquerda
              </button>
              <button
                className="btn-ghost !px-2.5 !py-1.5"
                aria-label="Centralizar este ponto"
                title="Centralizar este ponto"
                onClick={() => setHandle(sel, 0)}
              >
                <Crosshair size={16} />
              </button>
              <button
                className="btn-ghost !px-2.5 !py-1.5"
                onClick={() => nudge(false)}
                disabled={driverSide <= -1}
              >
                direita →
              </button>
            </div>
          )}
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
          A linha começa no meio da pista. <b className="text-ink">Arraste os pontos</b> para os lados para
          abrir antes da curva, tocar o ápice e sair aberto. Toque duas vezes num ponto para devolvê-lo ao
          centro. Arraste fora dos pontos para mover a pista; use a roda do mouse ou dois dedos para zoom.
        </p>
      </div>
      <aside className="space-y-3">
        <div className={clsx('card', windowOpen && 'border-race')}>
          <div className="label">
            {windowOpen
              ? 'Janela de traçado aberta'
              : canSend
                ? 'Traçado salvo a cada ajuste'
                : editable
                  ? 'Rascunho neste aparelho'
                  : 'Traçado travado'}
          </div>
          {windowOpen ? (
            <Countdown to={deadline} className="text-4xl" />
          ) : canSend ? (
            <p className="text-sm text-muted">
              Cada ajuste é salvo no servidor e já vale para a corrida, mesmo se você fechar a página.{' '}
              {race.timeline.setupLockAt > race.timeline.traceWindowAt ? (
                <>
                  A janela final de{' '}
                  {fmtWindow(Date.parse(race.timeline.setupLockAt) - Date.parse(race.timeline.traceWindowAt))}{' '}
                  abre às{' '}
                  <b className="text-ink">
                    {new Date(race.timeline.traceWindowAt).toLocaleTimeString('pt-BR')}
                  </b>{' '}
                  e o traçado
                </>
              ) : (
                'O traçado'
              )}{' '}
              trava às{' '}
              <b className="text-ink">{new Date(race.timeline.setupLockAt).toLocaleTimeString('pt-BR')}</b>
              {race.timeline.setupLockAt > race.timeline.traceWindowAt ? '' : ', no fim do treino'}.
            </p>
          ) : editable && race.me?.entry?.status === 'waitlisted' ? (
            <p className="text-sm text-muted">
              Você está na fila de espera: o desenho fica neste aparelho e é salvo no servidor quando sua vaga
              for confirmada (com esta página aberta).
            </p>
          ) : editable ? (
            <p className="text-sm text-muted">
              Treino livre: o desenho fica só neste aparelho. Inscreva-se para ele valer na corrida.
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
          {canSend && (
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
            <AlignCenter size={16} /> Tudo no centro
          </button>
        </div>
      </aside>
    </div>
  );
}
