import type { MeDto } from '@tracado/shared';
import { useState, type FormEvent } from 'react';
import { CarIcon, Segmented, toast } from '../components/ui';
import { errorMessage, patch, post } from '../lib/api';
import { useSession } from '../lib/session';

export default function Account() {
  const { me, setMe } = useSession();
  const [color, setColor] = useState(me!.profile.carColor);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
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
      {!me.emailVerified && (
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
          Receber lembretes por e-mail (janela de traçado, largada)
        </label>
        <button className="btn-primary" disabled={busy}>
          Salvar
        </button>
      </form>
    </div>
  );
}
