import {
  BIOME_LABEL,
  PHASE_LABELS,
  type TrackDayDto,
  type TrackDaySlotDto,
  type TrackDayTrackDto,
} from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Minimap } from '../../components/Minimap';
import { Spinner, toast } from '../../components/ui';
import { errorMessage, get, put } from '../../lib/api';
import { fmtKm, PHASE_COLOR, TERRAIN_LABEL } from '../../lib/format';
import { useGeometry } from '../../lib/queries';
import { useServerNow } from '../../lib/realtime';
import { AdminPage } from './AdminNav';
import { Toggle } from './AdminSettings';

const TZ = 'America/Sao_Paulo';
const BRT_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const brtDay = (t: number) => new Date(t - BRT_OFFSET_MS).toISOString().slice(0, 10);
const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const dayLabel = (day: string, today: string) => {
  const diff = Math.round((Date.parse(day) - Date.parse(today)) / DAY_MS);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
};

const SOURCE: Record<string, { label: string; cls: string; hint: string }> = {
  auto: {
    label: 'Gerada',
    cls: 'border-line text-muted',
    hint: 'Gerada automaticamente pelas configurações de pista',
  },
  pool: { label: 'Rodízio', cls: 'border-race/60 text-race', hint: 'Especial sorteada do rodízio' },
  admin: { label: 'Escolhida', cls: 'border-go/60 text-go', hint: 'Escolhida pelo admin' },
  plan: {
    label: 'Reservada',
    cls: 'border-go/60 text-go',
    hint: 'Reservada para quando a corrida for criada',
  },
  open: {
    label: 'Automática',
    cls: 'border-line text-muted',
    hint: 'Será gerada quando a corrida for criada',
  },
};

/** Miniatura da pista (o mesmo desenho do mapa da corrida ao vivo). */
function TrackThumb({ versionId, className }: { versionId: string | null; className?: string }) {
  const g = useGeometry(versionId ?? undefined);
  return (
    <div className={clsx('grid size-16 shrink-0 place-items-center rounded-xl bg-night-2 p-1', className)}>
      {g.data ? <Minimap g={g.data} cars={[]} /> : <span className="text-xl text-muted">?</span>}
    </div>
  );
}

const trackLine = (t: TrackDayTrackDto) =>
  `${TERRAIN_LABEL[t.terrain]} · ${fmtKm(t.length)} · ${t.corners} curvas`;

/** Um horário: o que entra, de onde veio e a troca (corrida aberta) ou reserva (horário ainda sem corrida). */
function SlotRow({
  slot,
  specials,
  onChanged,
}: {
  slot: TrackDaySlotDto;
  specials: TrackDayDto['specials'];
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = slot.track ?? slot.plan;
  const source = slot.race ? slot.source! : slot.plan ? 'plan' : 'open';
  const src = SOURCE[source]!;
  const current = slot.race
    ? slot.track?.kind === 'special'
      ? slot.track.versionId
      : 'auto'
    : (slot.plan?.versionId ?? 'auto');
  const losing = slot.race?.confirmed ?? 0;

  async function apply(choice: string) {
    setBusy(true);
    // 'auto' e 'regen': pista gerada (uma nova, se já havia corrida).
    const trackVersionId = choice === 'auto' || choice === 'regen' ? null : choice;
    try {
      if (slot.race) await put(`/admin/races/${slot.race.id}/track`, { trackVersionId });
      else await put(`/admin/track-day/slots/${slot.at}`, { trackVersionId });
      toast(
        slot.race ? 'Pista trocada' : trackVersionId ? 'Pista reservada' : 'Reserva removida',
        slot.race && losing ? 'Os jogadores inscritos foram avisados para refazer o traçado.' : undefined,
        'ok',
      );
      setPending(null);
      onChanged();
    } catch (x) {
      toast('Não deu para trocar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  function choose(choice: string) {
    // Corrida com gente inscrita: confirma antes (o traçado salvo de cada um é apagado).
    if (slot.race && losing > 0) setPending(choice);
    else void apply(choice);
  }

  return (
    <li className={clsx('card flex flex-wrap items-center gap-3 !p-3', !slot.grid && 'border-race/40')}>
      <TrackThumb versionId={shown?.versionId ?? null} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-xl">{hour(slot.at)}</span>
          <span className="text-sm text-muted">{slot.category?.name ?? 'sem categoria ativa'}</span>
          {!slot.grid && slot.race && (
            <span className="chip border-race/50 text-race">Avulsa: {slot.race.name}</span>
          )}
        </div>
        <div className="mt-0.5 truncate text-sm">
          {shown ? (
            <>
              <span className="font-bold">{shown.kind === 'special' ? shown.name : 'Pista gerada'}</span>{' '}
              <span className="text-muted">
                · {trackLine(shown)}
                {slot.biome && ` · ${BIOME_LABEL[slot.biome]}`}
              </span>
            </>
          ) : (
            <span className="text-muted">Gerada pelas configurações quando a corrida for criada</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className={clsx('chip', src.cls)} title={src.hint}>
            {src.label}
          </span>
          {slot.race ? (
            <>
              <span className={clsx('chip', PHASE_COLOR[slot.race.status])}>
                {PHASE_LABELS[slot.race.status]}
              </span>
              <span className="text-muted">
                {slot.race.confirmed}/{slot.race.capacity} inscritos
              </span>
            </>
          ) : (
            <span className="text-muted">ainda não criada</span>
          )}
        </div>
      </div>
      {slot.editable ? (
        <label className="w-full sm:w-64">
          <span className="sr-only">Pista de {hour(slot.at)}</span>
          <select
            className="input !py-2 text-sm"
            value={pending ?? current}
            disabled={busy}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="auto">
              {slot.race ? (current === 'auto' ? 'Gerada (manter)' : 'Gerar uma pista nova') : 'Automática'}
            </option>
            {slot.race && current === 'auto' && <option value="regen">Gerar outra pista</option>}
            {specials.map((s) => (
              <option key={s.versionId} value={s.versionId}>
                {s.name} · {TERRAIN_LABEL[s.terrain]} · {fmtKm(s.length)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="text-xs text-muted">
          {slot.race ? 'Pista fixa (corrida em andamento ou encerrada)' : 'Horário passado'}
        </span>
      )}
      {pending && (
        <div className="flex w-full flex-wrap items-center justify-end gap-2 rounded-xl bg-night-2 p-2 text-sm">
          <span className="mr-auto">
            {losing} {losing === 1 ? 'inscrito' : 'inscritos'}: o traçado salvo de cada um é apagado e os
            jogadores recebem um aviso para refazer. Trocar a pista?
          </span>
          <button className="btn-ghost !py-1.5" disabled={busy} onClick={() => setPending(null)}>
            Cancelar
          </button>
          <button className="btn-primary !py-1.5" disabled={busy} onClick={() => void apply(pending)}>
            Trocar
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Pistas do dia: o que entra em cada horário da grade (e nas corridas avulsas), de onde veio a pista, e a troca
 * por uma especial ou por outra gerada; para os horários ainda não criados, reserva. Ao lado, as especiais
 * publicadas, quantas vezes entram no dia e o rodízio.
 */
export default function AdminTrackDay() {
  const qc = useQueryClient();
  const now = useServerNow(60_000);
  const today = brtDay(now);
  const [params, setParams] = useSearchParams();
  const day = params.get('dia') ?? today;
  const setDay = (d: string) => setParams(d === today ? {} : { dia: d }, { replace: true });
  const [showPast, setShowPast] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-track-day', day],
    queryFn: () => get<TrackDayDto>(`/admin/track-day?day=${day}`),
    refetchInterval: 60_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-track-day'] });
  const days = Array.from({ length: 8 }, (_, i) =>
    brtDay(Date.parse(`${today}T12:00:00Z`) + (i - 1) * DAY_MS + BRT_OFFSET_MS),
  );

  async function togglePool(versionId: string, inPool: boolean) {
    try {
      await put('/admin/track-day/pool', { trackVersionId: versionId, inPool });
      toast(inPool ? 'Entrou no rodízio' : 'Saiu do rodízio', undefined, 'ok');
      refresh();
    } catch (x) {
      toast('Não deu para salvar', errorMessage(x), 'error');
    }
  }

  const slots = data?.slots ?? [];
  const races = slots.filter((s) => s.race).length;
  // Horários que já passaram sem corrida: recolhidos (só ocupam espaço).
  const past = slots.filter((s) => !s.race && !s.editable);
  const visible = showPast ? slots : slots.filter((s) => s.race || s.editable);
  const specialsToday = slots.filter((s) => (s.track ?? s.plan)?.kind === 'special').length;
  const inPool = data?.specials.filter((s) => s.inPool).length ?? 0;

  return (
    <AdminPage
      title="Pistas do dia"
      actions={
        <Link to="/admin/pistas/editor" className="btn-ghost">
          Nova pista especial
        </Link>
      }
    >
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Dia">
        {days.map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={d === day}
            className={clsx('btn-ghost !py-1.5 text-sm capitalize', d === day && '!bg-race !text-night')}
            onClick={() => setDay(d)}
          >
            {dayLabel(d, today)}
          </button>
        ))}
      </div>
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <section aria-label="Horários">
            <p className="mb-3 text-sm text-muted">
              {slots.length} horários · {races} {races === 1 ? 'corrida criada' : 'corridas criadas'} ·{' '}
              {specialsToday} com pista especial
              {data.createdUntil && ` · grade criada até ${hour(data.createdUntil)}`}. Horários de Brasília. A
              troca vale até 1 minuto antes do parque fechado.
            </p>
            {past.length > 0 && (
              <button
                className="btn-ghost mb-2 w-full !py-1.5 text-sm"
                onClick={() => setShowPast((v) => !v)}
              >
                {showPast
                  ? 'Esconder os horários que já passaram'
                  : `Mostrar ${past.length} ${past.length === 1 ? 'horário que já passou' : 'horários que já passaram'} sem corrida`}
              </button>
            )}
            {visible.length ? (
              <ul className="space-y-2">
                {visible.map((s) => (
                  <SlotRow key={s.race?.id ?? s.at} slot={s} specials={data.specials} onChanged={refresh} />
                ))}
              </ul>
            ) : (
              <p className="card text-sm text-muted">
                Nenhuma corrida neste dia (a grade automática está desligada?).
              </p>
            )}
          </section>
          <aside className="space-y-3" aria-label="Pistas especiais">
            <div className="card space-y-1 !p-3 text-sm">
              <h2 className="font-display text-lg">Especiais</h2>
              <p className="text-muted">
                {inPool
                  ? `${inPool} no rodízio: cada corrida nova da grade tem ${Math.round(data.poolChance * 100)}% de chance de sortear uma delas.`
                  : 'Nenhuma no rodízio: as corridas da grade usam pistas geradas, a não ser que você escolha.'}{' '}
                <Link to="/admin/configuracoes" className="text-race underline">
                  Chance do rodízio
                </Link>
              </p>
            </div>
            {data.specials.length ? (
              <ul className="space-y-2">
                {data.specials.map((s) => (
                  <li key={s.versionId} className="card flex gap-3 !p-3">
                    <TrackThumb versionId={s.versionId} />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="truncate font-bold">{s.name}</div>
                      <div className="text-xs text-muted">{trackLine(s)}</div>
                      <div className={clsx('mt-1 text-xs', s.today ? 'text-go' : 'text-muted')}>
                        {s.today ? `Entra ${s.today}× neste dia` : 'Não entra neste dia'}
                      </div>
                      <div className="mt-1">
                        <Toggle
                          label="No rodízio"
                          checked={s.inPool}
                          onChange={(v) => void togglePool(s.versionId, v)}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="card text-sm text-muted">
                Nenhuma especial publicada. Crie no editor ou salve uma seed do gerador.
              </p>
            )}
          </aside>
        </div>
      )}
    </AdminPage>
  );
}
