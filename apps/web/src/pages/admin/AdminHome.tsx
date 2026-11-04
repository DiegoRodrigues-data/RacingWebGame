import { PHASE_LABELS, type RacePhase, type RaceSummaryDto } from '@tracado/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PhaseBadge, Spinner } from '../../components/ui';
import { get } from '../../lib/api';
import { isAdmin, useSession } from '../../lib/session';
import { AdminPage } from './AdminNav';

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
    <AdminPage title="Painel da direção de prova">
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
