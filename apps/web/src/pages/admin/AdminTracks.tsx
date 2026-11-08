import type { TrackVersionDto } from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Tabs, toast } from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { fmtKm, TERRAIN_LABEL } from '../../lib/format';
import { isAdmin, useSession } from '../../lib/session';
import { AdminPage } from './AdminNav';

type Row = TrackVersionDto & { issues: { code: string; message: string }[] };
const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  review: 'Em revisão',
  published: 'Publicada',
  deprecated: 'Descontinuada',
};

export default function AdminTracks() {
  const me = useSession((s) => s.me);
  const qc = useQueryClient();
  // Descontinuadas saem das listas: ficam só na aba própria (histórico das corridas que já usaram).
  const [tab, setTab] = useState<'special' | 'procedural' | 'deprecated'>('special');
  const kind = tab === 'procedural' ? 'procedural' : 'special';
  const { data: all } = useQuery({
    queryKey: ['admin-tracks', kind],
    queryFn: () => get<Row[]>(`/admin/tracks?kind=${kind}`),
  });
  const data = all?.filter((t) => (tab === 'deprecated') === (t.status === 'deprecated'));
  const act = async (id: string, action: string) => {
    try {
      const r = await post<{ retired?: { pool: number; plans: number; races: number } }>(
        `/admin/tracks/versions/${id}/${action}`,
      );
      const out = r.retired;
      toast(
        action === 'deprecate' ? 'Pista descontinuada' : 'Pista atualizada',
        out
          ? [
              out.races && `${out.races} corrida(s) aberta(s) passaram para pista gerada`,
              out.pool && 'saiu do rodízio',
              out.plans && `${out.plans} reserva(s) cancelada(s)`,
            ]
              .filter(Boolean)
              .join(' · ') || 'Não estava em uso.'
          : undefined,
        'ok',
      );
      void qc.invalidateQueries({ queryKey: ['admin-tracks'] });
      void qc.invalidateQueries({ queryKey: ['admin-track-day'] });
    } catch (x) {
      toast('Ação recusada', errorMessage(x), 'error');
    }
  };
  return (
    <AdminPage
      title="Pistas"
      actions={
        <Link to="/admin/pistas/editor" className="btn-primary">
          Nova pista especial
        </Link>
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'special', label: 'Especiais' },
          { value: 'procedural', label: 'Procedurais' },
          { value: 'deprecated', label: 'Descontinuadas' },
        ]}
      />
      {tab === 'deprecated' && (
        <p className="mt-3 text-sm text-muted">
          Fora do rodízio, das reservas e das corridas novas. Ficam aqui pelo histórico das corridas que já
          usaram.
        </p>
      )}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {data?.map((t) => (
          <li key={t.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-lg">
                  {t.trackName} <span className="text-sm text-muted">v{t.version}</span>
                </div>
                <div className="text-xs text-muted">
                  {fmtKm(t.meta.length)} · {t.meta.corners} curvas · {TERRAIN_LABEL[t.meta.terrain]} · hash{' '}
                  {t.geometryHash.slice(0, 10)}
                  {t.source.type === 'procedural' && ` · seed ${t.source.seed}`}
                </div>
              </div>
              <span className="chip">{STATUS_LABEL[t.status]}</span>
            </div>
            {t.issues.length > 0 && (
              <ul className="mt-2 text-xs text-hot">
                {t.issues.map((i) => (
                  <li key={i.code}>⚠️ {i.message}</li>
                ))}
              </ul>
            )}
            {t.kind === 'special' && (
              <div className="mt-3 flex flex-wrap gap-1">
                <Link to={`/admin/pistas/editor/${t.id}`} className="btn-ghost !py-1 text-xs">
                  {t.status === 'draft' ? 'Editar' : 'Nova versão a partir desta'}
                </Link>
                {t.status === 'draft' && (
                  <button className="btn-ghost !py-1 text-xs" onClick={() => act(t.id, 'submit')}>
                    Submeter para revisão
                  </button>
                )}
                {isAdmin(me) && (t.status === 'draft' || t.status === 'review') && (
                  <button className="btn-go !py-1 text-xs" onClick={() => act(t.id, 'publish')}>
                    Publicar
                  </button>
                )}
                {isAdmin(me) && t.status === 'review' && (
                  <button className="btn-ghost !py-1 text-xs" onClick={() => act(t.id, 'reject')}>
                    Devolver
                  </button>
                )}
                {isAdmin(me) && t.status === 'published' && (
                  <button className="btn-ghost !py-1 text-xs" onClick={() => act(t.id, 'deprecate')}>
                    Descontinuar
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </AdminPage>
  );
}
