import { randomDriverProfile, type DriverProfile, type MeDto } from '@tracado/shared';
import { Dices } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { DriverSliders, DriverStyleBadge } from '../components/DriverProfile';
import { GuestBackLink } from '../components/Guest';
import { CarIcon, Segmented, toast } from '../components/ui';
import { errorMessage, patch, post } from '../lib/api';
import { useSession } from '../lib/session';

/** Convidado (só apelido) vira conta normal (e-mail e senha), mantendo apelido, grupos e histórico. */
function GuestUpgrade() {
  const setMe = useSession((s) => s.setMe);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await post<MeDto>('/auth/guest/upgrade', {
        email: f.get('email'),
        password: f.get('password'),
      });
      setMe(r);
      toast('Conta criada! 🎉', 'Confira seu e-mail para confirmar o endereço.', 'ok');
    } catch (x) {
      toast('Não deu para criar a conta', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card space-y-3 border-violet">
      <div className="font-display text-lg">Crie sua conta</div>
      <p className="text-sm text-muted">
        Com e-mail e senha você entra de qualquer aparelho e cria seus próprios grupos da Corrida Maluca.
        Apelido, grupos e histórico continuam os mesmos.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          <span className="label">E-mail</span>
          <input name="email" type="email" className="input" autoComplete="email" required />
        </label>
        <label>
          <span className="label">Senha (mín. 8)</span>
          <input
            name="password"
            type="password"
            className="input"
            minLength={8}
            autoComplete="new-password"
            required
          />
        </label>
      </div>
      <button className="btn-primary" disabled={busy}>
        Criar minha conta
      </button>
    </form>
  );
}

/**
 * Perfil do piloto: o jeito de correr em todas as corridas (ataque, defesa e ritmo). Quem nunca escolheu corre com
 * um perfil sorteado; dá para sortear outro e ajustar. No box, cada corrida aceita um ajuste só para ela.
 */
function DriverCard({ me }: { me: MeDto }) {
  const setMe = useSession((s) => s.setMe);
  const [value, setValue] = useState<DriverProfile>(me.profile.driver);
  const [busy, setBusy] = useState(false);
  const saved = me.profile.driver;
  const dirty =
    !me.profile.driverChosen ||
    value.attack !== saved.attack ||
    value.defense !== saved.defense ||
    value.pace !== saved.pace;
  async function save() {
    setBusy(true);
    try {
      setMe(await patch<MeDto>('/me/profile', { driver: value }));
      toast('Perfil do piloto salvo', 'Vale a partir das próximas corridas.', 'ok');
    } catch (x) {
      toast('Erro', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card space-y-4" aria-labelledby="driver-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="driver-title" className="font-display text-lg">
          Perfil do piloto
        </h2>
        <DriverStyleBadge value={value} />
      </div>
      <p className="text-sm text-muted">
        Seu piloto corre do mesmo jeito em todas as corridas: quanto ataca, quanto defende a posição e em que
        ritmo anda. Nenhum extremo é melhor em tudo: quem ataca muito passa mais, mas bate mais; quem fecha a
        porta segura a posição, mas perde tempo; ritmo alto é mais rápido, mas gasta pneu e erra mais.
        {!me.profile.driverChosen &&
          ' Este perfil foi sorteado para você; ajuste e salve para ficar com ele.'}
      </p>
      <DriverSliders value={value} onChange={setValue} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={save}>
          Salvar perfil
        </button>
        <button
          type="button"
          className="btn-ghost inline-flex items-center gap-1.5"
          onClick={() => setValue(randomDriverProfile(Math.random))}
        >
          <Dices size={16} aria-hidden /> Sortear outro
        </button>
      </div>
      <p className="text-xs text-muted">
        No box de cada corrida dá para ajustar o perfil só para aquela prova.
      </p>
    </section>
  );
}

/**
 * Troca de senha (contas com e-mail e senha). As outras sessões são encerradas. Conta criada pelo Google ainda sem
 * senha cria a primeira sem informar a atual e passa a entrar também com e-mail ou apelido e senha.
 */
function ChangePassword({ hasPassword, onCreated }: { hasPassword: boolean; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get('newPassword') !== f.get('confirm')) {
      toast('As senhas novas não batem', undefined, 'warn');
      return;
    }
    setBusy(true);
    try {
      await post('/auth/change-password', {
        ...(hasPassword ? { currentPassword: f.get('currentPassword') } : {}),
        newPassword: f.get('newPassword'),
      });
      form.reset();
      if (hasPassword) toast('Senha alterada', 'As outras sessões foram encerradas.', 'ok');
      else {
        toast('Senha criada', 'Agora você também entra com e-mail ou apelido e senha.', 'ok');
        onCreated();
      }
    } catch (x) {
      toast('Não deu para trocar a senha', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="font-display text-lg">{hasPassword ? 'Trocar senha' : 'Criar senha'}</div>
      {!hasPassword && (
        <p className="text-sm text-muted">
          Sua conta entra pelo Google. Com uma senha, você também entra digitando o e-mail ou o apelido.
        </p>
      )}
      <div className={hasPassword ? 'grid gap-2 sm:grid-cols-3' : 'grid gap-2 sm:grid-cols-2'}>
        {hasPassword && (
          <label>
            <span className="label">Senha atual</span>
            <input
              name="currentPassword"
              type="password"
              className="input"
              autoComplete="current-password"
              required
            />
          </label>
        )}
        <label>
          <span className="label">Nova senha (mín. 8)</span>
          <input
            name="newPassword"
            type="password"
            className="input"
            minLength={8}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          <span className="label">Repita a nova</span>
          <input
            name="confirm"
            type="password"
            className="input"
            minLength={8}
            autoComplete="new-password"
            required
          />
        </label>
      </div>
      <button className="btn-ghost" disabled={busy}>
        {hasPassword ? 'Trocar senha' : 'Criar senha'}
      </button>
    </form>
  );
}

export default function Account() {
  const { me, setMe } = useSession();
  const [color, setColor] = useState(me!.profile.carColor);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  if (!me) return null;
  const incomplete = me.profile.region === 'A definir' || me.profile.city === 'A definir';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await patch<MeDto>('/me/profile', {
        nickname: f.get('nickname'),
        country: f.get('country'),
        region: f.get('region'),
        city: f.get('city'),
        carColor: color,
        reducedMotion: f.get('reducedMotion') === 'on',
        emailReminders: f.get('emailReminders') === 'on',
      });
      setMe(r);
      toast('Perfil atualizado', undefined, 'ok');
    } catch (x) {
      toast('Erro', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="font-display text-3xl">Minha conta</h1>
      {(params.get('bemvindo') || incomplete) && (
        <div className="card border-race">
          <div className="font-display text-lg">Bem-vindo ao Roda Presa! 🏁</div>
          <p className="mt-1 text-sm text-muted">
            Confira seu apelido e informe estado e cidade: eles definem seus rankings regional e local da
            temporada (ficam valendo a partir da sua primeira corrida ranqueada).
          </p>
        </div>
      )}
      {me.guest && <GuestBackLink upgradeHint={false} />}
      {me.guest && <GuestUpgrade />}
      {!me.emailVerified && !me.guest && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-race">
          <span className="text-sm">Seu e-mail ainda não foi confirmado.</span>
          <button
            className="btn-ghost !py-1.5"
            onClick={() =>
              post('/auth/resend-verification').then(() =>
                toast('Link reenviado', 'Confira seu e-mail.', 'ok'),
              )
            }
          >
            Reenviar link
          </button>
        </div>
      )}
      <form onSubmit={submit} className="card space-y-4">
        <label className="block">
          <span className="label">Apelido</span>
          <input name="nickname" className="input" defaultValue={me.profile.nickname} />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label>
            <span className="label">País</span>
            <input name="country" className="input" maxLength={2} defaultValue={me.profile.country} />
          </label>
          <label>
            <span className="label">Região</span>
            <input name="region" className="input" defaultValue={me.profile.region} />
          </label>
          <label>
            <span className="label">Cidade</span>
            <input name="city" className="input" defaultValue={me.profile.city} />
          </label>
        </div>
        <p className="text-xs text-muted">
          Mudanças de localização valem para os rankings a partir da próxima temporada.
        </p>
        <div>
          <span className="label">Cor preferida do carro</span>
          <Segmented
            label="Cor do carro"
            value={color}
            onChange={setColor}
            options={['red', 'blue', 'green', 'yellow', 'black'].map((c) => ({
              value: c,
              label: <CarIcon color={c} model={1} className="h-6" />,
            }))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="reducedMotion"
            defaultChecked={me.profile.reducedMotion}
            className="size-4 accent-[#ffcc00]"
          />{' '}
          Reduzir animações
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="emailReminders"
            defaultChecked={me.profile.emailReminders}
            className="size-4 accent-[#ffcc00]"
          />{' '}
          Receber lembretes por e-mail (fim do treino, largada)
        </label>
        <button className="btn-primary" disabled={busy}>
          Salvar
        </button>
      </form>
      <DriverCard me={me} />
      {!me.guest && !me.master && (
        <ChangePassword hasPassword={me.hasPassword} onCreated={() => setMe({ ...me, hasPassword: true })} />
      )}
    </div>
  );
}
