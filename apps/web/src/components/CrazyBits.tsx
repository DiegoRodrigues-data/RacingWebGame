import { CRAZY_AWARDS, type CrazyAwardDto, type CrazyGroupDto, type RaceSummaryDto } from '@tracado/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Link } from 'react-router';
import { CAR_CSS } from '../game/assets';
import { get } from '../lib/api';

/** Selo da corrida de grupo, com link para o grupo. */
export function CrazyBadge({ race, className }: { race: RaceSummaryDto; className?: string }) {
  if (!race.crazy) return null;
  const c = race.crazy;
  return (
    <Link
      to={`/corrida-maluca/${c.groupId}`}
      className={clsx('chip border-violet text-violet hover:bg-violet/10', className)}
      title="Corrida fechada de um grupo de amigos (não vale ranking)"
    >
      🤪 {c.groupName}
      {c.rounds > 1 && ` · etapa ${c.round}/${c.rounds}`}
    </Link>
  );
}

export function CarDot({ color, className = 'size-3' }: { color: string; className?: string }) {
  return (
    <span
      className={clsx('inline-block shrink-0 rounded-full', className)}
      style={{ background: CAR_CSS[color] }}
    />
  );
}

/** Um troféu de zoeira: emoji, título, quem levou, o número e a frase. */
export function AwardCard({ a, compact }: { a: CrazyAwardDto; compact?: boolean }) {
  const def = CRAZY_AWARDS[a.key];
  return (
    <li className="flex gap-3 rounded-xl border border-line bg-night-2/60 p-3">
      <span className="text-3xl leading-none" aria-hidden>
        {def.emoji}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-base">{def.title}</span>
          <span className="truncate font-bold text-race">{a.nickname}</span>
          <span className="font-mono text-xs text-muted">{a.detail}</span>
        </div>
        {!compact && <p className="mt-0.5 text-sm text-muted">{a.line}</p>}
      </div>
    </li>
  );
}

export function AwardList({ awards, compact }: { awards: CrazyAwardDto[]; compact?: boolean }) {
  if (!awards.length)
    return <p className="text-sm text-muted">Sem troféus nesta corrida (faltou gente para zoar).</p>;
  return (
    <ul className={clsx('grid gap-2', !compact && 'sm:grid-cols-2')}>
      {awards.map((a, i) => (
        <AwardCard key={`${a.key}-${a.userId}-${i}`} a={a} compact={compact} />
      ))}
    </ul>
  );
}

/** Resenha da corrida no resultado: troféus de zoeira e link para a tabela do grupo. */
export function CrazyRaceRecap({ race }: { race: RaceSummaryDto }) {
  const groupId = race.crazy?.groupId;
  const { data } = useQuery({
    queryKey: ['crazy-group', groupId],
    queryFn: () => get<CrazyGroupDto>(`/crazy/groups/${groupId}`),
    enabled: !!groupId,
  });
  if (!race.crazy) return null;
  const item = data?.schedule.find((s) => s.raceId === race.id);
  return (
    <section className="card space-y-3 border-violet/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl">🤪 Resenha da corrida</h2>
        <Link to={`/corrida-maluca/${race.crazy.groupId}`} className="btn-ghost !py-1.5 text-sm">
          Tabela do {race.crazy.rounds > 1 ? 'campeonato' : 'grupo'}
        </Link>
      </div>
      {item ? (
        <AwardList awards={item.awards} />
      ) : (
        <p className="text-sm text-muted">Carregando os troféus…</p>
      )}
    </section>
  );
}
