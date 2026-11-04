import type { RaceSummaryDto } from '@tracado/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { RaceCard } from '../components/RaceCard';
import { Empty, Skeleton, Tabs } from '../components/ui';
import { get } from '../lib/api';
import { useCategories } from '../lib/queries';
import { useServerNow } from '../lib/realtime';

type Range = 'hoje' | 'amanha' | 'semana';

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
    ...(onlyOpen ? { status: 'registration_open' } : {}),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['races', qs.toString()],
    queryFn: () => get<RaceSummaryDto[]>(`/races?${qs}`),
    refetchInterval: 30_000,
  });
  const byDay = useMemo(() => {
    const m = new Map<string, RaceSummaryDto[]>();
    for (const r of data ?? []) {
      const k = new Date(r.timeline.practiceAt).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
      });
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [data]);
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
        <label className="flex items-center gap-2 text-sm font-semibold text-muted">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
            className="size-4 accent-[#ffcc00]"
          />
          Só com inscrições abertas
        </label>
      </div>
      {isLoading && (
        <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      )}
      {data && !data.length && (
        <div className="mt-6">
          <Empty title="Nenhuma corrida neste período" icon="📅">
            Tente outro período ou categoria.
          </Empty>
        </div>
      )}
      {byDay.map(([day, list]) => (
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
