import clsx from 'clsx';
import { NavLink } from 'react-router';
import { isAdmin, useSession } from '../../lib/session';

export function AdminNav() {
  const me = useSession((s) => s.me);
  const links = isAdmin(me)
    ? [
        ['/admin', 'Painel'],
        ['/admin/corridas', 'Corridas'],
        ['/admin/categorias', 'Categorias'],
        ['/admin/eventos', 'Eventos'],
        ['/admin/pistas', 'Pistas'],
        ['/admin/temporadas', 'Temporadas'],
        ['/admin/usuarios', 'Usuários'],
        ['/admin/auditoria', 'Auditoria'],
      ]
    : [
        ['/admin', 'Painel'],
        ['/admin/pistas', 'Pistas'],
      ];
  return (
    <nav className="mb-5 flex flex-wrap gap-1" aria-label="Administração">
      {links.map(([to, label]) => (
        <NavLink
          key={to}
          to={to!}
          end
          className={({ isActive }) =>
            clsx(
              'rounded-xl px-3 py-1.5 text-sm font-bold',
              isActive ? 'bg-race text-night' : 'bg-night-2 text-muted hover:text-ink',
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AdminPage({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-3xl">{title}</h1>
        {actions}
      </div>
      <AdminNav />
      {children}
    </div>
  );
}
