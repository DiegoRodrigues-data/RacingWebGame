import { RANKING_SCOPE_LABELS, type RankingRowDto, type RankingScope } from '@tracado/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';
import { Link } from 'react-router';
import { Empty, Flag, LevelBadge, Spinner, Tabs } from '../components/ui';
import { get } from '../lib/api';
import { useRanking } from '../lib/queries';
import { useSession } from '../lib/session';

function Row({ r, me }: { r: RankingRowDto; me?: boolean }) {
  return (
    <tr className={clsx('border-t border-line', me && 'bg-race/10')}>
      <td className="p-3 font-display text-lg text-race">{r.position}</td>
      <td>
        <span className="flex items-center gap-2">
          <Flag country={r.country} />
          <Link to={`/pilotos/${r.userId}`} className="font-bold hover:text-race">
            {r.nickname}
          </Link>
          <span className="hidden sm:inline">
            <LevelBadge level={r.level} />
          </span>
        </span>
        <span className="text-xs text-muted">
          {r.city}, {r.region}
        </span>
      </td>
      <td className="text-center">{r.races}</td>
      <td className="text-center">{r.wins}</td>
      <td className="text-center">{r.podiums}</td>
      <td className="hidden text-center sm:table-cell">{r.fastestLaps}</td>
      <td className="pr-3 text-right font-mono text-base font-bold">{r.points}</td>
    </tr>
  );
}

export default function Rankings() {
  const me = useSession((s) => s.me);
  const [scope, setScope] = useState<RankingScope>('world');
  const [key, setKey] = useState('');
  const [season, setSeason] = useState('');
  const [page, setPage] = useState(1);
  const seasons = useQuery({
    queryKey: ['seasons'],
    queryFn: () => get<{ id: string; name: string; status: string }[]>('/seasons'),
  });
  const needsKey = scope !== 'world' && !me && !key;
  const q = useRanking({ scope, ...(key ? { key } : {}), ...(season ? { season } : {}), page });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl">Rankings</h1>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={scope}
          onChange={(s) => {
            setScope(s);
            setKey('');
            setPage(1);
          }}
          items={(['local', 'regional', 'national', 'world'] as RankingScope[]).map((s) => ({
            value: s,
            label: RANKING_SCOPE_LABELS[s],
          }))}
        />
        <select
          className="input !w-auto !py-2"
          value={season}
          onChange={(e) => setSeason(e.target.value)}
          aria-label="Temporada"
        >
          <option value="">Temporada atual</option>
          {seasons.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.status === 'closed' ? '(encerrada)' : ''}
            </option>
          ))}
        </select>
        {scope === 'national' && (
          <input
            className="input !w-28 !py-2"
            placeholder="País (BR)"
            maxLength={2}
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            aria-label="Código do país"
          />
        )}
      </div>
      <p className="text-sm text-muted">
        Pontuação por corrida ranqueada conforme a categoria (padrão 25-18-15-12-10-8-6-4-2-1 + 1 pela volta
        mais rápida). Desempate: vitórias, pódios, voltas mais rápidas, menos corridas e quem entrou antes na
        temporada.
      </p>
      {needsKey ? (
        <Empty title="Entre para ver seu ranking" icon="📍">
          Os rankings local e regional usam a cidade e a região do seu perfil.
        </Empty>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <Empty title="Ranking indisponível" icon="⚠️" />
      ) : q.data && q.data.rows.length === 0 ? (
        <Empty title="Ninguém pontuou ainda" icon="🏆">
          Dispute uma corrida ranqueada para aparecer aqui.
        </Empty>
      ) : (
        q.data && (
          <>
            <div className="text-sm text-muted">
              {q.data.season.name} · {RANKING_SCOPE_LABELS[q.data.scope]}{' '}
              {q.data.key !== 'world' && `· ${q.data.key}`} · {q.data.total} pilotos
            </div>
            <div className="card overflow-x-auto !p-0">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="p-3">#</th>
                    <th>Piloto</th>
                    <th className="text-center">Corr.</th>
                    <th className="text-center">Vit.</th>
                    <th className="text-center">Pód.</th>
                    <th className="hidden text-center sm:table-cell">VMR</th>
                    <th className="pr-3 text-right">Pontos</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.me && !q.data.rows.some((r) => r.userId === q.data!.me!.userId) && (
                    <Row r={q.data.me} me />
                  )}
                  {q.data.rows.map((r) => (
                    <Row key={r.userId} r={r} me={r.userId === me?.id} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-center gap-2">
              <button className="btn-ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </button>
              <button
                className="btn-ghost"
                disabled={page * q.data.pageSize >= q.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}
