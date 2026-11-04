import { LEVEL_XP, nextLevel, RANKING_SCOPE_LABELS, formatLapTime, type Level } from '@tracado/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { CarIcon, Empty, Flag, LevelBadge, Spinner } from '../components/ui';
import { get } from '../lib/api';
import { useSession } from '../lib/session';

interface ProfileDto {
  profile: {
    userId: string;
    nickname: string;
    country: string;
    region: string;
    city: string;
    carColor: string;
    level: Level;
    xp: number;
  };
  stats: { races: number; wins: number; podiums: number; fastestLaps: number; points: number };
  season: { id: string; name: string } | null;
  positions: Record<string, number | null>;
  recent: {
    raceId: string;
    raceName: string;
    at: string;
    position: number;
    status: string;
    points: number;
    bestLapMs: number | null;
    annulled: boolean;
  }[];
}

export default function Profile() {
  const { id } = useParams();
  const me = useSession((s) => s.me);
  const { data, isLoading } = useQuery({
    queryKey: ['profile', id],
    queryFn: () => get<ProfileDto>(`/users/${id}`),
  });
  if (isLoading) return <Spinner />;
  if (!data) return <Empty title="Piloto não encontrado" />;
  const p = data.profile;
  const nl = nextLevel(p.level);
  const pct = nl
    ? Math.min(100, ((p.xp - LEVEL_XP[p.level]) / (LEVEL_XP[nl] - LEVEL_XP[p.level])) * 100)
    : 100;
  return (
    <div className="space-y-6">
      <header className="card flex flex-wrap items-center gap-4">
        <CarIcon color={p.carColor} model={1} className="h-16" />
        <div className="flex-1">
          <h1 className="font-display text-3xl">{p.nickname}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Flag country={p.country} /> {p.city}, {p.region} <LevelBadge level={p.level} />
          </div>
          <div className="mt-2 max-w-sm">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>{p.xp} XP</span>
              <span>{nl ? `${LEVEL_XP[nl]} XP para o próximo nível` : 'nível máximo'}</span>
            </div>
            <div className="h-2 rounded-full bg-night-3">
              <div className="h-full rounded-full bg-violet" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        {me?.id === p.userId && (
          <Link to="/conta" className="btn-ghost">
            Editar perfil
          </Link>
        )}
      </header>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ['Corridas', data.stats.races],
            ['Vitórias', data.stats.wins],
            ['Pódios', data.stats.podiums],
            ['Voltas + rápidas', data.stats.fastestLaps],
            ['Pontos (carreira)', data.stats.points],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="card text-center">
            <div className="font-display text-3xl text-race">{v}</div>
            <div className="text-xs text-muted">{k}</div>
          </div>
        ))}
      </section>
      <section aria-labelledby="conq">
        <h2 id="conq" className="font-display text-xl">
          Conquistas
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ['🏁', 'Primeira largada', data.stats.races >= 1],
              ['🔟', '10 corridas', data.stats.races >= 10],
              ['🥉', 'Primeiro pódio', data.stats.podiums >= 1],
              ['🏆', 'Primeira vitória', data.stats.wins >= 1],
              ['⚡', 'Volta mais rápida', data.stats.fastestLaps >= 1],
              ['👑', '5 vitórias', data.stats.wins >= 5],
            ] as const
          ).map(([icon, label, ok]) => (
            <li
              key={label}
              className={`chip !py-1.5 ${ok ? 'border-race text-race' : 'opacity-40'}`}
              title={ok ? 'Conquistada' : 'Ainda não conquistada'}
            >
              {icon} {label}
            </li>
          ))}
        </ul>
      </section>
      {data.season && (
        <section className="card">
          <h2 className="font-display">Posição em {data.season.name}</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['local', 'regional', 'national', 'world'] as const).map((s) => (
              <div key={s} className="rounded-xl bg-night p-3 text-center">
                <div className="font-display text-2xl">
                  {data.positions[s] ? `${data.positions[s]}º` : '—'}
                </div>
                <div className="text-xs text-muted">{RANKING_SCOPE_LABELS[s]}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="font-display text-xl">Últimas corridas</h2>
        {!data.recent.length && <p className="mt-2 text-sm text-muted">Nenhuma corrida ainda.</p>}
        <ul className="mt-3 space-y-2">
          {data.recent.map((r) => (
            <li key={r.raceId}>
              <Link
                to={`/corridas/${r.raceId}/resultado`}
                className="card flex items-center gap-3 !p-3 hover:border-race/60"
              >
                <span className="w-12 font-display text-xl text-race">
                  {r.status === 'finished' ? `${r.position}º` : 'ABD'}
                </span>
                <span className="flex-1">
                  <span className="font-bold">{r.raceName}</span>
                  <span className="block text-xs text-muted">
                    {new Date(r.at).toLocaleDateString('pt-BR')} · melhor volta {formatLapTime(r.bestLapMs)}
                  </span>
                </span>
                <span className="font-mono font-bold">{r.annulled ? 'anulada' : `${r.points} pts`}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
