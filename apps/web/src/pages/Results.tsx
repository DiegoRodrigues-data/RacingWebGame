import { formatLapTime, type QualifyingRowDto, type ResultRowDto } from '@tracado/shared';
import { useQuery } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import clsx from 'clsx';
import { motion } from 'motion/react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { CarIcon, Empty, Flag, Spinner } from '../components/ui';
import { get } from '../lib/api';
import { fmtGap } from '../lib/format';
import { useRace } from '../lib/queries';
import { useSession } from '../lib/session';
import { ShareRace } from '../components/ShareRace';

export default function Results() {
  const { id } = useParams();
  const me = useSession((s) => s.me);
  const { data: race } = useRace(id);
  const done = race && ['finished', 'archived'].includes(race.status);
  const res = useQuery({
    queryKey: ['results', id],
    queryFn: () => get<{ annulled: boolean; ranked: boolean; rows: ResultRowDto[] }>(`/races/${id}/results`),
    enabled: !!done,
  });
  const quali = useQuery({
    queryKey: ['quali', id],
    queryFn: () => get<QualifyingRowDto[]>(`/races/${id}/qualifying`),
    enabled: !!done,
  });
  const mine = res.data?.rows.find((r) => r.userId === me?.id);
  useEffect(() => {
    if (mine && mine.position <= 3 && !me?.profile.reducedMotion)
      void confetti({ particleCount: 140, spread: 90, origin: { y: 0.4 } });
  }, [mine, me?.profile.reducedMotion]);
  if (!race) return <Spinner />;
  if (!done)
    return (
      <Empty title="Resultado ainda não publicado" icon="⏳">
        <Link className="btn-primary mt-3" to={`/corridas/${id}`}>
          Voltar
        </Link>
      </Empty>
    );
  if (!res.data) return <Spinner />;
  const podium = res.data.rows.slice(0, 3);
  const order = [podium[1], podium[0], podium[2]].filter(Boolean) as ResultRowDto[];
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link to={`/corridas/${id}`} className="text-sm text-muted hover:text-ink">
            ← {race.name}
          </Link>
          <h1 className="font-display text-3xl">Resultado</h1>
          {res.data.annulled && (
            <p className="mt-1 rounded-xl bg-hot/15 px-3 py-1 text-sm text-hot">
              Resultado anulado pela direção de prova: não vale pontos.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <ShareRace race={race} position={mine?.position ?? null} />
          <Link to={`/corridas/${id}/replay`} className="btn-ghost">
            📼 Ver replay
          </Link>
        </div>
      </header>
      {mine &&
        (() => {
          const rows = res.data!.rows;
          const ahead = rows.find((r) => r.position === mine.position - 1);
          const behind = rows.find((r) => r.position === mine.position + 1);
          const gap = (a: ResultRowDto, b: ResultRowDto) =>
            a.totalTimeMs != null && b.totalTimeMs != null
              ? `${(Math.abs(a.totalTimeMs - b.totalTimeMs) / 1000).toFixed(1)}s`
              : '';
          return (
            <div className="flex flex-wrap justify-center gap-2 text-sm">
              {ahead && (
                <span className="chip !py-1">
                  🎯 Rival à frente: <b>{ahead.nickname}</b> {gap(ahead, mine)}
                </span>
              )}
              {behind && (
                <span className="chip !py-1">
                  🛡️ Na sua cola: <b>{behind.nickname}</b> {gap(behind, mine)}
                </span>
              )}
            </div>
          );
        })()}
      {mine && (
        <div className="card border-race text-center">
          Você terminou em{' '}
          <b className="font-display text-2xl text-race">
            {mine.status === 'finished' ? `${mine.position}º` : 'abandono'}
          </b>
          {res.data.ranked && !res.data.annulled && (
            <>
              {' '}
              e somou <b className="text-race">{mine.points} pontos</b>
            </>
          )}
          .
        </div>
      )}
      <div className="flex items-end justify-center gap-2 sm:gap-4" aria-label="Pódio">
        {order.map((p) => {
          const h = p.position === 1 ? 'h-40' : p.position === 2 ? 'h-28' : 'h-20';
          return (
            <motion.div
              key={p.userId}
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: (3 - p.position) * 0.25, type: 'spring' }}
              className="flex w-28 flex-col items-center sm:w-36"
            >
              <CarIcon color={p.carColor} model={p.carModel} className="h-12" />
              <Link
                to={`/pilotos/${p.userId}`}
                className="mt-1 max-w-full truncate font-bold hover:text-race"
              >
                {p.nickname}
              </Link>
              <div className="text-xs text-muted">
                <Flag country={p.country} /> {formatLapTime(p.totalTimeMs)}
              </div>
              <div
                className={clsx(
                  'mt-2 grid w-full place-items-center rounded-t-2xl font-display text-4xl',
                  h,
                  p.position === 1
                    ? 'bg-race text-night'
                    : p.position === 2
                      ? 'bg-[#cfd8ff] text-night'
                      : 'bg-[#e0a46b] text-night',
                )}
              >
                {p.position}
              </div>
            </motion.div>
          );
        })}
      </div>
      <div className="card overflow-x-auto !p-0">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Classificação final</caption>
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="p-3">Pos</th>
              <th>Piloto</th>
              <th>Tempo</th>
              <th>Melhor volta</th>
              <th>Voltas</th>
              <th>Paradas</th>
              <th className="pr-3 text-right">Pontos</th>
            </tr>
          </thead>
          <tbody>
            {res.data.rows.map((r) => (
              <tr
                key={r.userId}
                className={clsx('border-t border-line', r.userId === me?.id && 'bg-race/10')}
              >
                <td className="p-3 font-display text-lg">{r.status === 'finished' ? r.position : 'ABD'}</td>
                <td>
                  <span className="flex items-center gap-2">
                    <CarIcon color={r.carColor} model={r.carModel} className="h-6" />
                    <Flag country={r.country} />
                    <Link to={`/pilotos/${r.userId}`} className="font-bold hover:text-race">
                      {r.nickname}
                    </Link>
                  </span>
                </td>
                <td className="font-mono">
                  {r.status === 'finished'
                    ? r.position === 1
                      ? formatLapTime(r.totalTimeMs)
                      : fmtGap(r.gapMs)
                    : '—'}
                </td>
                <td className={clsx('font-mono', r.fastestLap && 'font-bold text-violet')}>
                  {formatLapTime(r.bestLapMs)} {r.fastestLap && '⚡'}
                </td>
                <td>{r.lapsCompleted}</td>
                <td>{r.pitStops}</td>
                <td className="pr-3 text-right font-mono font-bold">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {quali.data && (
        <details className="card">
          <summary className="cursor-pointer font-display">Classificação (grid de largada)</summary>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {quali.data.map((q) => (
              <li key={q.userId} className="flex justify-between gap-2">
                <span>
                  {q.position}. {q.nickname} {q.usedDefaultTrace && '⚠️'}
                </span>
                <span className="font-mono">{formatLapTime(q.lapTimeMs)}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
