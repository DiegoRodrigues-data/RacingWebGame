import { CAR_COLORS, type AuthResponse } from '@tracado/shared';
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, errorMessage, post } from '../lib/api';
import { realtime } from '../lib/realtime';
import { useSession } from '../lib/session';
import { CAR_COLOR_LABEL } from './CarPicker';
import { CarIcon, Empty, Segmented, Spinner, toast } from './ui';

export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex gap-2">
      <input
        className="input min-w-0 flex-1 font-mono text-xs"
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.target.select()}
      />
      <button
        type="button"
        className="btn-ghost !px-3"
        aria-label={`Copiar ${label}`}
        onClick={() =>
          navigator.clipboard
            .writeText(value)
            .then(() => toast('Copiado!', undefined, 'ok'))
            .catch(() => toast('Não deu para copiar', 'Selecione e copie o texto.', 'warn'))
        }
      >
        <Copy size={16} />
      </button>
    </div>
  );
}

/**
 * Jogar sem conta: apelido e cor do carro. Cria o convidado (com `inviteCode`, já entra no grupo da Corrida
 * Maluca), aplica a sessão e chama `onDone`.
 */
export function GuestJoinForm({
  inviteCode,
  submitLabel = 'Entrar na corrida 🏁',
  footer,
  onDone,
}: {
  inviteCode?: string;
  submitLabel?: string;
  footer?: ReactNode;
  onDone: (r: AuthResponse & { groupId: string | null }) => void | Promise<void>;
}) {
  const apply = useSession((s) => s.apply);
  const [nickname, setNickname] = useState('');
  const [color, setColor] = useState<string>('red');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSuggestion(null);
    try {
      const r = await post<AuthResponse & { groupId: string | null }>('/auth/guest', {
        ...(inviteCode ? { inviteCode } : {}),
        nickname: nickname.trim(),
        carColor: color,
      });
      apply(r);
      realtime.reconnect();
      await onDone(r);
    } catch (x) {
      if (x instanceof ApiError && x.code === 'NICKNAME_TAKEN')
        setSuggestion((x.details as { suggestion?: string } | undefined)?.suggestion ?? null);
      toast('Não deu para entrar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <label className="block">
        <span className="label">Seu apelido</span>
        <input
          className="input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Ex.: Zé_do_Kart"
          minLength={3}
          maxLength={20}
          pattern="[A-Za-z0-9_\-À-ÿ]+"
          title="Letras, números, _ ou - (sem espaço)"
          autoFocus
          required
        />
      </label>
      {suggestion && (
        <p className="text-sm text-muted">
          Esse já tem dono. Que tal{' '}
          <button
            type="button"
            className="font-bold text-race underline"
            onClick={() => setNickname(suggestion)}
          >
            {suggestion}
          </button>
          ?
        </p>
      )}
      <div>
        <span className="label">Cor do carro</span>
        <Segmented
          label="Cor do carro"
          value={color}
          onChange={setColor}
          options={CAR_COLORS.map((c) => ({
            value: c,
            label: (
              <span className="flex items-center gap-1.5" title={CAR_COLOR_LABEL[c]}>
                <CarIcon color={c} model={1} className="h-6" />
              </span>
            ),
          }))}
        />
      </div>
      <button className="btn-primary w-full" disabled={busy || nickname.trim().length < 3}>
        {busy ? 'Entrando…' : submitLabel}
      </button>
      {footer && <p className="text-center text-xs text-muted">{footer}</p>}
    </form>
  );
}

/** Link pessoal de volta do convidado (o acesso fica no navegador; o link leva para outro aparelho). */
export function GuestBackLink({ upgradeHint = true }: { upgradeHint?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card space-y-2">
      <h2 className="font-display text-lg">Você está como convidado</h2>
      <p className="text-sm text-muted">
        Seu acesso fica neste navegador. Para entrar de outro celular ou computador, guarde seu link pessoal
        de volta (não mande para ninguém: quem tiver o link entra como você).
      </p>
      {url ? (
        <CopyField value={url} label="link de volta" />
      ) : (
        <button
          className="btn-ghost !py-1.5"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setUrl((await post<{ url: string }>('/auth/guest/link')).url);
            } catch (x) {
              toast('Erro', errorMessage(x), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          🔑 Gerar meu link de volta
        </button>
      )}
      {upgradeHint && (
        <p className="text-xs text-muted">
          Ou{' '}
          <Link to="/conta" className="font-bold text-race underline">
            crie sua conta
          </Link>{' '}
          com e-mail e senha (mantém apelido e histórico).
        </p>
      )}
    </section>
  );
}

/** /voltar/:key (e o antigo /corrida-maluca/voltar/:key): link pessoal do convidado em outro aparelho. */
export function GuestResume({ next = '/' }: { next?: string }) {
  const { key = '' } = useParams();
  const nav = useNavigate();
  const apply = useSession((s) => s.apply);
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    post<AuthResponse>('/auth/guest/resume', { key })
      .then((r) => {
        apply(r);
        realtime.reconnect();
        toast(`Bem-vindo de volta, ${r.me.profile.nickname}!`, undefined, 'ok');
        nav(next, { replace: true });
      })
      .catch((x) => setErr(errorMessage(x)));
  }, [key, apply, nav, next]);
  if (!err) return <Spinner label="Entrando" />;
  return (
    <Empty title="Não deu para entrar" icon="🔑">
      <p className="text-sm text-muted">{err}</p>
    </Empty>
  );
}
