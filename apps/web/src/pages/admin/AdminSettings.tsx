import {
  BIOME_LABEL,
  BIOMES,
  DEFAULT_DRIVER_RULES,
  DRIVER_TRAITS,
  type DriverRules,
  type GameSettings,
  type TerrainWeights,
} from '@tracado/shared';
import type { BalanceReport } from '@tracado/sim';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BIOME_CSS } from '../../components/TrackCanvas';
import { Spinner, toast } from '../../components/ui';
import { errorMessage, get, post, put } from '../../lib/api';
import { fmtKm, TERRAIN_LABEL } from '../../lib/format';
import { AdminPage } from './AdminNav';

interface CategoryInfo {
  slug: string;
  name: string;
  active: boolean;
  laps: number;
  terrains: string[];
  trackLength: { min: number; max: number };
  trackComplexity: number;
}
interface PoolTrack {
  versionId: string;
  name: string;
  length: number;
  terrain: string;
  corners: number;
  status: string;
}
interface SettingsResponse {
  settings: GameSettings;
  defaults: GameSettings;
  categories: CategoryInfo[];
  pool: PoolTrack[];
}

const TERRAIN_KEYS: (keyof TerrainWeights)[] = ['asphalt', 'dirt', 'sand', 'mixed'];

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-display text-xl">{title}</h2>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function Num({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  nullable,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  nullable?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          className="input"
          min={min}
          max={max}
          step={step}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '' && nullable) return onChange(null);
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
        {suffix && <span className="shrink-0 text-xs text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[#ffcc00]"
      />
      {label}
    </label>
  );
}

const minutes = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`;
};

/** Configurações do jogo: fases, grade automática, corridas teste, bots, geração de pistas e Corrida Maluca. */
export default function AdminSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => get<SettingsResponse>('/admin/settings'),
  });
  const [s, setS] = useState<GameSettings | null>(null);
  const [pool, setPool] = useState<PoolTrack[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) {
      setS(data.settings);
      setPool(data.pool);
    }
  }, [data]);
  if (!data || !s) return <Spinner />;
  const dirty = JSON.stringify(s) !== JSON.stringify(data.settings);
  const set = <K extends keyof GameSettings>(k: K, v: Partial<GameSettings[K]>) =>
    setS({ ...s, [k]: { ...(s[k] as object), ...v } } as GameSettings);
  const terrainTotal = TERRAIN_KEYS.reduce((a, k) => a + s.tracks.terrains[k], 0);
  const biomeTotal = BIOMES.reduce((a, k) => a + s.tracks.biomes[k], 0);
  const p = s.phases;
  const prelude = p.practiceMin * 60_000 + (p.traceWindowSec + p.setupLockSec + p.qualifyingSec) * 1000;

  async function save() {
    setBusy(true);
    try {
      // Sem janela de traçado depois do treino (o traçado vale até o parque fechado).
      const body = { ...s!, phases: { ...s!.phases, traceWindowSec: 0 } };
      const r = await put<{ settings: GameSettings; pool: PoolTrack[] }>('/admin/settings', body);
      setS(r.settings);
      setPool(r.pool);
      qc.setQueryData<SettingsResponse>(['admin-settings'], (old) =>
        old ? { ...old, settings: r.settings, pool: r.pool } : old,
      );
      void qc.invalidateQueries({ queryKey: ['public-settings'] });
      toast('Configurações salvas', 'Valem para as corridas criadas daqui em diante.', 'ok');
    } catch (x) {
      toast('Não deu para salvar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }

  const toggleCategory = (slug: string) => {
    const cur = s.autoRaces.categories;
    const next = cur.includes(slug) ? cur.filter((c) => c !== slug) : [...cur, slug];
    if (next.length) set('autoRaces', { categories: next });
  };

  return (
    <AdminPage
      title="Configurações do jogo"
      actions={
        <div className="flex gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => setS(data.defaults)}>
            Voltar ao padrão
          </button>
          <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
            {dirty ? 'Salvar' : 'Salvo'}
          </button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Tudo aqui vale na hora, sem deploy, para as corridas criadas daqui em diante (as já agendadas mantêm
        horários e pista). Cada alteração fica na auditoria.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Tempo das etapas"
          hint={
            <>
              Vale para a grade automática, as corridas teste e a Corrida Maluca, e é o padrão das corridas
              criadas aqui no admin. Sem treino (padrão), traçado e setup ficam abertos desde a inscrição até
              o parque fechado. Do horário da corrida à largada:{' '}
              <b className="text-ink">{minutes(prelude)}</b>.
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Num
              label="Treino (0 = sem treino)"
              value={p.practiceMin}
              min={0}
              max={120}
              step={0.5}
              suffix="min"
              onChange={(v) => set('phases', { practiceMin: v ?? 0 })}
            />
            <Num
              label="Parque fechado"
              value={p.setupLockSec}
              min={5}
              max={600}
              step={5}
              suffix="s"
              onChange={(v) => set('phases', { setupLockSec: v ?? 30 })}
            />
            <Num
              label="Classificação ao vivo"
              value={p.qualifyingSec}
              min={20}
              max={1800}
              step={5}
              suffix="s"
              onChange={(v) => set('phases', { qualifyingSec: v ?? 60 })}
            />
          </div>
        </Section>

        <DriverRulesSection value={s.drivers} onChange={(v) => set('drivers', v)} />

        <Section title="Grade automática" hint="Corridas abertas criadas sozinhas em horários fixos.">
          <Toggle
            label="Ligada"
            checked={s.autoRaces.enabled}
            onChange={(v) => set('autoRaces', { enabled: v })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Num
              label="Corridas por dia"
              value={s.autoRaces.perDay}
              min={1}
              max={96}
              suffix={`a cada ${minutes(86_400_000 / Math.max(1, s.autoRaces.perDay))}`}
              onChange={(v) => set('autoRaces', { perDay: v ?? 24 })}
            />
            <Num
              label="Criar com antecedência de"
              value={s.autoRaces.lookaheadHours}
              min={1}
              max={168}
              suffix="h"
              onChange={(v) => set('autoRaces', { lookaheadHours: v ?? 24 })}
            />
            <Num
              label="Voltas"
              value={s.autoRaces.laps}
              min={3}
              max={60}
              nullable
              placeholder="da categoria"
              onChange={(v) => set('autoRaces', { laps: v })}
            />
            <Num
              label={
                s.botPool.enabled ? 'Bots fixos (desligado: há pilotos simulados)' : 'Bots completando o grid'
              }
              value={s.autoRaces.bots}
              min={0}
              max={21}
              onChange={(v) => set('autoRaces', { bots: v ?? 0 })}
            />
          </div>
          <Toggle
            label="Valem para o ranking"
            checked={s.autoRaces.ranked}
            onChange={(v) => set('autoRaces', { ranked: v })}
          />
          <div>
            <span className="label">Categorias em rodízio (na ordem marcada)</span>
            <div className="flex flex-wrap gap-1.5">
              {data.categories.map((c) => {
                const k = s.autoRaces.categories.indexOf(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => toggleCategory(c.slug)}
                    className={clsx(
                      'rounded-xl border px-3 py-1.5 text-sm font-bold',
                      k >= 0 ? 'border-race bg-race/15 text-race' : 'border-line text-muted',
                      !c.active && 'opacity-50',
                    )}
                    title={`${c.laps} voltas · ${c.terrains.map((t) => TERRAIN_LABEL[t as 'asphalt']).join(', ')}`}
                  >
                    {k >= 0 && <span className="mr-1">{k + 1}.</span>}
                    {c.name}
                    {!c.active && ' (inativa)'}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-muted">
              A categoria dá clima, limites de setup, pontuação e velocidade da transmissão. O terreno vem da
              seção "Pistas".
            </p>
          </div>
        </Section>

        <Section title="Pistas das corridas automáticas" hint="Grade, corridas teste e Corrida Maluca.">
          <div>
            <span className="label">Terrenos liberados (peso no sorteio)</span>
            <div className="space-y-2">
              {TERRAIN_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-3 text-sm">
                  <span className="w-20 font-semibold">{TERRAIN_LABEL[k]}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={s.tracks.terrains[k]}
                    onChange={(e) =>
                      set('tracks', { terrains: { ...s.tracks.terrains, [k]: Number(e.target.value) } })
                    }
                    className="flex-1 accent-[#ffcc00]"
                  />
                  <span className="w-12 text-right font-mono text-xs">
                    {terrainTotal ? Math.round((s.tracks.terrains[k] / terrainTotal) * 100) : 0}%
                  </span>
                </label>
              ))}
            </div>
            {!terrainTotal && <p className="text-xs text-hot">Libere pelo menos um terreno.</p>}
          </div>
          <div>
            <span className="label">Cenários (peso no sorteio)</span>
            <div className="space-y-2">
              {BIOMES.map((k) => (
                <label key={k} className="flex items-center gap-3 text-sm">
                  <span className="flex w-24 items-center gap-1.5 font-semibold">
                    <span className="inline-block size-3 rounded" style={{ background: BIOME_CSS[k] }} />
                    {BIOME_LABEL[k]}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={s.tracks.biomes[k]}
                    onChange={(e) =>
                      set('tracks', { biomes: { ...s.tracks.biomes, [k]: Number(e.target.value) } })
                    }
                    className="flex-1 accent-[#ffcc00]"
                  />
                  <span className="w-12 text-right font-mono text-xs">
                    {biomeTotal ? Math.round((s.tracks.biomes[k] / biomeTotal) * 100) : 0}%
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">
              Só visual. Pista de areia não vai para o deserto e pista de terra não vai para o cânion
              (sumiriam no fundo).
            </p>
            {!biomeTotal && <p className="text-xs text-hot">Libere pelo menos um cenário.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Num
              label="Comprimento mínimo"
              value={s.tracks.lengthMin}
              min={800}
              max={6000}
              step={50}
              suffix="m"
              nullable
              placeholder="da categoria"
              onChange={(v) => set('tracks', { lengthMin: v })}
            />
            <Num
              label="Comprimento máximo"
              value={s.tracks.lengthMax}
              min={800}
              max={6000}
              step={50}
              suffix="m"
              nullable
              placeholder="da categoria"
              onChange={(v) => set('tracks', { lengthMax: v })}
            />
            <Num
              label="Complexidade (0 a 1)"
              value={s.tracks.complexity}
              min={0}
              max={1}
              step={0.05}
              nullable
              placeholder="da categoria"
              onChange={(v) => set('tracks', { complexity: v })}
            />
            <Num
              label="Largura"
              value={s.tracks.width}
              min={8}
              max={20}
              suffix="m"
              onChange={(v) => set('tracks', { width: v ?? 12 })}
            />
          </div>
          <label className="block">
            <span className="label">Prefixo da seed (opcional)</span>
            <input
              className="input"
              value={s.tracks.seedPrefix}
              placeholder="aleatória"
              maxLength={24}
              onChange={(e) => set('tracks', { seedPrefix: e.target.value.replace(/[^a-z0-9-]/gi, '') })}
            />
            <span className="mt-1 block text-xs text-muted">
              Ex.: "verao" gera seeds "verao-1a2b3c4d", fáceis de achar depois. Para escolher uma pista exata,
              use o{' '}
              <Link to="/admin/gerador" className="font-bold text-race underline">
                gerador de pistas
              </Link>
              .
            </span>
          </label>
          <div>
            <span className="label">Pistas salvas no rodízio ({pool.length})</span>
            {!pool.length ? (
              <p className="text-sm text-muted">
                Nenhuma. Salve pistas boas pelo{' '}
                <Link to="/admin/gerador" className="font-bold text-race underline">
                  gerador
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-line/60 rounded-xl border border-line">
                {pool
                  .filter((t) => s.tracks.pool.includes(t.versionId))
                  .map((t) => (
                    <li key={t.versionId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="flex-1 truncate font-semibold">{t.name}</span>
                      <span className="text-xs text-muted">
                        {fmtKm(t.length)} · {TERRAIN_LABEL[t.terrain as 'asphalt']} · {t.corners} curvas
                      </span>
                      <button
                        className="text-xs font-bold text-hot hover:underline"
                        onClick={() =>
                          set('tracks', { pool: s.tracks.pool.filter((id) => id !== t.versionId) })
                        }
                      >
                        tirar
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            <label className="mt-2 flex items-center gap-3 text-sm">
              <span className="w-40">Chance de usar uma salva</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={s.tracks.poolChance}
                disabled={!s.tracks.pool.length}
                onChange={(e) => set('tracks', { poolChance: Number(e.target.value) })}
                className="flex-1 accent-[#ffcc00]"
              />
              <span className="w-12 text-right font-mono text-xs">
                {Math.round(s.tracks.poolChance * 100)}%
              </span>
            </label>
          </div>
        </Section>

        <div className="space-y-4">
          <Section title="Corridas teste" hint="Uma por vez, com bots, passando pelos terrenos.">
            <Link to="/admin/corridas-teste" className="btn-ghost">
              Abrir a página das corridas teste
            </Link>
          </Section>
          <Section title="Corridas criadas no admin">
            <Num
              label="Bots completando o grid"
              value={s.adminRaceBots}
              min={0}
              max={21}
              onChange={(v) => setS({ ...s, adminRaceBots: v ?? 0 })}
            />
          </Section>
          <Section title="Corrida Maluca" hint="Limites dos grupos de amigos e padrões do formulário.">
            <div className="grid grid-cols-2 gap-3">
              <Num
                label="Máximo de corridas por grupo"
                value={s.crazy.maxRaces}
                min={1}
                max={20}
                onChange={(v) => set('crazy', { maxRaces: v ?? 10 })}
              />
              <Num
                label="Máximo de pilotos"
                value={s.crazy.maxMembers}
                min={2}
                max={22}
                onChange={(v) => set('crazy', { maxMembers: v ?? 20 })}
              />
              <Num
                label="Voltas (padrão)"
                value={s.crazy.lapsDefault}
                min={3}
                max={30}
                onChange={(v) => set('crazy', { lapsDefault: v ?? 8 })}
              />
              <Num
                label="Completar com bots até (padrão)"
                value={s.crazy.botFillDefault}
                min={0}
                max={22}
                suffix="0 = sem bots"
                onChange={(v) => set('crazy', { botFillDefault: v ?? 0 })}
              />
            </div>
            <Toggle
              label="Modo caos ligado por padrão"
              checked={s.crazy.chaosDefault}
              onChange={(v) => set('crazy', { chaosDefault: v })}
            />
          </Section>
        </div>
      </div>
      {dirty && (
        <div className="sticky bottom-3 mt-4 flex justify-end">
          <button className="btn-primary shadow-xl" disabled={busy} onClick={save}>
            Salvar alterações
          </button>
        </div>
      )}
    </AdminPage>
  );
}

type BalanceResult = Pick<BalanceReport, 'races' | 'perRace' | 'avgPosition' | 'profileSpread'> & {
  ms: number;
};

const TRAIT_LABEL: Record<string, string> = Object.fromEntries(DRIVER_TRAITS.map((t) => [t.key, t.label]));
const EFFECTS = [
  ['attackEffect', 'Peso do ataque'],
  ['defenseEffect', 'Peso da defesa'],
  ['paceEffect', 'Peso do ritmo'],
] as const;

/**
 * Perfil do piloto e colisões: liga os toques, regula a frequência e o dano e o peso de cada característica do
 * perfil. O teste simula algumas corridas com as regras do formulário (ainda sem salvar) para ver o efeito.
 */
function DriverRulesSection({
  value,
  onChange,
}: {
  value: DriverRules;
  onChange: (v: Partial<DriverRules>) => void;
}) {
  const [test, setTest] = useState<BalanceResult | null>(null);
  const [running, setRunning] = useState(false);
  async function runTest() {
    setRunning(true);
    try {
      setTest(await post<BalanceResult>('/admin/settings/drivers/test', { rules: value, races: 2 }));
    } catch (x) {
      toast('Não deu para testar', errorMessage(x), 'error');
    } finally {
      setRunning(false);
    }
  }
  // Limite mais folgado que o do `pnpm balance` (1,5): com 2 corridas por cenário o resultado oscila mais.
  const spread = test?.profileSpread ?? 0;
  return (
    <Section
      title="Pilotos e colisões"
      hint="Como o perfil do piloto (ataque, defesa, ritmo) pesa na corrida e quanto os carros se tocam nas disputas. Vale para as corridas simuladas daqui em diante; cada corrida guarda as regras com que rodou."
    >
      <Toggle
        label="Colisões nas disputas de posição"
        checked={value.collisions}
        onChange={(v) => onChange({ collisions: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Num
          label="Frequência dos toques"
          value={value.collisionRate}
          min={0}
          max={3}
          step={0.1}
          suffix="×"
          onChange={(v) => onChange({ collisionRate: v ?? DEFAULT_DRIVER_RULES.collisionRate })}
        />
        <Num
          label="Chance de avaria no toque"
          value={Math.round(value.damageRate * 100)}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(v) => onChange({ damageRate: v == null ? DEFAULT_DRIVER_RULES.damageRate : v / 100 })}
        />
        {EFFECTS.map(([k, label]) => (
          <Num
            key={k}
            label={label}
            value={value[k]}
            min={0}
            max={2}
            step={0.1}
            suffix="×"
            onChange={(v) => onChange({ [k]: v ?? DEFAULT_DRIVER_RULES[k] })}
          />
        ))}
      </div>
      <p className="text-xs text-muted">
        1× é o padrão balanceado; 0× desliga o efeito. Uma avaria leva o carro aos boxes no fim da volta
        (cerca de um terço das vezes, abandono).
      </p>
      <div className="space-y-2 rounded-2xl border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold">Teste de equilíbrio</span>
          <button className="btn-ghost !py-1.5 text-sm" disabled={running} onClick={runTest}>
            {running ? 'Simulando…' : 'Simular com estas regras'}
          </button>
        </div>
        {test ? (
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted">
              {test.races} corridas de 22 carros, setups e perfis sorteados ({(test.ms / 1000).toFixed(1)} s).
              Por corrida:
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Ultrapassagens', test.perRace.overtakes],
                ['Toques', test.perRace.collisions],
                ['Avarias (boxes)', test.perRace.damagePits],
                ['Abandonos por toque', test.perRace.collisionDnfs],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-night-2 p-2">
                  <div className="text-[11px] text-muted">{k}</div>
                  <div className="font-display text-lg">{Number(v).toFixed(1)}</div>
                </div>
              ))}
            </div>
            <table className="w-full text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1">Posição média (11,5 = neutro)</th>
                  <th className="text-right">baixo</th>
                  <th className="text-right">médio</th>
                  <th className="text-right">alto</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(test.avgPosition).map(([k, b]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1">{TRAIT_LABEL[k] ?? k}</td>
                    {['low', 'mid', 'high'].map((x) => (
                      <td key={x} className="text-right font-mono">
                        {b[x]?.toFixed(1) ?? '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={clsx('text-xs', spread > 2 ? 'text-hot' : 'text-go')}>
              {spread > 2
                ? `Atenção: uma faixa do perfil chega ${spread.toFixed(1)} posições à frente da outra. Pode estar desequilibrado.`
                : `Equilibrado: no máximo ${spread.toFixed(1)} posição de diferença entre as faixas do perfil.`}{' '}
              Com poucas corridas o resultado varia; rode de novo para confirmar.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted">
            Simula 14 corridas no servidor com as regras acima, sem salvar, e mostra toques, abandonos e se
            algum perfil ficou forte demais.
          </p>
        )}
      </div>
    </Section>
  );
}
