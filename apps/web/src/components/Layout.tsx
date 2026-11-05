import { ROOM, type ServerEvents } from '@tracado/shared';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Bell,
  Flag as FlagIcon,
  LogOut,
  Menu,
  Shield,
  Trophy,
  User,
  X,
  CalendarDays,
  Gauge,
  CarFront,
  PartyPopper,
  Settings,
  FlaskConical,
  Map as MapIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useNotifications } from '../lib/queries';
import { realtime, useConnection, useRoom } from '../lib/realtime';
import { isAdmin, isEditor, useSession } from '../lib/session';
import { AudioControls } from './AudioControls';
import { toast, Toaster } from './ui';

function ConnectionDot() {
  const [status, rtt] = useConnection().split('|');
  const color = status === 'open' ? 'bg-go' : status === 'connecting' ? 'bg-race' : 'bg-hot';
  const label =
    status === 'open'
      ? `Tempo real conectado${rtt ? ` (${rtt} ms)` : ''}`
      : status === 'connecting'
        ? 'Conectando…'
        : 'Reconectando…';
  return (
    <span className="hidden items-center gap-1.5 text-xs text-muted md:flex" title={label}>
      <span className={clsx('size-2 rounded-full', color, status !== 'open' && 'animate-pulse-soft')} />
      <span className="sr-only sm:not-sr-only">
        {status === 'open' ? (rtt ? `${rtt} ms` : 'online') : 'offline'}
      </span>
    </span>
  );
}

function NotificationBell() {
  const me = useSession((s) => s.me);
  const qc = useQueryClient();
  const { data } = useNotifications();
  useRoom(me ? ROOM.user(me.id) : null, (env) => {
    if (env.type === 'notification') {
      const n = env.payload as ServerEvents['notification'];
      toast(n.title, n.body, n.type === 'race_cancelled' || n.type === 'result_annulled' ? 'warn' : 'ok');
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    }
  });
  const unread = data?.filter((n) => !n.readAt).length ?? 0;
  return (
    <Link
      to="/notificacoes"
      className="relative rounded-xl p-2 hover:bg-night-3"
      aria-label={`Notificações${unread ? `, ${unread} não lidas` : ''}`}
    >
      <Bell size={20} />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-hot px-1 text-[11px] font-bold">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

const NAV = [
  { to: '/', label: 'Início', icon: Gauge, end: true },
  { to: '/calendario', label: 'Calendário', icon: CalendarDays },
  { to: '/rankings', label: 'Rankings', icon: Trophy },
  { to: '/corrida-maluca', label: 'Corrida Maluca', icon: PartyPopper },
];

const ADMIN_NAV = [
  { to: '/admin', label: 'Painel', icon: Gauge, end: true },
  { to: '/admin/configuracoes', label: 'Configurações', icon: Settings },
  { to: '/admin/corridas', label: 'Corridas', icon: CalendarDays },
  { to: '/admin/corridas-teste', label: 'Corridas teste', icon: FlaskConical },
  { to: '/admin/pistas', label: 'Pistas', icon: MapIcon },
  { to: '/admin/usuarios', label: 'Usuários', icon: User },
];

export function Layout({ children }: { children: ReactNode }) {
  const me = useSession((s) => s.me);
  const logout = useSession((s) => s.logout);
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', !!me?.profile.reducedMotion);
  }, [me?.profile.reducedMotion]);
  // A conta de administração não tem visão de jogador: só administração e configurações.
  const links = isAdmin(me)
    ? ADMIN_NAV
    : [
        NAV[0]!,
        ...(me ? [{ to: '/minhas-corridas', label: 'Minhas corridas', icon: CarFront }] : []),
        ...NAV.slice(1),
        ...(isEditor(me) ? [{ to: '/admin', label: 'Admin', icon: Shield }] : []),
      ];
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-xl focus:bg-race focus:px-3 focus:py-2 focus:text-night"
      >
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-night/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2" aria-label="Roda Presa, início">
            <span className="checkered size-7 rounded-md" aria-hidden />
            <span className="font-display text-xl tracking-wide">
              RODA <span className="text-race">PRESA</span>
            </span>
          </Link>
          <nav className="ml-4 hidden gap-1 md:flex" aria-label="Principal">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  clsx(
                    'rounded-xl px-3 py-1.5 text-sm font-bold',
                    isActive ? 'bg-night-3 text-race' : 'text-muted hover:text-ink',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ConnectionDot />
            <AudioControls />
            {me ? (
              <>
                <NotificationBell />
                <Link
                  to={isAdmin(me) ? '/conta' : `/pilotos/${me.id}`}
                  className="hidden items-center gap-2 rounded-xl px-2 py-1 hover:bg-night-3 sm:flex"
                >
                  <User size={18} />
                  <span className="max-w-32 truncate text-sm font-bold">{me.profile.nickname}</span>
                  {me.guest && <span className="text-[10px] font-bold uppercase text-muted">convidado</span>}
                  {isAdmin(me) && <span className="text-[10px] font-bold uppercase text-race">admin</span>}
                </Link>
                <button
                  className="hidden rounded-xl p-2 hover:bg-night-3 sm:block"
                  aria-label="Sair"
                  onClick={async () => {
                    await logout();
                    realtime.reconnect();
                    nav('/');
                  }}
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <>
                <Link to="/entrar" className="btn-ghost !py-1.5">
                  Entrar
                </Link>
                <Link to="/cadastro" className="btn-primary hidden !py-1.5 sm:inline-flex">
                  Criar conta
                </Link>
              </>
            )}
            <button
              className="rounded-xl p-2 hover:bg-night-3 md:hidden"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-line px-4 py-2 md:hidden" aria-label="Menu móvel">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className="flex items-center gap-3 rounded-xl px-3 py-3 font-bold hover:bg-night-3"
              >
                <l.icon size={18} /> {l.label}
              </NavLink>
            ))}
            {me && (
              <>
                <NavLink
                  to="/conta"
                  className="flex items-center gap-3 rounded-xl px-3 py-3 font-bold hover:bg-night-3"
                >
                  <User size={18} /> Minha conta
                </NavLink>
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 font-bold hover:bg-night-3"
                  onClick={async () => {
                    await logout();
                    realtime.reconnect();
                    nav('/');
                  }}
                >
                  <LogOut size={18} /> Sair
                </button>
              </>
            )}
          </nav>
        )}
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-line/60 py-6 text-center text-xs text-muted">
        <FlagIcon size={12} className="mr-1 inline" /> Roda Presa · arte do{' '}
        <a className="underline hover:text-ink" href="https://kenney.nl" target="_blank" rel="noreferrer">
          Racing Pack da Kenney
        </a>{' '}
        (CC0) ·{' '}
        <Link to="/privacidade" className="underline hover:text-ink">
          Privacidade
        </Link>{' '}
        ·{' '}
        <Link to="/termos" className="underline hover:text-ink">
          Termos
        </Link>
      </footer>
      <Toaster />
    </div>
  );
}
