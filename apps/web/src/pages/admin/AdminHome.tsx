import { PHASE_LABELS, type RacePhase, type RaceSummaryDto } from '@tracado/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PhaseBadge, Spinner } from '../../components/ui';
import { get } from '../../lib/api';
import { TERRAIN_LABEL } from '../../lib/format';
import { isAdmin, useSession } from '../../lib/session';
import { AdminPage } from './AdminNav';

interface Stats {
  players: { total: number; guests: number; bots: number; new7d: number; active7d: number };
  racesPerDay: { day: string; finished: number; cancelled: number; other: number }[];
  byTerrain: Partial<Record<string, number>>;
  crazyActiveGroups: number;
  upcoming: RaceSummaryDto[];
}

const TERRAIN_BAR: Record<string, string> = {
  asphalt: '#a6c9cb',
  dirt: '#b07a4a',
  sand: '#e6c27a',
  mixed: '#9b7bff',
};

/** Corridas por dia (encerradas e canceladas) nos últimos 14 dias, em barras simples. */
function RacesPerDay({ rows }: { rows: Stats['racesPerDay'] }) {
  const max = Math.max(1, ...rows.map((r) => r.finished + r.cancelled + r.other));
  if (!rows.length) return <p className="text-sm text-muted">Sem corridas no período.</p>;
  return (
    <div className="flex h-36 items-end gap-1" role="img" aria-label="Corridas por dia nos últimos 14 dias">
      {rows.map((r) => {
        const total = r.finished + r.cancelled + r.other;
        return (
          <div
            key={r.day}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${r.day}: ${r.finished} encerradas, ${r.cancelled} canceladas`}
          >
            <div
              className="flex w-full flex-col justify-end overflow-hidden rounded-t"
              style={{ height: `${(total / max) * 110}px` }}
            >
              <div className="bg-hot/70" style={{ flex: r.cancelled }} />
              <div className="bg-go" style={{ flex: r.finished + r.other }} />
            </div>
            <span className="text-[10px] text-muted">{r.day.slice(8)}</span>
          </div>
        );
      })}
    </div>
  );
}

interface Dash {
  serverTime: number;
  racesToday: Partial<Record<RacePhase, number>>;
  entriesLast24h: number;
  flaggedUsers: number;
  wsConnections: number;
  live: RaceSummaryDto[];
  engineErrors: { at: number; message: string; raceId?: string }[];
  store: string;
  db: string;
}

export default function AdminHome() {
  const me = useSession((s) => s.me);
  const admin = isAdmin(me);
  const { data } = useQuery({
    queryKey: ['admin-dash'],
    queryFn: () => get<Dash>('/admin/dashboard'),
    enabled: admin,
    refetchInterval: 5000,
  });
  const stats = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => get<Stats>('/admin/stats'),
    enabled: admin,
    refetchInterval: 30_000,
  });
  if (!admin)
    return (
      <AdminPage title="Painel do editor">
        <p className="text-muted">
          Como editor de pistas você pode criar e submeter pistas especiais para revisão.
        </p>
        <Link to="/admin/pistas" className="btn-primary mt-3">
          Ir para pistas
        </Link>
      </AdminPage>
    );
  if (!data) return <Spinner />;
  return (
    <AdminPage
      title="Painel da direção de prova"
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/corridas" className="btn-primary !py-1.5">
            + Criar corrida
          </Link>
          <Link to="/admin/configuracoes" className="btn-ghost !py-1.5">
            ⚙️ Configurações
          </Link>
          <Link to="/admin/gerador" className="btn-ghost !py-1.5">
            🗺️ Gerador de pistas
          </Link>
        </div>
      }
    >
      {stats.data && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
            {(
              [
                ['Jogadores com conta', stats.data.players.total],
                ['Novos em 7 dias', stats.data.players.new7d],
                ['Ativos em 7 dias', stats.data.players.active7d],
                ['Convidados', stats.data.players.guests],
                ['Grupos da Corrida Maluca', stats.data.crazyActiveGroups],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="card">
                <div className="text-xs text-muted">{k}</div>
                <div className="font-display text-2xl">{v}</div>
              </div>
            ))}
          </div>
          <section className="mb-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="card">
              <h2 className="font-display">Corridas por dia (14 dias)</h2>
              <p className="mb-2 text-xs text-muted">
                Verde: corridas que aconteceram · vermelho: canceladas.
              </p>
              <RacesPerDay rows={stats.data.racesPerDay} />
            </div>
            <div className="card">
              <h2 className="font-display">Terrenos (14 dias)</h2>
              {(() => {
                const entries = Object.entries(stats.data.byTerrain) as [string, number][];
                const total = entries.reduce((a, [, n]) => a + n, 0) || 1;
                return (
                  <ul className="mt-2 space-y-2 text-sm">
                    {!entries.length && <li className="text-muted">Sem corridas.</li>}
                    {entries.map(([t, n]) => (
                      <li key={t}>
                        <div className="flex justify-between">
                          <span>{TERRAIN_LABEL[t as 'asphalt'] ?? t}</span>
                          <b>{n}</b>
                        </div>
                        <div className="h-2 rounded-full bg-night">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${(n / total) * 100}%`,
                              background: TERRAIN_BAR[t] ?? '#ffcc00',
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                );
              })()}
              <Link to="/admin/configuracoes" className="mt-3 block text-xs font-bold text-race underline">
                Ajustar terrenos liberados
              </Link>
            </div>
          </section>
          <section className="card mb-4">
            <h2 className="font-display">Próximas corridas</h2>
            <ul className="mt-2 divide-y divide-line/60 text-sm">
              {!stats.data.upcoming.length && <li className="py-1 text-muted">Nenhuma agendada.</li>}
              {stats.data.upcoming.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-1.5">
                  <span className="w-24 shrink-0 font-mono text-xs text-muted">
                    {new Date(r.timeline.practiceAt).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <Link
                    to={`/corridas/${r.id}`}
                    className="min-w-0 flex-1 truncate font-semibold hover:text-race"
                  >
                    {r.crazy && '🤪 '}
                    {r.name}
                  </Link>
                  <span className="hidden text-xs text-muted sm:block">
                    {r.track.name} · {TERRAIN_LABEL[r.track.terrain]} · {r.laps} voltas · {r.category.name}
                  </span>
                  <span className="text-xs">
                    {r.capacity.confirmed}/{r.capacity.capacity}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ['Sockets conectados', data.wsConnections],
            ['Inscrições (24 h)', data.entriesLast24h],
            ['Contas sinalizadas', data.flaggedUsers],
            ['Infra', `${data.db} · ${data.store}`],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="card">
            <div className="text-xs text-muted">{k}</div>
            <div className="font-display text-2xl">{v}</div>
          </div>
        ))}
      </div>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="font-display">Corridas de hoje por fase</h2>
          <ul className="mt-2 grid grid-cols-2 gap-1 text-sm">
            {Object.entries(data.racesToday).map(([k, v]) => (
              <li key={k} className="flex justify-between rounded-lg bg-night px-2 py-1">
                <span>{PHASE_LABELS[k as RacePhase]}</span>
                <b>{v}</b>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2 className="font-display">Em andamento</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {!data.live.length && <li className="text-muted">Nenhuma.</li>}
            {data.live.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <Link className="truncate hover:text-race" to={`/corridas/${r.id}`}>
                  {r.name}
                </Link>
                <PhaseBadge phase={r.status} />
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="card mt-4">
        <h2 className="font-display">Erros recentes do motor de fases</h2>
        {!data.engineErrors.length ? (
          <p className="mt-2 text-sm text-go">Nenhum erro. 👌</p>
        ) : (
          <ul className="mt-2 space-y-1 font-mono text-xs text-hot">
            {data.engineErrors.map((e, i) => (
              <li key={i}>
                {new Date(e.at).toLocaleTimeString('pt-BR')} {e.raceId?.slice(0, 8)} {e.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminPage>
  );
}
