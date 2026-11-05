import {
  BIOME_LABEL,
  TRACK_TERRAINS,
  type GameSettings,
  type RaceSummaryDto,
  type TrackTerrain,
} from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { RaceHistory } from '../../components/RaceHistory';
import { RaceMiniMap } from '../../components/RaceMiniMap';
import { Countdown, PhaseBadge, Spinner, toast } from '../../components/ui';
import { errorMessage, get, put } from '../../lib/api';
import { TERRAIN_LABEL } from '../../lib/format';
import { AdminPage } from './AdminNav';
import { Num, Section, Toggle } from './AdminSettings';

type TestSettings = GameSettings['testRaces'];
const ENDED = ['finished', 'archived', 'cancelled'];

/**
 * Corridas teste: o ciclo (uma por vez, a próxima começa depois da bandeirada), o rodízio de terrenos e o que está
 * acontecendo agora. As configurações são as mesmas do jogo (seção "testRaces").
 */
export default function AdminTestRaces() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => get<{ settings: GameSettings }>('/admin/settings'),
  });
  const races = useQuery({
    queryKey: ['admin-test-races'],
    queryFn: () =>
      get<RaceSummaryDto[]>(
        `/races?test=true&from=${Date.now() - 6 * 3_600_000}&to=${Date.now() + 6 * 3_600_000}&order=desc&limit=40`,
      ),
    refetchInterval: 10_000,
  });
  const [tr, setTr] = useState<TestSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings.data) setTr(settings.data.settings.testRaces);
  }, [settings.data]);
  if (!settings.data || !tr) return <Spinner />;
  const saved = settings.data.settings.testRaces;
  const dirty = JSON.stringify(tr) !== JSON.stringify(saved);
  const set = (p: Partial<TestSettings>) => setTr({ ...tr, ...p });
  const current = races.data?.find((r) => !ENDED.includes(r.status)) ?? null;
  const past = (races.data ?? []).filter((r) => ENDED.includes(r.status));
  const lastTerrain = current?.track.terrain ?? past[0]?.track.terrain ?? null;
  const order = tr.terrains;
  const nextTerrain = order[(order.indexOf(lastTerrain as TrackTerrain) + 1) % order.length];

  async function save() {
    setBusy(true);
    try {
      const all = settings.data!.settings;
      await put('/admin/settings', { ...all, phases: { ...all.phases, traceWindowSec: 0 }, testRaces: tr });
      await qc.invalidateQueries({ queryKey: ['admin-settings'] });
      toast('Corridas teste salvas', 'Vale a partir da próxima corrida teste.', 'ok');
    } catch (x) {
      toast('Não deu para salvar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }

  const toggleTerrain = (t: TrackTerrain) => {
    const next = order.includes(t) ? order.filter((x) => x !== t) : [...order, t];
    if (next.length) set({ terrains: next });
  };

  return (
    <AdminPage
      title="Corridas teste"
      actions={
        <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
          {dirty ? 'Salvar' : 'Salvo'}
        </button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Section
            title="Agora"
            hint="Só existe uma corrida teste por vez. A próxima nasce na bandeirada e começa depois do intervalo."
          >
            {current ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link to={`/corridas/${current.id}`} className="block w-40 shrink-0">
                  <RaceMiniMap race={current} className="aspect-[16/8] w-full" />
                </Link>
                <div className="min-w-0 flex-1 space-y-1">
                  <Link to={`/corridas/${current.id}`} className="font-display text-lg hover:text-race">
                    {current.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <PhaseBadge phase={current.status} />
                    <span>
                      {TERRAIN_LABEL[current.track.terrain]} · {BIOME_LABEL[current.track.biome]} ·{' '}
                      {current.laps} voltas · {current.capacity.confirmed} carros
                    </span>
                  </div>
                  {current.phaseDeadline && (
                    <div className="text-sm text-muted">
                      próxima fase em <Countdown to={current.phaseDeadline} className="text-ink" />
                    </div>
                  )}
                </div>
                <Link to={`/corridas/${current.id}/ao-vivo`} className="btn-ghost !py-1.5">
                  Assistir
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted">
                {saved.enabled
                  ? 'Nenhuma no momento: a próxima é criada no próximo ciclo do motor (até 1 minuto).'
                  : 'As corridas teste estão desligadas.'}
              </p>
            )}
            {saved.enabled && nextTerrain && (
              <p className="text-sm">
                Próxima no rodízio: <b className="text-race">{TERRAIN_LABEL[nextTerrain]}</b>
              </p>
            )}
          </Section>
          {past.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-display text-xl">Últimas (6 h)</h2>
              <RaceHistory races={past} preview={6} />
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <Section title="Configuração">
            <Toggle
              label="Corridas teste ligadas"
              checked={tr.enabled}
              onChange={(v) => set({ enabled: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Num
                label="Da bandeirada à próxima"
                value={tr.gapMin}
                min={1}
                max={240}
                suffix="min"
                onChange={(v) => set({ gapMin: v ?? 2 })}
              />
              <Num label="Voltas" value={tr.laps} min={3} max={60} onChange={(v) => set({ laps: v ?? 10 })} />
              <Num
                label="Bots no grid"
                value={tr.bots}
                min={0}
                max={21}
                onChange={(v) => set({ bots: v ?? 0 })}
              />
              <Num
                label="Apagar encerradas depois de"
                value={tr.keepHours}
                min={0.5}
                max={168}
                step={0.5}
                suffix="h"
                onChange={(v) => set({ keepHours: v ?? 3 })}
              />
            </div>
            <div>
              <span className="label">Rodízio de terrenos (na ordem marcada)</span>
              <div className="flex flex-wrap gap-1.5">
                {TRACK_TERRAINS.map((t) => {
                  const k = order.indexOf(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTerrain(t)}
                      className={clsx(
                        'rounded-xl border px-3 py-1.5 text-sm font-bold',
                        k >= 0 ? 'border-race bg-race/15 text-race' : 'border-line text-muted',
                      )}
                    >
                      {k >= 0 && <span className="mr-1">{k + 1}.</span>}
                      {TERRAIN_LABEL[t]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-muted">
                Cada corrida teste usa o próximo terreno da lista. O cenário segue os pesos de Configurações
                (sem combinar pista e fundo da mesma cor).
              </p>
            </div>
            <p className="text-xs text-muted">
              Fases (treino, parque fechado, classificação) e categoria vêm de{' '}
              <Link to="/admin/configuracoes" className="font-bold text-race underline">
                Configurações
              </Link>
              .
            </p>
          </Section>
        </aside>
      </div>
    </AdminPage>
  );
}
