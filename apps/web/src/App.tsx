import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { isAdmin, isEditor, useSession } from './lib/session';
import { Home } from './pages/Home';
import { ForgotPassword, Login, Register, ResetPassword, VerifyEmail } from './pages/Auth';

const Calendar = lazy(() => import('./pages/Calendar'));
const RaceDetail = lazy(() => import('./pages/RaceDetail'));
const Box = lazy(() => import('./pages/Box'));
const Live = lazy(() => import('./pages/Live'));
const Results = lazy(() => import('./pages/Results'));
const Rankings = lazy(() => import('./pages/Rankings'));
const Profile = lazy(() => import('./pages/Profile'));
const Account = lazy(() => import('./pages/Account'));
const Notifications = lazy(() => import('./pages/Notifications'));
const MyRaces = lazy(() => import('./pages/MyRaces'));
const EventPage = lazy(() => import('./pages/EventPage'));
const CrazyHome = lazy(() => import('./pages/Crazy').then((m) => ({ default: m.CrazyHome })));
const CrazyGroup = lazy(() => import('./pages/Crazy').then((m) => ({ default: m.CrazyGroup })));
const CrazyInvite = lazy(() => import('./pages/Crazy').then((m) => ({ default: m.CrazyInvite })));
const CrazyResume = lazy(() => import('./pages/Crazy').then((m) => ({ default: m.CrazyResume })));
const Privacy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Terms })));
const About = lazy(() => import('./pages/About'));
const Determinism = lazy(() => import('./pages/Determinism'));
const AdminHome = lazy(() => import('./pages/admin/AdminHome'));
const AdminRaces = lazy(() => import('./pages/admin/AdminRaces'));
const AdminCategories = lazy(() => import('./pages/admin/AdminCategories'));
const AdminEvents = lazy(() => import('./pages/admin/AdminEvents'));
const AdminTracks = lazy(() => import('./pages/admin/AdminTracks'));
const TrackEditor = lazy(() => import('./pages/admin/TrackEditor'));
const AdminSeasons = lazy(() => import('./pages/admin/AdminSeasons'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));
const AdminTrackGen = lazy(() => import('./pages/admin/AdminTrackGen'));
const AdminTestRaces = lazy(() => import('./pages/admin/AdminTestRaces'));
const AdminBots = lazy(() => import('./pages/admin/AdminBots'));

function RequireAuth({ children, role }: { children: ReactNode; role?: 'admin' | 'editor' }) {
  const { me, ready } = useSession();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!me) return <Navigate to={`/entrar?voltar=${encodeURIComponent(loc.pathname)}`} replace />;
  if (role === 'admin' && !isAdmin(me)) return <Navigate to="/" replace />;
  if (role === 'editor' && !isEditor(me)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Telas de jogador: a conta de administração vai para o painel (ela só administra). */
function PlayerOnly({ children }: { children: ReactNode }) {
  const me = useSession((s) => s.me);
  if (isAdmin(me)) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="grid place-items-center gap-3 py-20 text-center">
      <div className="font-display text-6xl text-race">404</div>
      <p className="text-muted">Saímos da pista. Esta página não existe.</p>
      <a className="btn-primary" href="/">
        Voltar aos boxes
      </a>
    </div>
  );
}

export function App() {
  return (
    <Layout>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route
            path="/"
            element={
              <PlayerOnly>
                <Home />
              </PlayerOnly>
            }
          />
          <Route path="/entrar" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />
          <Route path="/esqueci-senha" element={<ForgotPassword />} />
          <Route path="/redefinir-senha" element={<ResetPassword />} />
          <Route path="/verificar-email" element={<VerifyEmail />} />
          <Route path="/calendario" element={<Calendar />} />
          <Route path="/corridas/:id" element={<RaceDetail />} />
          <Route
            path="/corridas/:id/box"
            element={
              <RequireAuth>
                <PlayerOnly>
                  <Box />
                </PlayerOnly>
              </RequireAuth>
            }
          />
          <Route path="/corridas/:id/ao-vivo" element={<Live mode="live" />} />
          <Route path="/corridas/:id/replay" element={<Live mode="replay" />} />
          <Route path="/corridas/:id/resultado" element={<Results />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/eventos/:id" element={<EventPage />} />
          <Route
            path="/corrida-maluca"
            element={
              <PlayerOnly>
                <CrazyHome />
              </PlayerOnly>
            }
          />
          <Route
            path="/corrida-maluca/convite/:code"
            element={
              <PlayerOnly>
                <CrazyInvite />
              </PlayerOnly>
            }
          />
          <Route path="/corrida-maluca/voltar/:key" element={<CrazyResume />} />
          <Route path="/corrida-maluca/:id" element={<CrazyGroup />} />
          <Route path="/privacidade" element={<Privacy />} />
          <Route path="/termos" element={<Terms />} />
          <Route path="/sobre" element={<About />} />
          <Route path="/pilotos/:id" element={<Profile />} />
          <Route
            path="/conta"
            element={
              <RequireAuth>
                <Account />
              </RequireAuth>
            }
          />
          <Route
            path="/minhas-corridas"
            element={
              <RequireAuth>
                <PlayerOnly>
                  <MyRaces />
                </PlayerOnly>
              </RequireAuth>
            }
          />
          <Route
            path="/notificacoes"
            element={
              <RequireAuth>
                <Notifications />
              </RequireAuth>
            }
          />
          <Route path="/dev/determinismo" element={<Determinism />} />
          <Route
            path="/admin"
            element={
              <RequireAuth role="editor">
                <AdminHome />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/corridas"
            element={
              <RequireAuth role="admin">
                <AdminRaces />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/categorias"
            element={
              <RequireAuth role="admin">
                <AdminCategories />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/eventos"
            element={
              <RequireAuth role="admin">
                <AdminEvents />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/pistas"
            element={
              <RequireAuth role="editor">
                <AdminTracks />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/pistas/editor"
            element={
              <RequireAuth role="editor">
                <TrackEditor />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/pistas/editor/:versionId"
            element={
              <RequireAuth role="editor">
                <TrackEditor />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/temporadas"
            element={
              <RequireAuth role="admin">
                <AdminSeasons />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/usuarios"
            element={
              <RequireAuth role="admin">
                <AdminUsers />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/configuracoes"
            element={
              <RequireAuth role="admin">
                <AdminSettings />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/corridas-teste"
            element={
              <RequireAuth role="admin">
                <AdminTestRaces />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/pilotos-simulados"
            element={
              <RequireAuth role="admin">
                <AdminBots />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/gerador"
            element={
              <RequireAuth role="admin">
                <AdminTrackGen />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/auditoria"
            element={
              <RequireAuth role="admin">
                <AdminAudit />
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
