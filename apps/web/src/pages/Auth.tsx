import { registerSchema } from '@tracado/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { GuestJoinForm } from '../components/Guest';
import { toast } from '../components/ui';
import { useQuery } from '@tanstack/react-query';
import { API_BASE, ApiError, errorMessage, get, post } from '../lib/api';
import { realtime } from '../lib/realtime';
import { useSession } from '../lib/session';
import type { AuthResponse } from '@tracado/shared';

function AuthCard({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-6">
      <div className="card p-6">
        <div className="checkered mb-4 h-2 rounded-full" aria-hidden />
        <h1 className="font-display text-2xl">{title}</h1>
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="mt-4 text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}

function Field({
  label,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" aria-invalid={!!error} {...props} />
      {error && <span className="mt-1 block text-xs text-hot">{error}</span>}
    </label>
  );
}

/** Botão do Google (só aparece se o servidor tiver o login com Google configurado). */
function GoogleButton({ next }: { next: string }) {
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => get<{ google: boolean }>('/auth/providers'),
    staleTime: 5 * 60_000,
  });
  if (!providers.data?.google) return null;
  return (
    <>
      <a
        href={`${API_BASE}/auth/google/start?next=${encodeURIComponent(next)}`}
        className="btn w-full border border-line bg-white !text-[#1f1f1f] hover:bg-white/90"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
          <path
            fill="#FFC107"
            d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
          />
          <path
            fill="#FF3D00"
            d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
          />
          <path
            fill="#4CAF50"
            d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
          />
          <path
            fill="#1976D2"
            d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
          />
        </svg>
        Continuar com Google
      </a>
      <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" /> ou com e-mail <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}

export function Login() {
  const apply = useSession((s) => s.apply);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      const r = await post<AuthResponse>('/auth/login', {
        email: f.get('email'),
        password: f.get('password'),
      });
      apply(r);
      realtime.reconnect();
      toast(`Bem-vindo de volta, ${r.me.profile.nickname}!`, undefined, 'ok');
      nav(params.get('voltar') ?? '/');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard
      title="Entrar"
      footer={
        <>
          Novo por aqui?{' '}
          <Link className="font-bold text-race" to="/cadastro">
            Crie sua conta
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {params.get('erro') === 'google' && (
          <p role="alert" className="rounded-xl bg-hot/15 p-3 text-sm text-hot">
            Não foi possível entrar com o Google. Tente de novo ou use e-mail e senha.
          </p>
        )}
        <GoogleButton next={params.get('voltar') ?? '/'} />
        <Field label="E-mail" name="email" type="email" autoComplete="email" required />
        <Field label="Senha" name="password" type="password" autoComplete="current-password" required />
        {err && (
          <p role="alert" className="rounded-xl bg-hot/15 p-3 text-sm text-hot">
            {err}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <Link to="/esqueci-senha" className="block text-center text-sm text-muted hover:text-ink">
          Esqueci minha senha
        </Link>
      </form>
      <div className="mt-5 border-t border-line pt-4 text-center text-sm">
        Só quer correr?{' '}
        <Link
          className="font-bold text-race"
          to={`/jogar${params.get('voltar') ? `?voltar=${encodeURIComponent(params.get('voltar')!)}` : ''}`}
        >
          Jogue só com um apelido
        </Link>
      </div>
    </AuthCard>
  );
}

export function Register() {
  const apply = useSession((s) => s.apply);
  const nav = useNavigate();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const v = registerSchema.safeParse(data);
    if (!v.success) {
      setErrors(Object.fromEntries(v.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await post<AuthResponse>('/auth/register', v.data);
      apply(r);
      realtime.reconnect();
      toast('Conta criada! 🏁', 'Confira seu e-mail para confirmar o cadastro.', 'ok');
      nav('/calendario');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setErrors({
        [code === 'EMAIL_TAKEN' ? 'email' : code === 'NICKNAME_TAKEN' ? 'nickname' : 'form']: errorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard
      title="Criar conta"
      footer={
        <>
          Já tem conta?{' '}
          <Link className="font-bold text-race" to="/entrar">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <GoogleButton next="/calendario" />
        <Field
          label="Apelido de piloto"
          name="nickname"
          autoComplete="nickname"
          required
          maxLength={20}
          error={errors.nickname}
        />
        <Field label="E-mail" name="email" type="email" autoComplete="email" required error={errors.email} />
        <Field
          label="Senha (mín. 8)"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          error={errors.password}
        />
        <div className="grid grid-cols-3 gap-2">
          <Field
            label="País"
            name="country"
            defaultValue="BR"
            maxLength={2}
            required
            error={errors.country}
          />
          <Field label="Estado/Região" name="region" placeholder="SP" required error={errors.region} />
          <Field label="Cidade" name="city" placeholder="Campinas" required error={errors.city} />
        </div>
        <p className="text-xs text-muted">
          Sua cidade, região e país definem seus rankings local, regional e nacional. Mudanças valem a partir
          da próxima temporada.
        </p>
        {errors.form && (
          <p role="alert" className="rounded-xl bg-hot/15 p-3 text-sm text-hot">
            {errors.form}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Criando…' : 'Criar conta'}
        </button>
      </form>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  return (
    <AuthCard title="Recuperar senha">
      {sent ? (
        <p className="text-muted">
          Se o e-mail existir, enviaremos um link de redefinição. Confira sua caixa de entrada.
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await post('/auth/forgot-password', { email: new FormData(e.currentTarget).get('email') }).catch(
              () => undefined,
            );
            setSent(true);
          }}
        >
          <Field label="E-mail" name="email" type="email" required />
          <button className="btn-primary w-full">Enviar link</button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  return (
    <AuthCard title="Nova senha">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/auth/reset-password', {
              token: params.get('token'),
              password: new FormData(e.currentTarget).get('password'),
            });
            toast('Senha redefinida', 'Entre com a nova senha.', 'ok');
            nav('/entrar');
          } catch (x) {
            setErr(errorMessage(x));
          }
        }}
      >
        <Field label="Nova senha" name="password" type="password" minLength={8} required />
        {err && <p className="text-sm text-hot">{err}</p>}
        <button className="btn-primary w-full">Salvar</button>
      </form>
    </AuthCard>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle');
  if (state === 'idle') {
    setState('ok');
    void post('/auth/verify-email', { token: params.get('token') }).catch(() => setState('err'));
  }
  return (
    <AuthCard title="Confirmação de e-mail">
      <p className={state === 'err' ? 'text-hot' : 'text-go'}>
        {state === 'err' ? 'Link inválido ou expirado.' : 'E-mail confirmado. Boa corrida!'}
      </p>
      <Link to="/" className="btn-primary mt-4 w-full">
        Ir para o início
      </Link>
    </AuthCard>
  );
}

/**
 * /jogar — entra só com o apelido (convidado, sem e-mail nem senha). Com `?corrida=<id>`, já inscreve nessa
 * corrida e leva ao box; senão volta para `?voltar` ou para o calendário.
 */
export function PlayAsGuest() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const me = useSession((s) => s.me);
  const raceId = params.get('corrida');
  const next = params.get('voltar') ?? '/calendario';
  const loginLink = `/entrar?voltar=${encodeURIComponent(raceId ? `/corridas/${raceId}` : next)}`;
  if (me) return <Navigate to={raceId ? `/corridas/${raceId}` : next} replace />;

  async function done() {
    if (!raceId) return nav(next);
    try {
      const r = await post<{ status: string; waitlistPosition: number | null }>(`/races/${raceId}/entries`);
      if (r.status === 'confirmed') {
        toast('Você está no grid! 🏎️', 'Configure o carro e prepare seu traçado.', 'ok');
        return nav(`/corridas/${raceId}/box`);
      }
      toast('Corrida lotada', `Você é o ${r.waitlistPosition}º da fila de espera.`, 'warn');
    } catch (x) {
      toast('Não foi possível se inscrever', errorMessage(x), 'error');
    }
    nav(`/corridas/${raceId}`);
  }

  return (
    <div className="mx-auto max-w-md space-y-4 py-6">
      <div className="card p-6">
        <div className="checkered mb-4 h-2 rounded-full" aria-hidden />
        <h1 className="font-display text-2xl">Jogar sem cadastro</h1>
        <p className="mt-2 text-sm text-muted">
          Escolha um apelido e a cor do carro e já pode correr. Sem e-mail nem senha: o acesso fica neste
          navegador, e dá para criar a conta depois mantendo apelido e histórico.
        </p>
      </div>
      <GuestJoinForm
        submitLabel={raceId ? 'Entrar no grid 🏁' : 'Começar a jogar 🏁'}
        onDone={done}
        footer={
          <>
            Já tem conta?{' '}
            <Link to={loginLink} className="font-bold text-race underline">
              Entre com ela
            </Link>
            .
          </>
        }
      />
    </div>
  );
}
