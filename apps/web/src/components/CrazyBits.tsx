import {
  CRAZY_AWARDS,
  CRAZY_SKIP_LOCK_MS,
  CRAZY_SKIPPABLE_PHASES,
  crazyStartAllowed,
  type CrazyAwardDto,
  type CrazyGroupDto,
  type RaceDetailDto,
  type RaceSummaryDto,
} from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';
import { Link } from 'react-router';
import { CAR_CSS } from '../game/assets';
import { errorMessage, get, post, put } from '../lib/api';
import { useRace } from '../lib/queries';
import { useServerNow } from '../lib/realtime';
import { useSession } from '../lib/session';
import { toast } from './ui';

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

/** Na Corrida Maluca o preparo (treino e janela de traçado) pode ser pulado. */
export function canSkipPrep(race: RaceDetailDto, now: number) {
  return (
    !!race.crazy &&
    (CRAZY_SKIPPABLE_PHASES as readonly string[]).includes(race.status) &&
    now < Date.parse(race.timeline.setupLockAt) - CRAZY_SKIP_LOCK_MS
  );
}

/**
 * "Estou pronto" de cada piloto e "Largar agora" do organizador. Com todos prontos a corrida pula direto para a
 * classificação ao vivo; o organizador pode mandar largar com metade da turma pronta.
 */
export function ReadyBar({
  race,
  unsavedSetup = false,
  className,
}: {
  race: RaceDetailDto;
  unsavedSetup?: boolean;
  className?: string;
}) {
  const me = useSession((s) => s.me);
  const qc = useQueryClient();
  const now = useServerNow(1000);
  const [busy, setBusy] = useState(false);
  if (!canSkipPrep(race, now)) return null;
  const humans = race.entries.filter((e) => e.status === 'confirmed' && !e.bot);
  const ready = humans.filter((e) => e.ready);
  const waiting = humans.filter((e) => !e.ready);
  const mine = humans.find((e) => e.userId === me?.id);
  const owner = !!me && race.crazy!.ownerId === me.id;
  const startOk = crazyStartAllowed(ready.length, humans.length);
  const refresh = () => qc.invalidateQueries({ queryKey: ['race', race.id] });

  async function toggle() {
    setBusy(true);
    try {
      const r = await put<{ skipped: boolean }>(`/races/${race.id}/ready`, { ready: !mine!.ready });
      if (r.skipped) toast('Todo mundo pronto! 🏁', 'Pulando direto para a classificação.', 'ok');
      await refresh();
    } catch (x) {
      toast('Não deu', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function startNow() {
    setBusy(true);
    try {
      await post(`/races/${race.id}/start-now`);
      toast('Bora largar! 🏁', 'Quem não ficou pronto corre com o que salvou.', 'ok');
      await refresh();
    } catch (x) {
      toast('Ainda não', errorMessage(x), 'warn');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={clsx('card flex flex-wrap items-center gap-3 border-violet/70', className)}>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-bold">
          ✅ {ready.length}/{humans.length} prontos
          {waiting.length > 0 && waiting.length <= 4 && (
            <span className="font-normal text-muted">
              {' '}
              · esperando {waiting.map((e) => e.nickname).join(', ')}
            </span>
          )}
        </div>
        <div className="text-xs text-muted">
          Todo mundo pronto pula o resto do preparo e vai direto para a classificação ao vivo.
          {mine && !mine.ready && ' Vale o setup e o traçado que estiverem salvos.'}
        </div>
        {mine && !mine.ready && unsavedSetup && (
          <div className="mt-1 text-xs font-bold text-hot">Você tem mudanças no setup ainda não salvas.</div>
        )}
      </div>
      {mine && (
        <button
          className={mine.ready ? 'btn-ghost !py-1.5' : 'btn-go !py-1.5'}
          disabled={busy}
          onClick={toggle}
        >
          {mine.ready ? 'Pronto ✓ (desfazer)' : '✅ Estou pronto'}
        </button>
      )}
      {owner && (
        <button
          className="btn-danger !py-1.5"
          disabled={busy || !startOk}
          onClick={startNow}
          title={startOk ? 'Pula o resto do preparo' : 'Libera com pelo menos metade da turma pronta'}
        >
          🏁 Largar agora
        </button>
      )}
    </div>
  );
}

/** Para a página do grupo: busca a corrida e mostra a barra de prontos. */
export function RaceReadyBar({ raceId }: { raceId: string }) {
  const { data } = useRace(raceId);
  return data ? <ReadyBar race={data} /> : null;
}
