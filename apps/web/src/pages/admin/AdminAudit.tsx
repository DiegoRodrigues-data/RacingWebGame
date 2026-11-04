import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { AdminPage } from './AdminNav';

export default function AdminAudit() {
  const { data } = useQuery({
    queryKey: ['audit'],
    queryFn: () =>
      get<
        {
          id: string;
          action: string;
          targetType: string;
          targetId: string | null;
          actor: string | null;
          diff: unknown;
          createdAt: string;
        }[]
      >('/admin/audit'),
  });
  return (
    <AdminPage title="Auditoria">
      <ul className="space-y-2">
        {data?.map((a) => (
          <li key={a.id} className="card !p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                <b className="text-race">{a.action}</b> por <b>{a.actor ?? '—'}</b> em {a.targetType}{' '}
                {a.targetId?.slice(0, 8)}
              </span>
              <time className="text-xs text-muted">{new Date(a.createdAt).toLocaleString('pt-BR')}</time>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted">detalhes</summary>
              <pre className="mt-1 overflow-auto text-xs">{JSON.stringify(a.diff, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ul>
    </AdminPage>
  );
}
