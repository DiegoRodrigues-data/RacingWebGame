import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { toast } from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { AdminPage } from './AdminNav';

export default function AdminSeasons() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['seasons'],
    queryFn: () =>
      get<{ id: string; name: string; startsAt: string; endsAt: string; status: string }[]>('/seasons'),
  });
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await post('/admin/seasons', {
        name: f.name,
        startsAt: new Date(f.startsAt!).toISOString(),
        endsAt: new Date(f.endsAt!).toISOString(),
      });
      void qc.invalidateQueries({ queryKey: ['seasons'] });
    } catch (x) {
      toast('Erro', errorMessage(x), 'error');
    }
  }
  return (
    <AdminPage title="Temporadas">
      <form onSubmit={create} className="card grid gap-3 sm:grid-cols-4">
        <input name="name" className="input" placeholder="Nome" required aria-label="Nome" />
        <input name="startsAt" type="date" className="input" required aria-label="Início" />
        <input name="endsAt" type="date" className="input" required aria-label="Fim" />
        <button className="btn-primary">Criar temporada</button>
      </form>
      <ul className="mt-4 space-y-2">
        {data?.map((s) => (
          <li key={s.id} className="card flex flex-wrap items-center justify-between gap-2 !p-3">
            <div>
              <div className="font-bold">{s.name}</div>
              <div className="text-xs text-muted">
                {new Date(s.startsAt).toLocaleDateString('pt-BR')} –{' '}
                {new Date(s.endsAt).toLocaleDateString('pt-BR')} ·{' '}
                {s.status === 'active' ? 'ativa' : 'encerrada'}
              </div>
            </div>
            <div className="flex gap-1">
              <button
                className="btn-ghost !py-1 text-xs"
                onClick={() =>
                  post('/admin/rankings/rebuild', { seasonId: s.id }).then(() =>
                    toast('Ranking reconstruído', undefined, 'ok'),
                  )
                }
              >
                Reconstruir ranking
              </button>
              {s.status === 'active' && (
                <button
                  className="btn-danger !py-1 text-xs"
                  onClick={async () => {
                    if (!window.confirm('Encerrar a temporada? Promoções e rebaixamentos serão aplicados.'))
                      return;
                    const r = await post<{ changes: unknown[] }>(`/admin/seasons/${s.id}/close`);
                    toast('Temporada encerrada', `${r.changes.length} mudanças de nível.`, 'ok');
                    void qc.invalidateQueries({ queryKey: ['seasons'] });
                  }}
                >
                  Encerrar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </AdminPage>
  );
}
