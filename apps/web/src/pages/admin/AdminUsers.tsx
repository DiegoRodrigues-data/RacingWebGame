import type { Role } from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../components/ui';
import { errorMessage, get, patch } from '../../lib/api';
import { AdminPage } from './AdminNav';

interface U {
  id: string;
  email: string;
  nickname: string;
  roles: Role[];
  isBot: boolean;
  flagged: boolean;
  verified: boolean;
  level: string;
  createdAt: string;
  signupIp: string | null;
}

export default function AdminUsers() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [flagged, setFlagged] = useState(false);
  const { data } = useQuery({
    queryKey: ['admin-users', q, flagged],
    queryFn: () => get<U[]>(`/admin/users?q=${encodeURIComponent(q)}${flagged ? '&flagged=true' : ''}`),
  });
  const toggleRole = async (u: U, role: Role) => {
    const roles = u.roles.includes(role) ? u.roles.filter((r) => r !== role) : [...u.roles, role];
    try {
      await patch(`/admin/users/${u.id}`, { roles: roles.length ? roles : ['player'] });
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (x) {
      toast('Erro', errorMessage(x), 'error');
    }
  };
  return (
    <AdminPage title="Usuários">
      <div className="flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="Buscar e-mail ou apelido"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={flagged}
            onChange={(e) => setFlagged(e.target.checked)}
            className="size-4 accent-[#ffcc00]"
          />{' '}
          Só sinalizados (possível multiconta)
        </label>
      </div>
      <div className="card mt-4 overflow-x-auto !p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="p-3">Piloto</th>
              <th>Papéis</th>
              <th>Status</th>
              <th className="pr-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="p-3">
                  <div className="font-bold">
                    {u.nickname} {u.isBot && '🤖'}
                  </div>
                  <div className="text-xs text-muted">
                    {u.email} · {u.signupIp ?? '—'}
                  </div>
                </td>
                <td>{u.roles.join(', ')}</td>
                <td className="text-xs">
                  {u.verified ? '✅ verificado' : '✉️ pendente'}{' '}
                  {u.flagged && <span className="text-hot">· sinalizado</span>}
                </td>
                <td className="space-x-1 pr-3 text-right">
                  <button
                    className="btn-ghost !px-2 !py-1 text-xs"
                    onClick={() => toggleRole(u, 'track_editor')}
                  >
                    {u.roles.includes('track_editor') ? '− editor' : '+ editor'}
                  </button>
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => toggleRole(u, 'admin')}>
                    {u.roles.includes('admin') ? '− admin' : '+ admin'}
                  </button>
                  <button
                    className="btn-ghost !px-2 !py-1 text-xs"
                    onClick={() =>
                      patch(`/admin/users/${u.id}`, { flagged: !u.flagged }).then(() =>
                        qc.invalidateQueries({ queryKey: ['admin-users'] }),
                      )
                    }
                  >
                    {u.flagged ? 'Liberar' : 'Sinalizar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminPage>
  );
}
