import type { EventDto } from '@tracado/shared';
import { Link } from 'react-router';
import { Countdown } from './ui';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');

/** Cartão de evento (início e calendário de eventos). */
export function EventCard({ e }: { e: EventDto }) {
  const ended = Date.parse(e.endsAt) < Date.now();
  return (
    <Link
      to={`/eventos/${e.id}`}
      className="card block space-y-2 border-race/50 transition hover:border-race"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-race">🏆 Evento</div>
          <div className="truncate font-display text-xl">{e.name}</div>
          <div className="text-xs text-muted">
            {day(e.startsAt)} – {day(e.endsAt)} · {e.category.name} · {e.ranked ? 'ranqueado' : 'amistoso'}
          </div>
        </div>
        {ended && <span className="chip border-muted text-muted">Encerrado</span>}
      </div>
      {e.description && <p className="line-clamp-2 text-sm text-muted">{e.description}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          🏁 {e.upcomingRaces} {e.upcomingRaces === 1 ? 'corrida por vir' : 'corridas por vir'}
        </span>
        {e.finishedRaces > 0 && <span>{e.finishedRaces} encerradas</span>}
        {e.nextRaceAt && (
          <span>
            ⏱️ próxima em <Countdown to={e.nextRaceAt} className="text-ink" />
          </span>
        )}
      </div>
    </Link>
  );
}
