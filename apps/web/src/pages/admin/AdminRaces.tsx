import {
  DEFAULT_PRACTICE_MINUTES,
  RACE_LAPS_MAX,
  RACE_LAPS_MIN,
  TRACE_WINDOW_MS,
  type RaceSummaryDto,
} from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { PhaseBadge, Tabs, toast } from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useCategories } from '../../lib/queries';
import { AdminPage } from './AdminNav';

interface TrackRow {
  id: string;
  trackName: string;
  version: number;
  status: string;
  kind: string;
}

function CreateRace({ batch }: { batch: boolean }) {
  const cats = useCategories();
  const qc = useQueryClient();
  const tracks = useQuery({
    queryKey: ['admin-tracks', 'special'],
    queryFn: () => get<TrackRow[]>('/admin/tracks?kind=special'),
  });
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const track = f.track
      ? { type: 'version', trackVersionId: f.track }
      : { type: 'procedural', ...(f.seed ? { seed: f.seed } : {}) };
    const common = {
      categoryId: f.categoryId,
      ranked: f.ranked === 'on',
      capacity: Number(f.capacity),
      waitlistMax: Number(f.waitlistMax),
      registrationLeadMinutes: Number(f.lead),
      practiceMinutes: Number(f.practice),
      setupLockSeconds: Number(f.setupLock),
      qualifyingSeconds: Number(f.quali),
      ...(f.laps ? { laps: Number(f.laps) } : {}),
      track,
    };
    setBusy(true);
    try {
      if (batch) {
        const r = await post<{ created: number }>('/admin/races/batch', {
          ...common,
          namePrefix: f.name,
          fromDate: f.fromDate,
          toDate: f.toDate,
          times: f
            .times!.split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
        });
        toast(`${r.created} corridas criadas`, undefined, 'ok');
      } else {
        await post('/admin/races', { ...common, name: f.name, startAt: new Date(f.startAt!).toISOString() });
        toast('Corrida criada', undefined, 'ok');
      }
      void qc.invalidateQueries({ queryKey: ['admin-races'] });
    } catch (x) {
      toast('Erro', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  const soon = new Date(Date.now() + 30 * 60_000);
  soon.setSeconds(0, 0);
  const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form onSubmit={submit} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="sm:col-span-2">
        <span className="label">{batch ? 'Prefixo do nome' : 'Nome'}</span>
        <input
          name="name"
          required
          minLength={2}
          className="input"
          defaultValue={batch ? 'Copa Diária' : 'Corrida Especial'}
        />
      </label>
      <label>
        <span className="label">Categoria</span>
        <select name="categoryId" className="input" required>
          {cats.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {batch ? (
        <>
          <label>
            <span className="label">De</span>
            <input type="date" name="fromDate" className="input" defaultValue={today} required />
          </label>
          <label>
            <span className="label">Até</span>
            <input type="date" name="toDate" className="input" defaultValue={today} required />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Horários (hh:mm, separados por vírgula)</span>
            <input name="times" className="input" defaultValue="12:00, 18:00, 21:00" required />
          </label>
        </>
      ) : (
        <label>
          <span className="label">Início do treino</span>
          <input type="datetime-local" name="startAt" className="input" defaultValue={local} required />
        </label>
      )}
      <label>
        <span className="label">Pista especial (opcional)</span>
        <select name="track" className="input">
          <option value="">Procedural</option>
          {tracks.data
            ?.filter((t) => t.status === 'published')
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.trackName} v{t.version}
              </option>
            ))}
        </select>
      </label>
      <label>
        <span className="label">Seed (procedural)</span>
        <input name="seed" className="input" placeholder="aleatória" />
      </label>
      <label>
        <span className="label">Voltas (padrão da categoria)</span>
        <input name="laps" type="number" min={RACE_LAPS_MIN} max={RACE_LAPS_MAX} className="input" />
      </label>
      <label>
        <span className="label">Vagas</span>
        <input name="capacity" type="number" min={2} max={22} defaultValue={22} className="input" />
      </label>
      <label>
        <span className="label">Fila máx.</span>
        <input name="waitlistMax" type="number" min={0} max={50} defaultValue={DEFAULT_PRACTICE_MINUTES} className="input" />
      </label>
      <label>
        <span className="label">Inscrições abrem (min antes)</span>
        <input name="lead" type="number" min={1} defaultValue={120} className="input" />
      </label>
      <label>
        <span className="label">Treino (min)</span>
        <input name="practice" type="number" min={0.5} step={0.5} defaultValue={10} className="input" />
      </label>
      <label>
        <span className="label">Parque fechado (s)</span>
        <input name="setupLock" type="number" min={5} defaultValue={30} className="input" />
      </label>
      <label>
        <span className="label">Classificação (s)</span>
        <input name="quali" type="number" min={10} defaultValue={60} className="input" />
      </label>
      <label className="flex items-center gap-2 self-end pb-3 text-sm font-bold">
        <input type="checkbox" name="ranked" defaultChecked className="size-4 accent-[#ffcc00]" /> Ranqueada
      </label>
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-3">
        A janela de traçado dura sempre {TRACE_WINDOW_MS / 60_000} minutos e começa ao fim do treino.
      </p>
      <button className="btn-primary" disabled={busy}>
        {batch ? 'Gerar lote' : 'Criar corrida'}
      </button>
    </form>
  );
}

export default function AdminRaces() {
  const qc = useQueryClient();
  const [form, setForm] = useState<'single' | 'batch'>('single');
  const races = useQuery({
    queryKey: ['admin-races'],
    queryFn: () =>
      get<RaceSummaryDto[]>(
        `/races?from=${Date.now() - 3 * 86_400_000}&to=${Date.now() + 14 * 86_400_000}&limit=300`,
      ),
    refetchInterval: 10_000,
  });
  async function action(r: RaceSummaryDto, kind: 'cancel' | 'annul' | 'reprocess') {
    try {
      if (kind === 'reprocess') {
        const res = await post<{
          match: boolean;
          outdated?: boolean;
          simVersion?: number;
          currentSimVersion?: number;
          storedHash: string;
          recomputedHash: string | null;
        }>(`/admin/races/${r.id}/reprocess`);
        if (res.outdated) {
          toast(
            'Corrida de outra versão da simulação',
            `Simulada na v${res.simVersion}; o servidor roda a v${res.currentSimVersion}, então não dá para reprocessar.`,
            'warn',
          );
          return;
        }
        toast(
          res.match ? 'Reprocessamento confere ✅' : 'DIVERGÊNCIA no reprocessamento ❌',
          `${res.storedHash} / ${res.recomputedHash}`,
          res.match ? 'ok' : 'error',
        );
        return;
      }
      const reason = window.prompt(kind === 'cancel' ? 'Motivo do cancelamento:' : 'Motivo da anulação:');
      if (!reason) return;
      await post(`/admin/races/${r.id}/${kind}`, { reason });
      toast(kind === 'cancel' ? 'Corrida cancelada' : 'Resultado anulado', undefined, 'ok');
      void qc.invalidateQueries({ queryKey: ['admin-races'] });
    } catch (x) {
      toast('Erro', errorMessage(x), 'error');
    }
  }
  return (
    <AdminPage title="Corridas">
      <Tabs
        value={form}
        onChange={setForm}
        items={[
          { value: 'single', label: 'Nova corrida' },
          { value: 'batch', label: 'Agendar em lote' },
        ]}
      />
      <div className="mt-3">
        <CreateRace batch={form === 'batch'} />
      </div>
      <div className="card mt-6 overflow-x-auto !p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="p-3">Corrida</th>
              <th>Treino</th>
              <th>Fase</th>
              <th>Vagas</th>
              <th className="pr-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {races.data?.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="p-3">
                  <Link to={`/corridas/${r.id}`} className="font-bold hover:text-race">
                    {r.name}
                  </Link>
                  <div className="text-xs text-muted">
                    {r.category.name} · {r.track.name} {r.ranked ? '· ranq.' : ''}{' '}
                    {r.annulled ? '· ANULADA' : ''}
                  </div>
                </td>
                <td>{fmtDateTime(r.timeline.practiceAt)}</td>
                <td>
                  <PhaseBadge phase={r.status} />
                </td>
                <td>
                  {r.capacity.confirmed}/{r.capacity.capacity}{' '}
                  {r.capacity.waitlisted ? `(+${r.capacity.waitlisted})` : ''}
                </td>
                <td className="space-x-1 pr-3 text-right">
                  {!['race', 'finished', 'archived', 'cancelled'].includes(r.status) && (
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => action(r, 'cancel')}>
                      Cancelar
                    </button>
                  )}
                  {['finished', 'archived'].includes(r.status) && !r.annulled && (
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => action(r, 'annul')}>
                      Anular
                    </button>
                  )}
                  {['qualifying', 'race', 'finished', 'archived'].includes(r.status) && (
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => action(r, 'reprocess')}>
                      Auditar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminPage>
  );
}
