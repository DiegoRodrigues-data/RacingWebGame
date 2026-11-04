import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { toast } from '../../components/ui';
import { errorMessage, get, patch, post } from '../../lib/api';
import { useCategories } from '../../lib/queries';
import { AdminPage } from './AdminNav';

interface EventRow {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  startsAt: string;
  endsAt: string;
  ranked: boolean;
  status: 'draft' | 'published' | 'cancelled';
}

export default function AdminEvents() {
  const qc = useQueryClient();
  const cats = useCategories();
  const { data } = useQuery({ queryKey: ['admin-events'], queryFn: () => get<EventRow[]>('/admin/events') });
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await post('/admin/events', {
        name: f.name,
        description: f.description,
        categoryId: f.categoryId,
        startsAt: new Date(f.startsAt!).toISOString(),
        endsAt: new Date(f.endsAt!).toISOString(),
        ranked: f.ranked === 'on',
        status: f.status,
      });
      toast(
        'Evento criado',
        'Associe corridas a ele pelo ID do evento na API, ou crie corridas da mesma categoria.',
        'ok',
      );
      void qc.invalidateQueries({ queryKey: ['admin-events'] });
    } catch (x) {
      toast('Erro', errorMessage(x), 'error');
    }
  }
  return (
    <AdminPage title="Eventos">
      <form onSubmit={create} className="card grid gap-3 sm:grid-cols-3">
        <input
          name="name"
          className="input"
          placeholder="Nome do evento"
          required
          minLength={2}
          aria-label="Nome"
        />
        <select name="categoryId" className="input" aria-label="Categoria">
          {cats.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="status" className="input" aria-label="Status">
          <option value="draft">Rascunho</option>
          <option value="published">Publicado</option>
        </select>
        <input name="startsAt" type="datetime-local" className="input" required aria-label="Início" />
        <input name="endsAt" type="datetime-local" className="input" required aria-label="Fim" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ranked" defaultChecked className="size-4 accent-[#ffcc00]" /> Ranqueado
        </label>
        <input
          name="description"
          className="input sm:col-span-2"
          placeholder="Descrição"
          aria-label="Descrição"
        />
        <button className="btn-primary">Criar evento</button>
      </form>
      <ul className="mt-4 space-y-2">
        {data?.map((ev) => (
          <li key={ev.id} className="card flex flex-wrap items-center justify-between gap-2 !p-3">
            <div>
              <div className="font-bold">{ev.name}</div>
              <div className="text-xs text-muted">
                {new Date(ev.startsAt).toLocaleDateString('pt-BR')} –{' '}
                {new Date(ev.endsAt).toLocaleDateString('pt-BR')} · {ev.status} · id {ev.id.slice(0, 8)}
              </div>
            </div>
            <div className="flex gap-1">
              {ev.status !== 'published' && (
                <button
                  className="btn-ghost !py-1 text-xs"
                  onClick={() =>
                    patch(`/admin/events/${ev.id}`, { status: 'published' }).then(() =>
                      qc.invalidateQueries({ queryKey: ['admin-events'] }),
                    )
                  }
                >
                  Publicar
                </button>
              )}
              {ev.status !== 'cancelled' && (
                <button
                  className="btn-ghost !py-1 text-xs"
                  onClick={() =>
                    patch(`/admin/events/${ev.id}`, { status: 'cancelled' }).then(() =>
                      qc.invalidateQueries({ queryKey: ['admin-events'] }),
                    )
                  }
                >
                  Cancelar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </AdminPage>
  );
}
