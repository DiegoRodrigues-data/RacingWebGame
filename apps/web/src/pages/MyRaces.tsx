import { LIVE_PHASES, SETUP_EDITABLE_PHASES, type RaceSummaryDto } from '@tracado/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { RaceCard } from '../components/RaceCard';
import { RaceHistory } from '../components/RaceHistory';
import { Empty, Skeleton } from '../components/ui';
import { get } from '../lib/api';

function Cta({ r }: { r: RaceSummaryDto }) {
  if (r.status === 'race')
    return (
      <Link className="btn-danger !py-1.5" to={`/corridas/${r.id}/ao-vivo`}>
        Ao vivo
      </Link>
    );
  if (r.status === 'finished' || r.status === 'archived')
    return (
      <Link className="btn-ghost !py-1.5" to={`/corridas/${r.id}/resultado`}>
        Resultado
      </Link>
    );
  if (r.status === 'cancelled') return null;
  if (SETUP_EDITABLE_PHASES.includes(r.status))
    return (
      <Link className="btn-primary !py-1.5" to={`/corridas/${r.id}/box`}>
        Ir para o box
      </Link>
    );
  return undefined;
}

function Section({ title, races, hint }: { title: string; races: RaceSummaryDto[]; hint?: string }) {
  if (!races.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl">
        {title} <span className="text-base text-muted">({races.length})</span>
      </h2>
      {hint && <p className="-mt-2 text-sm text-muted">{hint}</p>}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {races.map((r) => (
          <RaceCard key={r.id} race={r} cta={<Cta r={r} />} />
        ))}
      </div>
    </section>
  );
}

/** Corridas em que o jogador está inscrito: em andamento, próximas e encerradas. */
export default function MyRaces() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-races'],
    queryFn: () => get<RaceSummaryDto[]>('/me/races'),
    refetchInterval: 30_000,
  });
  const live = (data ?? []).filter((r) => r.status === 'race' || LIVE_PHASES.includes(r.status));
  const next = (data ?? [])
    .filter((r) => r.status === 'scheduled' || r.status === 'registration_open')
    .sort((a, b) => a.timeline.practiceAt.localeCompare(b.timeline.practiceAt));
  const past = (data ?? []).filter((r) => ['finished', 'archived', 'cancelled'].includes(r.status));
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="font-display text-3xl">Minhas corridas</h1>
        <Link to="/calendario" className="btn-ghost">
          Encontrar outra corrida
        </Link>
      </header>
      {isLoading && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      )}
      {data && !data.length && (
        <Empty title="Você ainda não se inscreveu em nenhuma corrida" icon="🏁">
          <Link className="btn-primary mt-3" to="/calendario">
            Escolher corrida
          </Link>
        </Empty>
      )}
      <Section
        title="Em andamento"
        races={live}
        hint="Treino, traçado, classificação ou corrida acontecendo agora."
      />
      <Section
        title="Próximas"
        races={next}
        hint="Prepare o carro e o traçado no box antes do parque fechado."
      />
      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">
            Histórico <span className="text-base text-muted">({past.length})</span>
          </h2>
          <RaceHistory races={past} preview={5} />
        </section>
      )}
    </div>
  );
}
