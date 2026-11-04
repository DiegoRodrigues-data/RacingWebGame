import { categoryConfigSchema, DEFAULT_SCORING, type CategoryDto } from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LevelBadge, toast } from '../../components/ui';
import { errorMessage, get, patch, post } from '../../lib/api';
import { AdminPage } from './AdminNav';

const TEMPLATE = {
  laps: 40,
  trackLength: { min: 2000, max: 3000 },
  trackComplexity: 0.5,
  terrains: ['asphalt'],
  weathers: ['dry', 'cloudy'],
  rainChance: 0.2,
  randomEvents: { safetyCar: true, oil: true, mechanical: false },
  setupLimits: {
    allowedTyres: ['soft', 'medium', 'hard', 'wet'],
    aero: { min: 1, max: 10 },
    allowedEngines: ['economy', 'balanced', 'power'],
    maxPitStops: 2,
  },
  scoring: DEFAULT_SCORING,
  entryRequirement: { minLevel: 'rookie', minRaces: 0 },
  playbackSpeed: 2,
};

function Editor({ cat, onDone }: { cat: CategoryDto | null; onDone: () => void }) {
  const [json, setJson] = useState(JSON.stringify(cat?.config ?? TEMPLATE, null, 2));
  const [meta, setMeta] = useState({
    slug: cat?.slug ?? '',
    name: cat?.name ?? '',
    level: cat?.level ?? 'rookie',
    description: cat?.description ?? '',
    active: cat?.active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    let cfg: unknown;
    try {
      cfg = JSON.parse(json);
    } catch {
      return setErr('JSON inválido.');
    }
    const v = categoryConfigSchema.safeParse(cfg);
    if (!v.success) return setErr(v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
    try {
      if (cat) await patch(`/admin/categories/${cat.id}`, { ...meta, config: v.data });
      else await post('/admin/categories', { ...meta, config: v.data });
      toast('Categoria salva', undefined, 'ok');
      onDone();
    } catch (x) {
      setErr(errorMessage(x));
    }
  }
  return (
    <div className="card space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <input
          className="input"
          placeholder="slug"
          value={meta.slug}
          disabled={!!cat}
          onChange={(e) => setMeta({ ...meta, slug: e.target.value })}
          aria-label="Slug"
        />
        <input
          className="input"
          placeholder="Nome"
          value={meta.name}
          onChange={(e) => setMeta({ ...meta, name: e.target.value })}
          aria-label="Nome"
        />
        <select
          className="input"
          value={meta.level}
          onChange={(e) => setMeta({ ...meta, level: e.target.value as typeof meta.level })}
          aria-label="Nível"
        >
          {['rookie', 'amateur', 'pro', 'elite'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={meta.active}
            onChange={(e) => setMeta({ ...meta, active: e.target.checked })}
            className="size-4 accent-[#ffcc00]"
          />{' '}
          Ativa
        </label>
      </div>
      <input
        className="input"
        placeholder="Descrição"
        value={meta.description}
        onChange={(e) => setMeta({ ...meta, description: e.target.value })}
        aria-label="Descrição"
      />
      <label className="block">
        <span className="label">
          Configuração (voltas, pista, clima, eventos, limites de setup, pontuação, requisitos, velocidade de
          transmissão)
        </span>
        <textarea
          className="input h-80 font-mono text-xs"
          value={json}
          onChange={(e) => setJson(e.target.value)}
          spellCheck={false}
        />
      </label>
      {err && <pre className="whitespace-pre-wrap rounded-xl bg-hot/10 p-2 text-xs text-hot">{err}</pre>}
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save}>
          Salvar
        </button>
        <button className="btn-ghost" onClick={onDone}>
          Fechar
        </button>
      </div>
    </div>
  );
}

export default function AdminCategories() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-cats'],
    queryFn: () => get<CategoryDto[]>('/admin/categories'),
  });
  const [editing, setEditing] = useState<CategoryDto | null | 'new'>(null);
  const done = () => {
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ['admin-cats'] });
    void qc.invalidateQueries({ queryKey: ['categories'] });
  };
  return (
    <AdminPage
      title="Categorias"
      actions={
        <button className="btn-primary" onClick={() => setEditing('new')}>
          Nova categoria
        </button>
      }
    >
      {editing && <Editor cat={editing === 'new' ? null : editing} onDone={done} />}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {data?.map((c) => (
          <li key={c.id} className="card">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-display text-lg">{c.name}</div>
                <div className="text-xs text-muted">
                  {c.slug} · {c.config.laps} voltas · pontos ×{c.config.scoring.multiplier} · transmissão{' '}
                  {c.config.playbackSpeed}x {c.active ? '' : '· inativa'}
                </div>
              </div>
              <LevelBadge level={c.level} />
            </div>
            <p className="mt-2 text-sm text-muted">{c.description}</p>
            <button className="btn-ghost mt-2 !py-1.5" onClick={() => setEditing(c)}>
              Editar
            </button>
          </li>
        ))}
      </ul>
    </AdminPage>
  );
}
