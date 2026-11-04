import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Link } from 'react-router';
import { Empty, Spinner } from '../components/ui';
import { post } from '../lib/api';
import { useNotifications } from '../lib/queries';

export default function Notifications() {
  const { data, isLoading } = useNotifications();
  const qc = useQueryClient();
  const readAll = async () => {
    await post('/notifications/all/read');
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  if (isLoading) return <Spinner />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Notificações</h1>
        <button className="btn-ghost !py-1.5" onClick={readAll}>
          Marcar todas como lidas
        </button>
      </div>
      {!data?.length && <Empty title="Tudo em dia" icon="🔔" />}
      <ul className="space-y-2">
        {data?.map((n) => (
          <li key={n.id} className={clsx('card !p-3', !n.readAt && 'border-race')}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold">{n.title}</div>
                <div className="text-sm text-muted">{n.body}</div>
              </div>
              <time className="shrink-0 text-xs text-muted">
                {new Date(n.createdAt).toLocaleString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: '2-digit',
                })}
              </time>
            </div>
            {typeof n.payload.raceId === 'string' && (
              <Link
                to={`/corridas/${n.payload.raceId}`}
                className="mt-1 inline-block text-sm font-bold text-race"
              >
                Abrir corrida →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
