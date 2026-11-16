import {
  LEVEL_LABELS,
  SAFETY_PHRASE,
  type AccessDto,
  type AdminUserDto,
  type AdminUsersDto,
  type Role,
  type SignupMode,
  type UserStatus,
} from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Segmented, toast } from '../../components/ui';
import { del, errorMessage, get, patch, post, put } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { AdminPage } from './AdminNav';

/**
 * Usuários (modelo do Gerador_Prompt): regra de novos cadastros, aprovação, bloqueio, cadastro, edição e exclusão.
 * O Master (ADMIN_EMAIL) e os administradores de ADMIN_EMAILS vêm do ambiente e não são bloqueados nem excluídos aqui.
 */

const SIGNUP_MODES: Record<SignupMode, { label: string; icon: string; tone: string; text: string }> = {
  open: {
    label: 'Liberados',
    icon: '🟢',
    tone: 'bg-go/15 text-go',
    text: 'Qualquer pessoa cria a conta (e-mail, Google ou convidado) e já pode correr.',
  },
  approval: {
    label: 'Com aprovação',
    icon: '⏳',
    tone: 'bg-race/15 text-race',
    text: 'Contas novas (e-mail ou Google) ficam aguardando até você aprovar aqui. Convidados não entram.',
  },
  closed: {
    label: 'Fechados',
    icon: '🔒',
    tone: 'bg-hot/15 text-hot',
    text: 'Só entra quem já tem conta. Contas novas só são criadas por você, nesta tela.',
  },
};

const STATUS_BADGE: Partial<Record<UserStatus, ReactNode>> = {
  pending: <span className="chip bg-race/15 text-race">⏳ aguardando aprovação</span>,
  blocked: <span className="chip bg-hot/15 text-hot">⛔ bloqueado</span>,
};

const usersKey = ['admin-users'];

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Portal no body: dentro de um card (backdrop-filter) o `fixed` ficaria preso e por baixo da tabela.
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-xl">{title}</h2>
          <button type="button" className="btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" {...props} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function AccessPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-access'], queryFn: () => get<AccessDto>('/admin/access') });
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<SignupMode>('open');
  const [domains, setDomains] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const m = SIGNUP_MODES[data.signupMode];
  const open = () => {
    setMode(data.signupMode);
    setDomains(data.signupDomains.join(', '));
    setEditing(true);
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const signupDomains = domains.split(/[\s,;]+/).filter(Boolean);
      qc.setQueryData(
        ['admin-access'],
        await put<AccessDto>('/admin/access', { signupMode: mode, signupDomains }),
      );
      void qc.invalidateQueries({ queryKey: ['auth-providers'] });
      toast('Regra de cadastro atualizada', undefined, 'ok');
      setEditing(false);
    } catch (x) {
      toast('Não deu para salvar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card flex flex-col gap-3 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-bold">
          Novos cadastros
          <span className={clsx('chip', m.tone)}>
            {m.icon} {m.label}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">{m.text}</p>
        {data.signupDomains.length > 0 && data.signupMode !== 'closed' && (
          <p className="mt-1 text-sm text-muted">
            Somente e-mails de: <strong className="text-ink">{data.signupDomains.join(', ')}</strong>{' '}
            (convidados ficam de fora).
          </p>
        )}
        {!data.googleLogin && (
          <p className="mt-1 text-xs text-muted">O login com Google não está configurado neste servidor.</p>
        )}
      </div>
      <button className="btn-ghost shrink-0" onClick={open}>
        Alterar regra
      </button>
      {editing && (
        <Dialog title="Novos cadastros" onClose={() => setEditing(false)}>
          <form onSubmit={save} className="space-y-4">
            <p className="text-sm text-muted">
              Vale para quem cria conta por e-mail, pelo Google ou como convidado. Quem já tem conta continua
              entrando, e os e-mails de ADMIN_EMAILS entram pelo Google mesmo com os cadastros fechados.
            </p>
            <div className="space-y-2" role="radiogroup" aria-label="Regra de cadastro">
              {(Object.keys(SIGNUP_MODES) as SignupMode[]).map((k) => (
                <label
                  key={k}
                  className={clsx(
                    'flex cursor-pointer gap-3 rounded-xl border p-3',
                    mode === k ? 'border-race bg-race/10' : 'border-line',
                  )}
                >
                  <input
                    type="radio"
                    name="signupMode"
                    className="mt-1 accent-[#ffcc00]"
                    checked={mode === k}
                    onChange={() => setMode(k)}
                  />
                  <span>
                    <span className="font-bold">
                      {SIGNUP_MODES[k].icon} {SIGNUP_MODES[k].label}
                    </span>
                    <span className="block text-sm text-muted">{SIGNUP_MODES[k].text}</span>
                  </span>
                </label>
              ))}
            </div>
            <Field
              label="Domínios de e-mail permitidos (opcional)"
              hint="Separe por vírgula. Em branco, qualquer domínio. Com a lista, convidados não entram."
              placeholder="Ex.: minhaempresa.com.br"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
            <button className="btn-primary w-full" disabled={busy}>
              Salvar regra
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}

/** Cadastro (sem `user`) ou edição. Senha em branco mantém a atual. */
function UserDialog({ user, onClose }: { user?: AdminUserDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const emailLocked = !!user && (user.google || user.guest || user.adminSource === 'email');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setErr(null);
    try {
      if (user) {
        const body: Record<string, string> = {};
        if (f.nickname && f.nickname !== user.nickname) body.nickname = f.nickname;
        if (!emailLocked && f.email && f.email !== user.email) body.email = f.email;
        if (f.password) body.password = f.password;
        await patch(`/admin/users/${user.id}`, body);
        toast(
          'Usuário atualizado',
          f.password ? 'As sessões dessa pessoa foram encerradas.' : undefined,
          'ok',
        );
      } else {
        await post('/admin/users', {
          nickname: f.nickname,
          email: f.email,
          password: f.password,
          ...(f.region ? { region: f.region } : {}),
          ...(f.city ? { city: f.city } : {}),
        });
        toast('Usuário cadastrado', 'A conta já entra ativa.', 'ok');
      }
      void qc.invalidateQueries({ queryKey: usersKey });
      onClose();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={user ? 'Editar usuário' : 'Novo usuário'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field
          label="Apelido de piloto"
          name="nickname"
          defaultValue={user?.nickname}
          maxLength={20}
          required
        />
        <Field
          label="E-mail"
          name="email"
          type="email"
          defaultValue={user?.email}
          required={!user}
          readOnly={emailLocked}
          autoCapitalize="none"
          hint={
            user?.google
              ? 'Vem da conta Google e não pode ser alterado aqui.'
              : user?.adminSource === 'email'
                ? 'Definido em ADMIN_EMAILS: mude pela variável.'
                : user?.guest
                  ? 'Convidado não tem e-mail: ele mesmo cria a conta em Minha conta.'
                  : undefined
          }
        />
        {!user?.guest && (
          <Field
            label={user ? 'Nova senha (opcional)' : 'Senha'}
            name="password"
            type="password"
            minLength={8}
            required={!user}
            autoComplete="new-password"
            hint={
              user
                ? user.hasPassword
                  ? 'Em branco, mantém a atual. Trocar desconecta a pessoa.'
                  : 'A conta entra pelo Google; com uma senha, entra também por e-mail ou apelido.'
                : 'Mínimo de 8 caracteres. A pessoa entra pelo e-mail ou pelo apelido.'
            }
          />
        )}
        {!user && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Estado/Região (opcional)" name="region" placeholder="SP" />
            <Field label="Cidade (opcional)" name="city" placeholder="Campinas" />
          </div>
        )}
        {err && (
          <p role="alert" className="rounded-xl bg-hot/15 p-3 text-sm text-hot">
            {err}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {user ? 'Salvar' : 'Cadastrar'}
        </button>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ user, onClose }: { user: AdminUserDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await del<{ mode: 'deleted' | 'anonymized' }>(`/admin/users/${user.id}`, {
        confirmation: phrase,
      });
      toast(
        r.mode === 'deleted' ? 'Usuário excluído' : 'Usuário anonimizado',
        r.mode === 'anonymized' ? 'O histórico de corridas ficou, sem nome, e-mail nem login.' : undefined,
        'ok',
      );
      void qc.invalidateQueries({ queryKey: usersKey });
      onClose();
    } catch (x) {
      toast('Não deu para excluir', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Excluir usuário" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm">
          Excluir <strong>{user.nickname}</strong>
          {user.email && ` (${user.email})`}? Quem nunca correu é apagado. Quem já correu tem o histórico
          mantido para não mudar corridas passadas: a conta perde e-mail, senha, login com Google e cidade,
          ganha o apelido “Removido…” e não entra mais. Não dá para desfazer.
        </p>
        <Field
          label={`Para confirmar, digite ${SAFETY_PHRASE}`}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
        />
        <button
          className="btn-danger w-full"
          disabled={busy || phrase.trim().toUpperCase() !== SAFETY_PHRASE}
        >
          Excluir usuário
        </button>
      </form>
    </Dialog>
  );
}

type StatusFilter = 'all' | UserStatus;

export default function AdminUsers() {
  const qc = useQueryClient();
  const myId = useSession((s) => s.me?.id);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [flagged, setFlagged] = useState(false);
  const [bots, setBots] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: 'new' } | { kind: 'edit'; user: AdminUserDto } | { kind: 'delete'; user: AdminUserDto } | null
  >(null);
  const { data } = useQuery({
    queryKey: [...usersKey, q, status, flagged, bots],
    queryFn: () =>
      get<AdminUsersDto>(
        `/admin/users?q=${encodeURIComponent(q)}${status !== 'all' ? `&status=${status}` : ''}${
          flagged ? '&flagged=true' : ''
        }${bots ? '&bots=true' : ''}`,
      ),
  });

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, undefined, 'ok');
      void qc.invalidateQueries({ queryKey: usersKey });
    } catch (x) {
      toast('Não deu certo', errorMessage(x), 'error');
    }
  };
  const setUserStatus = (u: AdminUserDto, s: 'active' | 'blocked') =>
    run(
      () => put(`/admin/users/${u.id}/status`, { status: s }),
      s === 'blocked'
        ? `${u.nickname} bloqueado`
        : u.status === 'pending'
          ? `${u.nickname} aprovado`
          : 'Acesso liberado',
    );
  const toggleRole = (u: AdminUserDto, role: Role) => {
    const roles = u.roles.includes(role) ? u.roles.filter((r) => r !== role) : [...u.roles, role];
    return run(
      () => patch(`/admin/users/${u.id}`, { roles: roles.length ? roles : ['player'] }),
      'Papéis atualizados',
    );
  };
  const small = 'btn-ghost !px-2 !py-1 text-xs';

  return (
    <AdminPage
      title="Usuários"
      actions={
        <button className="btn-primary" onClick={() => setDialog({ kind: 'new' })}>
          + Novo usuário
        </button>
      }
    >
      <AccessPanel />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xs"
          placeholder="Buscar e-mail ou apelido"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar"
        />
        <Segmented<StatusFilter>
          label="Situação"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'pending', label: `Aguardando${data?.pending ? ` (${data.pending})` : ''}` },
            { value: 'active', label: 'Ativos' },
            { value: 'blocked', label: 'Bloqueados' },
          ]}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={flagged}
            onChange={(e) => setFlagged(e.target.checked)}
            className="size-4 accent-[#ffcc00]"
          />
          Só sinalizados (possível multiconta)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={bots}
            onChange={(e) => setBots(e.target.checked)}
            className="size-4 accent-[#ffcc00]"
          />
          Mostrar pilotos simulados
        </label>
      </div>
      {!!data?.pending && status === 'all' && (
        <p className="mt-3 rounded-xl bg-race/15 p-3 text-sm text-race">
          {data.pending === 1 ? '1 cadastro aguarda' : `${data.pending} cadastros aguardam`} a sua aprovação.
        </p>
      )}
      <div className="card mt-4 overflow-x-auto !p-0">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="p-3">Piloto</th>
              <th>Papéis</th>
              <th>Corridas</th>
              <th>Cadastro · último acesso</th>
              <th className="pr-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => {
              const fromEnv = u.adminSource === 'master' || u.adminSource === 'email';
              const managed = u.adminSource !== 'master' && !u.isBot;
              return (
                <tr
                  key={u.id}
                  className={clsx(
                    'border-t border-line align-top',
                    u.status === 'pending' && 'bg-race/5',
                    u.status === 'blocked' && 'opacity-70',
                  )}
                >
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-1.5 font-bold">
                      {u.adminSource && <span title="Administrador">👑</span>}
                      {u.nickname} {u.isBot && '🤖'}
                      {u.adminSource === 'master' && (
                        <span className="chip bg-race/15 text-race">Master</span>
                      )}
                      {u.adminSource === 'email' && (
                        <span className="chip bg-race/15 text-race">admin via ambiente</span>
                      )}
                      {u.guest && <span className="chip">convidado</span>}
                      {STATUS_BADGE[u.status]}
                      {u.flagged && <span className="chip bg-hot/15 text-hot">sinalizado</span>}
                    </div>
                    <div className="text-xs text-muted">
                      {u.email ? (
                        <>
                          {u.google ? 'G · ' : ''}
                          {u.email} {u.verified ? '✅' : '✉️'}
                        </>
                      ) : (
                        'sem e-mail'
                      )}{' '}
                      · IP {u.signupIp ?? '—'}
                    </div>
                  </td>
                  <td className="text-xs">{u.roles.join(', ')}</td>
                  <td className="text-xs">
                    {u.careerRaces} · {LEVEL_LABELS[u.level]}
                  </td>
                  <td className="text-xs text-muted">
                    {fmtDateTime(u.createdAt)}
                    <br />
                    {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'nunca entrou'}
                  </td>
                  <td className="pr-3 text-right">
                    {!managed ? (
                      <span className="text-xs text-muted">
                        {u.isBot ? 'em Pilotos simulados' : 'via ambiente (ADMIN_EMAIL)'}
                      </span>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-1">
                        {u.status === 'pending' && (
                          <button
                            className={clsx(small, '!text-go')}
                            onClick={() => setUserStatus(u, 'active')}
                          >
                            ✓ Aprovar
                          </button>
                        )}
                        {u.status !== 'blocked' && !fromEnv && u.id !== myId && (
                          <button className={small} onClick={() => setUserStatus(u, 'blocked')}>
                            Bloquear
                          </button>
                        )}
                        {u.status === 'blocked' && (
                          <button className={small} onClick={() => setUserStatus(u, 'active')}>
                            Desbloquear
                          </button>
                        )}
                        <button className={small} onClick={() => setDialog({ kind: 'edit', user: u })}>
                          Editar
                        </button>
                        <button className={small} onClick={() => toggleRole(u, 'track_editor')}>
                          {u.roles.includes('track_editor') ? '− editor' : '+ editor'}
                        </button>
                        {!fromEnv && (
                          <button className={small} onClick={() => toggleRole(u, 'admin')}>
                            {u.roles.includes('admin') ? '− admin' : '+ admin'}
                          </button>
                        )}
                        <button
                          className={small}
                          onClick={() =>
                            run(
                              () => patch(`/admin/users/${u.id}`, { flagged: !u.flagged }),
                              u.flagged ? 'Sinalização retirada' : 'Usuário sinalizado',
                            )
                          }
                        >
                          {u.flagged ? 'Liberar' : 'Sinalizar'}
                        </button>
                        {!fromEnv && u.id !== myId && (
                          <button
                            className={clsx(small, '!text-hot')}
                            onClick={() => setDialog({ kind: 'delete', user: u })}
                          >
                            Excluir
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && !data.users.length && (
          <p className="p-6 text-center text-sm text-muted">Nenhum usuário encontrado.</p>
        )}
      </div>
      {dialog?.kind === 'new' && <UserDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <UserDialog user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && <DeleteDialog user={dialog.user} onClose={() => setDialog(null)} />}
    </AdminPage>
  );
}
