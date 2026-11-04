import { registerSchema } from '@tracado/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from '../components/ui';
import { ApiError, errorMessage, post } from '../lib/api';
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
