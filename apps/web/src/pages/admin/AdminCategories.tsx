import {
  categoryConfigSchema,
  DEFAULT_SCORING,
  ENGINE_MAPS,
  LEVEL_LABELS,
  LEVELS,
  TRACK_TERRAINS,
  TYRE_LABELS,
  TYRES,
  WEATHERS,
  type CategoryConfig,
  type CategoryDto,
} from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import { TERRAIN_LABEL, WEATHER_LABEL } from '../../lib/format';
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

const ENGINE_LABEL: Record<string, string> = {
  economy: 'Econômico',
  balanced: 'Equilibrado',
  power: 'Potência',
};

/** Escolha múltipla em chips (mantém pelo menos um marcado). */
function Chips<T extends string>({
  all,
  value,
  label,
  onChange,
}: {
  all: readonly T[];
  value: T[];
  label: (v: T) => ReactNode;
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((v) => {
        const on = value.includes(v);
        return (
          <button
            key={v}
            type="button"
            onClick={() => {
              const next = on ? value.filter((x) => x !== v) : [...value, v];
              if (next.length) onChange(next);
            }}
            className={clsx(
              'rounded-xl border px-3 py-1.5 text-sm font-bold',
              on ? 'border-race bg-race/15 text-race' : 'border-line text-muted',
            )}
          >
            {label(v)}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/** Formulário da configuração da categoria (o JSON fica como modo avançado). */
function ConfigForm({ cfg, set }: { cfg: CategoryConfig; set: (c: CategoryConfig) => void }) {
  const num = (v: string) => Number(v);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Voltas">
            <input
              className="input"
              type="number"
              min={30}
              max={60}
              value={cfg.laps}
              onChange={(e) => set({ ...cfg, laps: num(e.target.value) })}
            />
          </Field>
          <Field label="Pista mín. (m)">
            <input
              className="input"
              type="number"
              min={800}
              max={8000}
              step={50}
              value={cfg.trackLength.min}
              onChange={(e) => set({ ...cfg, trackLength: { ...cfg.trackLength, min: num(e.target.value) } })}
            />
          </Field>
          <Field label="Pista máx. (m)">
            <input
              className="input"
              type="number"
              min={800}
              max={8000}
              step={50}
              value={cfg.trackLength.max}
              onChange={(e) => set({ ...cfg, trackLength: { ...cfg.trackLength, max: num(e.target.value) } })}
            />
          </Field>
        </div>
        <Field label={`Complexidade da pista: ${cfg.trackComplexity.toFixed(2)}`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cfg.trackComplexity}
            onChange={(e) => set({ ...cfg, trackComplexity: num(e.target.value) })}
            className="w-full accent-[#ffcc00]"
          />
        </Field>
        <div>
          <span className="label">Terrenos</span>
          <Chips
            all={TRACK_TERRAINS}
            value={cfg.terrains}
            label={(t) => TERRAIN_LABEL[t]}
            onChange={(terrains) => set({ ...cfg, terrains })}
          />
        </div>
        <div>
          <span className="label">Climas possíveis</span>
          <Chips
            all={WEATHERS}
            value={cfg.weathers}
            label={(w) => WEATHER_LABEL[w]}
            onChange={(weathers) => set({ ...cfg, weathers })}
          />
        </div>
        <Field label={`Chance de chuva durante a corrida: ${Math.round(cfg.rainChance * 100)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cfg.rainChance}
            onChange={(e) => set({ ...cfg, rainChance: num(e.target.value) })}
            className="w-full accent-[#ffcc00]"
          />
        </Field>
        <div>
          <span className="label">Eventos aleatórios</span>
          <div className="flex flex-wrap gap-4 text-sm">
            {(
              [
                ['safetyCar', 'Safety car'],
                ['oil', 'Óleo na pista'],
                ['mechanical', 'Quebras mecânicas'],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[#ffcc00]"
                  checked={cfg.randomEvents[k]}
                  onChange={(e) =>
                    set({ ...cfg, randomEvents: { ...cfg.randomEvents, [k]: e.target.checked } })
                  }
                />
                {l}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <span className="label">Pneus liberados</span>
          <Chips
            all={TYRES}
            value={cfg.setupLimits.allowedTyres}
            label={(t) => TYRE_LABELS[t]}
            onChange={(allowedTyres) => set({ ...cfg, setupLimits: { ...cfg.setupLimits, allowedTyres } })}
          />
        </div>
        <div>
          <span className="label">Mapas de motor liberados</span>
          <Chips
            all={ENGINE_MAPS}
            value={cfg.setupLimits.allowedEngines}
            label={(e) => ENGINE_LABEL[e] ?? e}
            onChange={(allowedEngines) =>
              set({ ...cfg, setupLimits: { ...cfg.setupLimits, allowedEngines } })
            }
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Aerofólio mín.">
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={cfg.setupLimits.aero.min}
              onChange={(e) =>
                set({
                  ...cfg,
                  setupLimits: {
                    ...cfg.setupLimits,
                    aero: { ...cfg.setupLimits.aero, min: num(e.target.value) },
                  },
                })
              }
            />
          </Field>
          <Field label="Aerofólio máx.">
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={cfg.setupLimits.aero.max}
              onChange={(e) =>
                set({
                  ...cfg,
                  setupLimits: {
                    ...cfg.setupLimits,
                    aero: { ...cfg.setupLimits.aero, max: num(e.target.value) },
                  },
                })
              }
            />
          </Field>
          <Field label="Paradas máx.">
            <input
              className="input"
              type="number"
              min={1}
              max={3}
              value={cfg.setupLimits.maxPitStops}
              onChange={(e) =>
                set({ ...cfg, setupLimits: { ...cfg.setupLimits, maxPitStops: num(e.target.value) } })
              }
            />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Velocidade da transmissão">
            <input
              className="input"
              type="number"
              min={0.5}
              max={8}
              step={0.5}
              value={cfg.playbackSpeed}
              onChange={(e) => set({ ...cfg, playbackSpeed: num(e.target.value) })}
            />
          </Field>
          <Field label="Pontos ×">
            <input
              className="input"
              type="number"
              min={0}
              max={5}
              step={0.1}
              value={cfg.scoring.multiplier}
              onChange={(e) => set({ ...cfg, scoring: { ...cfg.scoring, multiplier: num(e.target.value) } })}
            />
          </Field>
          <Field label="Bônus volta + rápida">
            <input
              className="input"
              type="number"
              min={0}
              max={10}
              value={cfg.scoring.fastestLapBonus}
              onChange={(e) =>
                set({ ...cfg, scoring: { ...cfg.scoring, fastestLapBonus: num(e.target.value) } })
              }
            />
          </Field>
        </div>
        <Field label="Pontos por posição (separados por vírgula)">
          <input
            className="input font-mono text-xs"
            defaultValue={cfg.scoring.points.join(', ')}
            onBlur={(e) => {
              const points = e.target.value
                .split(',')
                .map((x) => Math.max(0, Math.round(Number(x.trim()))))
                .filter((x) => Number.isFinite(x));
              if (points.length) set({ ...cfg, scoring: { ...cfg.scoring, points } });
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nível mínimo para entrar">
            <select
              className="input"
              value={cfg.entryRequirement.minLevel}
              onChange={(e) =>
                set({
                  ...cfg,
                  entryRequirement: {
                    ...cfg.entryRequirement,
                    minLevel: e.target.value as CategoryConfig['entryRequirement']['minLevel'],
                  },
                })
              }
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Corridas disputadas mín.">
            <input
              className="input"
              type="number"
              min={0}
              value={cfg.entryRequirement.minRaces}
              onChange={(e) =>
                set({ ...cfg, entryRequirement: { ...cfg.entryRequirement, minRaces: num(e.target.value) } })
              }
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Editor({ cat, onDone }: { cat: CategoryDto | null; onDone: () => void }) {
  const [cfg, setCfg] = useState<CategoryConfig>((cat?.config ?? TEMPLATE) as CategoryConfig);
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState('');
  const [meta, setMeta] = useState({
    slug: cat?.slug ?? '',
    name: cat?.name ?? '',
    level: cat?.level ?? 'rookie',
    description: cat?.description ?? '',
    active: cat?.active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    let raw: unknown = cfg;
    if (advanced)
      try {
        raw = JSON.parse(json);
      } catch {
        return setErr('JSON inválido.');
      }
    const v = categoryConfigSchema.safeParse(raw);
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
      {advanced ? (
        <textarea
          className="input h-80 font-mono text-xs"
          value={json}
          onChange={(e) => setJson(e.target.value)}
          spellCheck={false}
          aria-label="Configuração em JSON"
        />
      ) : (
        <ConfigForm cfg={cfg} set={setCfg} />
      )}
      <button
        type="button"
        className="text-xs font-bold text-muted underline"
        onClick={() => {
          if (advanced) {
            try {
              setCfg(JSON.parse(json) as CategoryConfig);
            } catch {
              return setErr('JSON inválido.');
            }
          } else setJson(JSON.stringify(cfg, null, 2));
          setErr(null);
          setAdvanced(!advanced);
        }}
      >
        {advanced ? 'Voltar ao formulário' : 'Editar como JSON (avançado)'}
      </button>
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
