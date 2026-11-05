import type { EventDetailDto } from '@tracado/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { RaceCard } from '../components/RaceCard';
import { RaceHistory } from '../components/RaceHistory';
import { Empty, Spinner } from '../components/ui';
import { get } from '../lib/api';

const ENDED = ['finished', 'archived', 'cancelled'];

/** Página de um evento publicado: descrição, datas e as corridas (próximas em cards, encerradas no histórico). */
export default function EventPage() {
  const { id = '' } = useParams();
  const {
    data: e,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['event', id],
    queryFn: () => get<EventDetailDto>(`/events/${id}`),
    refetchInterval: 30_000,
  });
  if (isLoading) return <Spinner />;
  if (error || !e)
    return (
      <Empty title="Evento não encontrado" icon="🏆">
        <Link to="/calendario" className="btn-ghost mt-3">
          Ver o calendário
        </Link>
      </Empty>
    );
  const next = e.races.filter((r) => !ENDED.includes(r.status));
  const past = e.races.filter((r) => ENDED.includes(r.status)).reverse();
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  return (
    <div className="space-y-6">
      <header className="card border-race/60">
        <div className="text-xs font-bold uppercase tracking-wider text-race">🏆 Evento</div>
        <h1 className="font-display text-4xl">{e.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {fmt(e.startsAt)} até {fmt(e.endsAt)} · {e.category.name} · {e.ranked ? 'vale ranking' : 'amistoso'}
        </p>
        {e.description && <p className="mt-3 max-w-3xl whitespace-pre-line">{e.description}</p>}
      </header>
      <section className="space-y-3">
        <h2 className="font-display text-2xl">Corridas do evento</h2>
        {!next.length && (
          <p className="text-sm text-muted">
            {past.length
              ? 'Todas as corridas deste evento já aconteceram.'
              : 'As corridas deste evento ainda vão ser divulgadas.'}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {next.map((r) => (
            <RaceCard key={r.id} race={r} />
          ))}
        </div>
      </section>
      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">Histórico</h2>
          <RaceHistory races={past} preview={5} />
        </section>
      )}
    </div>
  );
}
