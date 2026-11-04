import { formatLapTime, type EditorTrack, type Terrain, type TrackVersionDto } from '@tracado/shared';
import {
  buildEditorTrack,
  generateProceduralTrack,
  validateGeometry,
  type TrackGeometry,
  type ValidationIssue,
} from '@tracado/trackgen';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CameraControls, TrackCanvas } from '../../components/TrackCanvas';
import { Segmented, toast } from '../../components/ui';
import type { TrackScene } from '../../game/scene';
import { errorMessage, get, patch, post } from '../../lib/api';
import { fmtKm, TERRAIN_LABEL } from '../../lib/format';
import { isAdmin, useSession } from '../../lib/session';
import { AdminNav } from './AdminNav';

/** Formato inicial válido (mesmo da pista especial de demonstração). */
const STARTER: EditorTrack = {
  controlPoints: [
    [0, 0],
    [300, 0],
    [500, 0],
    [560, 40],
    [560, 120],
    [480, 160],
    [380, 160],
    [330, 220],
    [360, 300],
    [300, 360],
    [120, 360],
    [40, 300],
    [60, 200],
    [-40, 120],
    [-60, 40],
  ].map(([x, y]) => ({ x: x! * 1.3, y: y! * 1.3, width: 13 })),
  terrainSegments: [],
  baseTerrain: 'asphalt',
  startAt: 0.08,
  decorationSeed: 'especial',
};

type Tool = 'move' | 'add' | 'pan';

export default function TrackEditor() {
  const { versionId } = useParams();
  const me = useSession((s) => s.me);
  const nav = useNavigate();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['admin-tracks', 'special'],
    queryFn: () => get<(TrackVersionDto & { issues: unknown[] })[]>('/admin/tracks?kind=special'),
  });
  const existing = list.data?.find((t) => t.id === versionId);
  const [name, setName] = useState('Nova pista');
  const [ed, setEd] = useState<EditorTrack>(STARTER);
  const [sel, setSel] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>('move');
  const [scene, setScene] = useState<TrackScene | null>(null);
  const [estimate, setEstimate] = useState<{ lapTimeMs: number; topSpeedKmh: number } | null>(null);
  const [seed, setSeed] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    if (existing && !loaded.current && existing.source.type === 'editor') {
      loaded.current = true;
      setEd(existing.source.editor);
      setName(existing.trackName);
    }
  }, [existing]);

  const geo: { g: TrackGeometry | null; issues: ValidationIssue[]; error?: string } = useMemo(() => {
    try {
      const g = buildEditorTrack(ed);
      return { g, issues: validateGeometry(g) };
    } catch (e) {
      return { g: null, issues: [], error: String(e) };
    }
  }, [ed]);

  // Redesenha pista, pontos de controle e problemas.
  const fitted = useRef(false);
  useEffect(() => {
    if (!scene || !geo.g) return;
    scene.setGeometry(geo.g, !fitted.current);
    fitted.current = true;
    scene.setMarkers(
      'ctrl',
      ed.controlPoints.map((p, i) => ({
        x: p.x,
        y: p.y,
        color: i === sel ? 0xffcc00 : 0x4cc9f0,
        r: i === sel ? 9 : 7,
      })),
    );
    scene.setMarkers(
      'issues',
      geo.issues.filter((i) => i.at).map((i) => ({ ...i.at!, color: 0xff3030, r: 12 })),
    );
    scene.setLine(
      'ctrl-poly',
      ed.controlPoints.flatMap((p) => [p.x, p.y]),
      { closed: true, widthPx: 1.5, color: 0xffffff, alpha: 0.5 },
    );
  }, [scene, geo, ed.controlPoints, sel]);
  useEffect(() => {
    if (scene) scene.mode = tool === 'pan' ? 'pan' : 'draw';
  }, [scene, tool]);

  const edRef = useRef(ed);
  edRef.current = ed;
  useEffect(() => {
    if (!scene) return;
    let drag: number | null = null;
    scene.onPointer = (e) => {
      const pts = edRef.current.controlPoints;
      if (e.type === 'down') {
        const hit = pts.findIndex((p) => Math.hypot(p.x - e.x, p.y - e.y) < 14 / scene.zoom);
        if (tool === 'add' && hit < 0) {
          // Insere no segmento de controle mais próximo.
          let best = 0,
            bd = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i]!,
              b = pts[(i + 1) % pts.length]!;
            const vx = b.x - a.x,
              vy = b.y - a.y;
            const t = Math.max(
              0,
              Math.min(1, ((e.x - a.x) * vx + (e.y - a.y) * vy) / (vx * vx + vy * vy || 1)),
            );
            const d = Math.hypot(a.x + vx * t - e.x, a.y + vy * t - e.y);
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
          const w = pts[best]!.width;
          const next = [
            ...pts.slice(0, best + 1),
            { x: Math.round(e.x), y: Math.round(e.y), width: w },
            ...pts.slice(best + 1),
          ];
          setEd({ ...edRef.current, controlPoints: next });
          setSel(best + 1);
          return;
        }
        drag = hit >= 0 ? hit : null;
        setSel(hit >= 0 ? hit : null);
      } else if (e.type === 'move' && drag !== null) {
        const next = pts.map((p, i) => (i === drag ? { ...p, x: Math.round(e.x), y: Math.round(e.y) } : p));
        setEd({ ...edRef.current, controlPoints: next });
      } else if (e.type === 'up' || e.type === 'cancel') drag = null;
    };
    return () => {
      scene.onPointer = null;
    };
  }, [scene, tool]);

  const readOnlyVersion = existing && existing.status !== 'draft';
  async function save() {
    try {
      if (!existing) {
        const r = await post<TrackVersionDto>('/admin/tracks', { name, editor: ed });
        toast('Pista criada como rascunho', undefined, 'ok');
        nav(`/admin/pistas/editor/${r.id}`, { replace: true });
      } else if (existing.status === 'draft') {
        await patch(`/admin/tracks/versions/${existing.id}`, { editor: ed });
        toast('Rascunho salvo', undefined, 'ok');
      } else {
        const v = await post<{ id: string; version: number }>(`/admin/tracks/${existing.trackId}/versions`, {
          editor: ed,
        });
        toast(
          `Versão ${v.version} criada como rascunho`,
          'A versão publicada continua valendo nas corridas já agendadas.',
          'ok',
        );
        nav(`/admin/pistas/editor/${v.id}`, { replace: true });
      }
      void qc.invalidateQueries({ queryKey: ['admin-tracks'] });
    } catch (x) {
      toast('Erro ao salvar', errorMessage(x), 'error');
    }
  }
  async function estimateLap() {
    try {
      const r = await post<{
        estimate: { lapTimeMs: number; topSpeedKmh: number } | null;
        issues: unknown[];
      }>('/admin/tracks/preview', { editor: ed });
      setEstimate(r.estimate);
      if (!r.estimate) toast('Corrija os problemas antes de estimar', undefined, 'warn');
    } catch (x) {
      toast('Erro', errorMessage(x), 'error');
    }
  }
  async function act(action: 'submit' | 'publish') {
    if (!existing) return;
    try {
      await post(`/admin/tracks/versions/${existing.id}/${action}`);
      toast(action === 'publish' ? 'Pista publicada! 🎉' : 'Enviada para revisão', undefined, 'ok');
      void qc.invalidateQueries({ queryKey: ['admin-tracks'] });
    } catch (x) {
      toast('Ação recusada', errorMessage(x), 'error');
    }
  }
  function importSeed() {
    const g = generateProceduralTrack(seed || 'editor', {
      length: 2600,
      complexity: 0.6,
      width: 13,
      terrain: ed.baseTerrain,
    });
    const step = Math.max(1, Math.floor(g.count / 22));
    const cps = [];
    for (let i = 0; i < g.count; i += step)
      cps.push({
        x: Math.round(g.points[i * 2]!),
        y: Math.round(g.points[i * 2 + 1]!),
        width: Math.round(g.widths[i]!),
      });
    fitted.current = false;
    setEd({ ...ed, controlPoints: cps, startAt: 0 });
  }
  const selected = sel !== null ? ed.controlPoints[sel] : null;
  return (
    <div>
      <h1 className="mb-2 font-display text-3xl">Editor de pistas</h1>
      <AdminNav />
      {readOnlyVersion && (
        <p className="card mb-3 border-violet text-sm">
          Esta versão está {existing!.status === 'published' ? 'publicada' : existing!.status}: ao salvar, uma
          nova versão em rascunho será criada (versões publicadas são imutáveis).
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="relative self-start">
          <TrackCanvas
            geometry={geo.g}
            onReady={setScene}
            className="h-[68dvh] min-h-[420px]"
            label="Editor de pista"
          />
          <div
            className="absolute left-3 top-3 flex gap-1 rounded-2xl bg-night/85 p-1"
            role="toolbar"
            aria-label="Ferramentas do editor"
          >
            {(
              [
                ['move', 'Mover pontos'],
                ['add', 'Adicionar ponto'],
                ['pan', 'Navegar'],
              ] as const
            ).map(([t, l]) => (
              <button
                key={t}
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
                className={clsx(
                  'rounded-xl px-3 py-1.5 text-xs font-bold',
                  tool === t ? 'bg-race text-night' : 'hover:bg-night-3',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <CameraControls scene={scene} />
        </div>
        <aside className="space-y-3">
          <div className="card space-y-2">
            <label className="block">
              <span className="label">Nome</span>
              <input
                className="input"
                value={name}
                disabled={!!existing}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {geo.g && (
              <div className="text-sm text-muted">
                {fmtKm(geo.g.length)} · {geo.g.corners} curvas · raio mín. {geo.g.minRadius.toFixed(0)} m ·
                hash {geo.g.hash.slice(0, 8)}
              </div>
            )}
            <div
              className={clsx(
                'rounded-xl p-2 text-sm',
                geo.issues.length ? 'bg-hot/10 text-hot' : 'bg-go/10 text-go',
              )}
              role="status"
            >
              {geo.error
                ? geo.error
                : geo.issues.length
                  ? geo.issues.map((i) => <div key={i.code}>⚠️ {i.message}</div>)
                  : '✅ Pista válida'}
            </div>
            {estimate && (
              <div className="text-sm">
                Volta estimada: <b className="font-mono">{formatLapTime(estimate.lapTimeMs)}</b> ·{' '}
                {estimate.topSpeedKmh} km/h
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-primary" onClick={save}>
                Salvar
              </button>
              <button className="btn-ghost" onClick={estimateLap}>
                Estimar volta
              </button>
              {existing?.status === 'draft' && (
                <button className="btn-ghost" onClick={() => act('submit')}>
                  Submeter
                </button>
              )}
              {existing && isAdmin(me) && ['draft', 'review'].includes(existing.status) && (
                <button className="btn-go" disabled={geo.issues.length > 0} onClick={() => act('publish')}>
                  Publicar
                </button>
              )}
            </div>
          </div>
          <div className="card space-y-2">
            <div className="label">Ponto selecionado</div>
            {selected ? (
              <>
                <label className="block text-sm">
                  Largura: <b>{selected.width} m</b>
                  <input
                    type="range"
                    min={8}
                    max={24}
                    value={selected.width}
                    className="w-full accent-[#ffcc00]"
                    onChange={(e) =>
                      setEd({
                        ...ed,
                        controlPoints: ed.controlPoints.map((p, i) =>
                          i === sel ? { ...p, width: Number(e.target.value) } : p,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="btn-ghost w-full !py-1.5"
                  disabled={ed.controlPoints.length <= 4}
                  onClick={() => {
                    setEd({ ...ed, controlPoints: ed.controlPoints.filter((_, i) => i !== sel) });
                    setSel(null);
                  }}
                >
                  Remover ponto
                </button>
              </>
            ) : (
              <p className="text-xs text-muted">
                Clique em um ponto azul para selecioná-lo e arrastá-lo. Com “Adicionar ponto”, clique perto de
                um trecho.
              </p>
            )}
          </div>
          <div className="card space-y-3">
            <div>
              <span className="label">Terreno base</span>
              <Segmented
                label="Terreno base"
                value={ed.baseTerrain}
                onChange={(v) => setEd({ ...ed, baseTerrain: v })}
                options={(['asphalt', 'dirt', 'sand'] as Terrain[]).map((t) => ({
                  value: t,
                  label: TERRAIN_LABEL[t],
                }))}
              />
            </div>
            <label className="block text-sm">
              Posição da largada: <b>{Math.round(ed.startAt * 100)}%</b>
              <input
                type="range"
                min={0}
                max={0.99}
                step={0.01}
                value={ed.startAt}
                className="w-full accent-[#ffcc00]"
                onChange={(e) => setEd({ ...ed, startAt: Number(e.target.value) })}
              />
            </label>
            <div>
              <span className="label">Trechos de terreno</span>
              {ed.terrainSegments.map((s, k) => (
                <div key={k} className="mb-1 flex items-center gap-1 text-xs">
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={s.from}
                    className="input !w-16 !p-1"
                    aria-label="Início do trecho"
                    onChange={(e) =>
                      setEd({
                        ...ed,
                        terrainSegments: ed.terrainSegments.map((x, i) =>
                          i === k ? { ...x, from: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={s.to}
                    className="input !w-16 !p-1"
                    aria-label="Fim do trecho"
                    onChange={(e) =>
                      setEd({
                        ...ed,
                        terrainSegments: ed.terrainSegments.map((x, i) =>
                          i === k ? { ...x, to: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  />
                  <select
                    className="input !w-24 !p-1"
                    value={s.terrain}
                    aria-label="Terreno do trecho"
                    onChange={(e) =>
                      setEd({
                        ...ed,
                        terrainSegments: ed.terrainSegments.map((x, i) =>
                          i === k ? { ...x, terrain: e.target.value as Terrain } : x,
                        ),
                      })
                    }
                  >
                    {(['asphalt', 'dirt', 'sand'] as Terrain[]).map((t) => (
                      <option key={t} value={t}>
                        {TERRAIN_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <button
                    className="text-hot"
                    aria-label="Remover trecho"
                    onClick={() =>
                      setEd({ ...ed, terrainSegments: ed.terrainSegments.filter((_, i) => i !== k) })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn-ghost !py-1 text-xs"
                onClick={() =>
                  setEd({
                    ...ed,
                    terrainSegments: [...ed.terrainSegments, { from: 0.4, to: 0.55, terrain: 'dirt' }],
                  })
                }
              >
                + trecho
              </button>
            </div>
          </div>
          <div className="card space-y-2">
            <span className="label">Começar de uma seed procedural</span>
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="seed"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                aria-label="Seed"
              />
              <button className="btn-ghost" onClick={importSeed}>
                Importar
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
