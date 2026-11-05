import {
  DEFAULT_SETUP,
  formatLapTime,
  BIOME_LABEL,
  BIOMES,
  biomeFits,
  pickBiome,
  pickTerrain,
  type Biome,
  TRACK_TERRAINS,
  type GameSettings,
  type TrackParams,
  type TrackTerrain,
} from '@tracado/shared';
import { estimateLap } from '@tracado/sim';
import {
  generateProceduralTrack,
  offsetsToTrace,
  suggestedLine,
  validateGeometry,
  type TrackGeometry,
} from '@tracado/trackgen';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BIOME_MINI_BG, Minimap } from '../../components/Minimap';
import { BIOME_CSS, TrackCanvas } from '../../components/TrackCanvas';
import { Spinner, toast } from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { fmtKm, TERRAIN_LABEL } from '../../lib/format';
import { AdminPage } from './AdminNav';

const randomSeed = () => Math.random().toString(36).slice(2, 10);

interface Built {
  seed: string;
  params: TrackParams;
  biome?: Biome;
  g: TrackGeometry | null;
  issues: string[];
}

function build(seed: string, params: TrackParams): Built {
  try {
    const g = generateProceduralTrack(seed, params);
    const issues = validateGeometry(g, { targetLength: params.length }).map((i) => i.message);
    return { seed, params, g, issues };
  } catch (e) {
    return { seed, params, g: null, issues: [e instanceof Error ? e.message : 'Falha ao gerar.'] };
  }
}

/**
 * Gerador de pistas: testa seeds e parâmetros no próprio navegador (o gerador é determinístico, igual ao do
 * servidor), mostra sugestões com as configurações atuais e salva a pista escolhida como oficial (e no rodízio).
 */
export default function AdminTrackGen() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => get<{ settings: GameSettings }>('/admin/settings'),
  });
  const tr = settings.data?.settings.tracks;
  const [seed, setSeed] = useState(randomSeed);
  const [params, setParams] = useState<TrackParams>({
    length: 1600,
    complexity: 0.4,
    width: 12,
    terrain: 'asphalt',
  });
  const [batch, setBatch] = useState(0);
  const [name, setName] = useState('');
  const [toPool, setToPool] = useState(true);
  const [biome, setBiome] = useState<Biome>('grass');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!tr) return;
    setParams((p) => ({
      ...p,
      length: tr.lengthMin ?? p.length,
      complexity: tr.complexity ?? p.complexity,
      width: tr.width,
    }));
  }, [tr]);

  const current = useMemo(() => build(seed, params), [seed, params]);
  const estimate = useMemo(() => {
    if (!current.g || current.issues.length) return null;
    try {
      return estimateLap(
        current.g,
        DEFAULT_SETUP,
        offsetsToTrace(suggestedLine(current.g), 256),
        'dry',
        25,
        5,
      );
    } catch {
      return null;
    }
  }, [current]);
  // Sugestões: como a grade automática sortearia (terreno pelos pesos, comprimento na faixa configurada).
  const suggestions = useMemo(() => {
    if (!tr) return [];
    const out: Built[] = [];
    for (let i = 0; i < 8; i++) {
      const sd = `${tr.seedPrefix ? `${tr.seedPrefix}-` : ''}${randomSeed()}`;
      const min = tr.lengthMin ?? 1400;
      const max = Math.max(min, tr.lengthMax ?? 2400);
      const terrain = pickTerrain(tr.terrains, Math.random());
      out.push({
        ...build(sd, {
          length: Math.round((min + Math.random() * (max - min)) / 50) * 50,
          complexity: tr.complexity ?? 0.4,
          width: tr.width,
          terrain,
        }),
        biome: pickBiome(tr.biomes, terrain, Math.random()),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tr, batch]);

  if (!settings.data) return <Spinner />;

  async function save() {
    setBusy(true);
    try {
      await post('/admin/tracks/from-seed', { name: name || null, seed, params, addToPool: toPool });
      await qc.invalidateQueries({ queryKey: ['admin-settings'] });
      toast(
        'Pista salva',
        toPool ? 'Já está no rodízio das corridas automáticas.' : 'Ela aparece em Pistas.',
        'ok',
      );
      setName('');
    } catch (x) {
      toast('Não deu para salvar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage title="Gerador de pistas">
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="card space-y-3">
          {current.g ? (
            <TrackCanvas
              geometry={current.g}
              biome={biome}
              className="aspect-[16/10] w-full border border-line"
              label="Prévia da pista"
            />
          ) : (
            <div className="grid aspect-[16/10] place-items-center rounded-xl border border-line text-sm text-hot">
              Esta combinação não gera pista.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label !mb-0 mr-1">Ver no cenário</span>
            {BIOMES.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBiome(b)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-xl border px-3 py-1 text-sm font-bold',
                  biome === b ? 'border-race bg-race/15 text-race' : 'border-line text-muted',
                )}
              >
                <span className="inline-block size-3 rounded" style={{ background: BIOME_CSS[b] }} />
                {BIOME_LABEL[b]}
                {!biomeFits(b, params.terrain) && <span className="text-[10px] text-hot">(some)</span>}
              </button>
            ))}
          </div>
          {current.g && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="chip">{fmtKm(current.g.length)}</span>
              <span className="chip">{current.g.corners} curvas</span>
              <span className="chip">{TERRAIN_LABEL[current.g.baseTerrain]}</span>
              <span className="chip">raio mínimo {Math.round(current.g.minRadius)} m</span>
              {estimate && <span className="chip">volta estimada {formatLapTime(estimate.lapTimeMs)}</span>}
              {estimate && <span className="chip">{Math.round(estimate.topSpeedKmh)} km/h de máxima</span>}
            </div>
          )}
          {current.issues.length > 0 && (
            <ul className="space-y-0.5 text-sm text-hot">
              {current.issues.map((m) => (
                <li key={m}>⚠️ {m}</li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          <section className="card space-y-3">
            <label className="block">
              <span className="label">Seed</span>
              <span className="flex gap-2">
                <input
                  className="input font-mono"
                  value={seed}
                  maxLength={64}
                  onChange={(e) => setSeed(e.target.value.trim() || 'x')}
                />
                <button
                  className="btn-ghost !px-3"
                  title="Sortear outra"
                  onClick={() => setSeed(randomSeed())}
                >
                  🎲
                </button>
              </span>
            </label>
            <label className="block">
              <span className="label">Comprimento: {fmtKm(params.length)}</span>
              <input
                type="range"
                min={800}
                max={6000}
                step={50}
                value={params.length}
                onChange={(e) => setParams({ ...params, length: Number(e.target.value) })}
                className="w-full accent-[#ffcc00]"
              />
            </label>
            <label className="block">
              <span className="label">Complexidade: {params.complexity.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={params.complexity}
                onChange={(e) => setParams({ ...params, complexity: Number(e.target.value) })}
                className="w-full accent-[#ffcc00]"
              />
            </label>
            <label className="block">
              <span className="label">Largura: {params.width} m</span>
              <input
                type="range"
                min={8}
                max={20}
                value={params.width}
                onChange={(e) => setParams({ ...params, width: Number(e.target.value) })}
                className="w-full accent-[#ffcc00]"
              />
            </label>
            <div>
              <span className="label">Terreno</span>
              <div className="flex flex-wrap gap-1.5">
                {TRACK_TERRAINS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setParams({ ...params, terrain: t as TrackTerrain })}
                    className={clsx(
                      'rounded-xl border px-3 py-1.5 text-sm font-bold',
                      params.terrain === t ? 'border-race bg-race/15 text-race' : 'border-line text-muted',
                    )}
                  >
                    {TERRAIN_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
          </section>
          <section className="card space-y-3">
            <h2 className="font-display text-lg">Salvar como pista oficial</h2>
            <input
              className="input"
              placeholder="Nome (vazio = nome gerado)"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={toPool}
                onChange={(e) => setToPool(e.target.checked)}
                className="size-4 accent-[#ffcc00]"
              />
              Pôr no rodízio das corridas automáticas
            </label>
            <button
              className="btn-primary w-full"
              disabled={busy || !current.g || current.issues.length > 0}
              onClick={save}
            >
              Salvar pista
            </button>
            <p className="text-xs text-muted">
              A chance de usar as pistas do rodízio fica em{' '}
              <Link to="/admin/configuracoes" className="font-bold text-race underline">
                Configurações
              </Link>
              .
            </p>
          </section>
        </aside>
      </div>

      <section className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-xl">Como a grade sortearia agora</h2>
            <p className="text-sm text-muted">
              Com as configurações atuais de terreno, comprimento e complexidade. Clique para abrir no
              gerador.
            </p>
          </div>
          <button className="btn-ghost" onClick={() => setBatch((b) => b + 1)}>
            🎲 Outras
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {suggestions.map((b) => (
            <button
              key={b.seed}
              type="button"
              onClick={() => {
                setSeed(b.seed);
                setParams(b.params);
                if (b.biome) setBiome(b.biome);
              }}
              className="card !p-2 text-left transition hover:border-race"
            >
              <div
                className="relative aspect-[16/10] overflow-hidden rounded-lg"
                style={{ background: BIOME_MINI_BG[b.biome ?? 'grass'] }}
              >
                {b.g && (
                  <div className="absolute inset-1.5">
                    <Minimap g={b.g} cars={[]} />
                  </div>
                )}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-muted">{b.seed}</div>
              <div className="text-xs">
                {TERRAIN_LABEL[b.params.terrain]} · {BIOME_LABEL[b.biome ?? 'grass']} ·{' '}
                {fmtKm(b.g?.length ?? b.params.length)}
                {b.issues.length > 0 && <span className="text-hot"> · com problemas</span>}
              </div>
            </button>
          ))}
        </div>
      </section>
    </AdminPage>
  );
}
