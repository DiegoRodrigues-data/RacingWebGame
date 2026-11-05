import type { RaceSummaryDto } from '@tracado/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { RaceCard } from '../components/RaceCard';
import { RaceHistory } from '../components/RaceHistory';
import { Empty, Skeleton, Tabs } from '../components/ui';
import { get } from '../lib/api';
import { useCategories } from '../lib/queries';
import { useServerNow } from '../lib/realtime';

type Range = 'hoje' | 'amanha' | 'semana' | 'historico';

/** Fases de quem ainda vai correr ou está correndo (as encerradas ficam no histórico). */
const UPCOMING = 'scheduled,registration_open,practice,trace_window,setup_lock,qualifying,race';
const ENDED = 'finished,archived,cancelled';
const PAGE = 30;

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

function groupByDay(list: RaceSummaryDto[]) {
  const m = new Map<string, RaceSummaryDto[]>();
  for (const r of list) {
    const k = dayLabel(r.timeline.practiceAt);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.entries()];
}

/** Histórico: corridas encerradas e canceladas, das mais recentes para as mais antigas, em páginas. */
function History({ category }: { category: string }) {
  const q = useInfiniteQuery({
    queryKey: ['races-history', category],
    initialPageParam: Date.now(),
    queryFn: ({ pageParam }) =>
      get<RaceSummaryDto[]>(
        `/races?${new URLSearchParams({
          from: '0',
          to: String(pageParam),
          status: ENDED,
          order: 'desc',
          limit: String(PAGE),
          ...(category ? { category } : {}),
        })}`,
      ),
    getNextPageParam: (last) =>
      last.length < PAGE ? undefined : Date.parse(last[last.length - 1]!.timeline.practiceAt) - 1,
  });
  const all = useMemo(() => {
    const seen = new Set<string>();
    return (q.data?.pages.flat() ?? []).filter((r) => !seen.has(r.id) && seen.add(r.id));
  }, [q.data]);
  if (q.isLoading)
    return (
      <div className="mt-6">
        <Skeleton className="h-64" />
      </div>
    );
  if (!all.length)
    return (
      <div className="mt-6">
        <Empty title="Nenhuma corrida encerrada ainda" icon="🏁" />
      </div>
    );
  return (
    <div className="mt-6 space-y-4">
      <RaceHistory races={all} />
      {q.hasNextPage && (
        <div className="text-center">
          <button
            className="btn-ghost"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? 'Carregando…' : 'Carregar mais antigas'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Calendar() {
  const [range, setRange] = useState<Range>('semana');
  const [category, setCategory] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const now = useServerNow(60_000);
  const { from, to } = useMemo(() => {
    const d = new Date(now);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (range === 'hoje') return { from: now - 3 * 3600_000, to: start + 86_400_000 };
    if (range === 'amanha') return { from: start + 86_400_000, to: start + 2 * 86_400_000 };
    return { from: now - 3 * 3600_000, to: start + 8 * 86_400_000 };
  }, [range, now]);
  const cats = useCategories();
  const qs = new URLSearchParams({
    from: String(from),
    to: String(to),
    ...(category ? { category } : {}),
    status: onlyOpen ? 'registration_open' : UPCOMING,
  });
  const history = range === 'historico';
  const { data, isLoading } = useQuery({
    queryKey: ['races', qs.toString()],
    queryFn: () => get<RaceSummaryDto[]>(`/races?${qs}`),
    refetchInterval: 30_000,
    enabled: !history,
  });
  const byDay = useMemo(() => groupByDay(data ?? []), [data]);
  return (
    <div>
      <h1 className="font-display text-3xl">Calendário</h1>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Tabs
          value={range}
          onChange={setRange}
          items={[
            { value: 'hoje', label: 'Hoje' },
            { value: 'amanha', label: 'Amanhã' },
            { value: 'semana', label: '7 dias' },
            { value: 'historico', label: 'Histórico' },
          ]}
        />
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Categoria</span>
          <select
            className="input !w-auto !py-2"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todas as categorias</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`flex items-center gap-2 text-sm font-semibold text-muted ${history ? 'hidden' : ''}`}
        >
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
            className="size-4 accent-[#ffcc00]"
          />
          Só com inscrições abertas
        </label>
      </div>
      {history && <History category={category} />}
      {!history && isLoading && (
        <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      )}
      {!history && data && !data.length && (
        <div className="mt-6">
          <Empty title="Nenhuma corrida neste período" icon="📅">
            Tente outro período ou categoria.
          </Empty>
        </div>
      )}
      {!history &&
        byDay.map(([day, list]) => (
          <section key={day} className="mt-8">
            <h2 className="mb-3 font-display text-lg capitalize text-muted">{day}</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {list.map((r) => (
                <RaceCard key={r.id} race={r} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
