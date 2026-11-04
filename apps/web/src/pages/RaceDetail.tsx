import { formatLapTime, LEVEL_LABELS, PHASE_LABELS, type QualifyingRowDto } from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { LiveTrack } from '../components/LiveTrack';
import { CameraControls, TrackCanvas } from '../components/TrackCanvas';
import {
  CapacityMeter,
  CarIcon,
  Countdown,
  Empty,
  Flag,
  PhaseBadge,
  PhaseTimeline,
  Spinner,
  toast,
} from '../components/ui';
import type { TrackScene } from '../game/scene';
import { del, errorMessage, get, post } from '../lib/api';
import { fmtDateTime, fmtKm, TERRAIN_LABEL, WEATHER_ICON, WEATHER_LABEL } from '../lib/format';
import { useGeometry, useRace } from '../lib/queries';
import { useSession } from '../lib/session';
import { ShareRace } from '../components/ShareRace';

export default function RaceDetail() {
  const { id } = useParams();
  const me = useSession((s) => s.me);
  const qc = useQueryClient();
  const { data: race, isLoading, error } = useRace(id);
  const geo = useGeometry(race?.track.versionId);
  const [scene, setScene] = useState<TrackScene | null>(null);
  const [busy, setBusy] = useState(false);
  const qualiVisible = race && ['qualifying', 'race', 'finished', 'archived'].includes(race.status);
  const quali = useQuery({
    queryKey: ['quali', id],
    queryFn: () => get<QualifyingRowDto[]>(`/races/${id}/qualifying`),
    enabled: !!qualiVisible,
  });
  if (isLoading) return <Spinner />;
  if (error || !race) return <Empty title="Corrida não encontrada" icon="🚧" />;
  const entry = race.me?.entry;
  const active = entry && (entry.status === 'confirmed' || entry.status === 'waitlisted');
  const prepPhase = ['registration_open', 'practice', 'trace_window'].includes(race.status);

  async function register() {
    setBusy(true);
    try {
      const r = await post<{ status: string; waitlistPosition: number | null }>(`/races/${id}/entries`);
      if (r.status === 'confirmed') {
        toast('Você está no grid! 🏎️', 'Configure o carro e prepare seu traçado.', 'ok');
        if (!me?.profile.reducedMotion) void confetti({ particleCount: 80, spread: 70, origin: { y: 0.7 } });
      } else toast('Corrida lotada', `Você é o ${r.waitlistPosition}º da fila de espera.`, 'warn');
      await qc.invalidateQueries({ queryKey: ['race', id] });
    } catch (e) {
      toast('Não foi possível se inscrever', errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (
      !window.confirm(
        race!.status === 'registration_open'
          ? 'Cancelar sua inscrição? A vaga vai para o próximo da fila.'
          : 'Desistir desta corrida? Você não larga e a vaga não é reaproveitada.',
      )
    )
      return;
    setBusy(true);
    try {
      await del(`/races/${id}/entries/me`);
      toast('Inscrição cancelada');
      await qc.invalidateQueries({ queryKey: ['race', id] });
    } catch (e) {
      toast('Erro', errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const confirmed = race.entries.filter((e) => e.status === 'confirmed' || e.status === 'dnf');
  const waitlist = race.entries.filter((e) => e.status === 'waitlisted');
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <PhaseBadge phase={race.status} />
            <span className="chip">
              {race.category.name} · {LEVEL_LABELS[race.category.level]}
            </span>
            <span className="chip">{race.ranked ? '🏆 Ranqueada' : '🤝 Amistosa'}</span>
            {race.annulled && <span className="chip border-hot text-hot">Resultado anulado</span>}
          </div>
          <h1 className="mt-2 font-display text-3xl">{race.name}</h1>
          <p className="text-sm text-muted">
            Treino {fmtDateTime(race.timeline.practiceAt)} · Largada {fmtDateTime(race.timeline.raceAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <ShareRace race={race} className="self-center" />
          {race.phaseDeadline && (
            <div className="card !py-2 text-right">
              <div className="text-xs font-bold uppercase text-muted">
                {race.status === 'scheduled'
                  ? 'Inscrições abrem em'
                  : `${PHASE_LABELS[race.status]} termina em`}
              </div>
              <Countdown to={race.phaseDeadline} className="text-3xl" />
            </div>
          )}
        </div>
      </header>
      <div className="card">
        <PhaseTimeline race={race} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {race.status === 'race' ? (
            <LiveTrack race={race} geometry={geo.data} className="h-[340px] sm:h-[420px]" />
          ) : (
            <div className="relative self-start">
              <TrackCanvas
                geometry={geo.data}
                onReady={setScene}
                className="h-[340px] sm:h-[420px]"
                label={`Mapa da pista ${race.track.name}`}
              />
              <CameraControls scene={scene} />
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="chip">🛣️ {race.track.name}</span>
            <span className="chip">{fmtKm(race.track.length)}</span>
            <span className="chip">{race.laps} voltas</span>
            <span className="chip">{TERRAIN_LABEL[race.track.terrain]}</span>
            <span className="chip">🌡️ {race.weather.temperature}°C</span>
            <span className="chip">☔ chuva {Math.round(race.weather.rainChance * 100)}%</span>
          </div>
          {race.forecast && (
            <div className="card">
              <div className="label">Previsão por volta (pode errar!)</div>
              <div className="flex flex-wrap gap-1.5">
                {race.forecast.map((f) => (
                  <div
                    key={f.lap}
                    className="grid w-12 place-items-center rounded-xl bg-night py-1.5 text-center"
                    title={`Volta ${f.lap}: ${WEATHER_LABEL[f.weather]}`}
                  >
                    <span className="text-lg">{WEATHER_ICON[f.weather]}</span>
                    <span className="text-[10px] font-bold text-muted">V{f.lap}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <aside className="space-y-4">
          <div className="card space-y-3">
            <CapacityMeter cap={race.capacity} />
            {!me && (
              <Link to={`/entrar?voltar=/corridas/${race.id}`} className="btn-primary w-full">
                Entre para se inscrever
              </Link>
            )}
            {me && !active && race.status === 'registration_open' && (
              <button className="btn-primary w-full" disabled={busy} onClick={register}>
                {race.capacity.free > 0 ? 'Inscrever-se' : 'Entrar na fila de espera'}
              </button>
            )}
            {me && !active && race.status === 'scheduled' && (
              <p className="text-center text-sm text-muted">
                Inscrições abrem em {fmtDateTime(race.timeline.registrationOpensAt)}.
              </p>
            )}
            {active && (
              <div className="rounded-xl bg-go/10 p-3 text-sm">
                {entry!.status === 'confirmed' ? (
                  <div className="flex items-center gap-3">
                    <CarIcon color={entry!.carColor} model={entry!.carModel} className="h-10" />
                    <div>
                      <b className="text-go">Confirmado</b> · carro #{entry!.carNumber}
                      <div className="text-xs text-muted">
                        {race.me?.hasSetup ? '✅ setup salvo' : '⚠️ sem setup (padrão)'} ·{' '}
                        {race.me?.hasTrace ? '✅ traçado enviado' : '⚠️ sem traçado'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <span>
                    Na fila de espera: <b>{entry!.waitlistPosition}º</b>
                  </span>
                )}
              </div>
            )}
            {active && prepPhase && (
              <Link to={`/corridas/${race.id}/box`} className="btn-go w-full">
                {race.status === 'trace_window' ? '✍️ Desenhar traçado agora' : '🔧 Ir para o box'}
              </Link>
            )}
            {active && prepPhase && (
              <button className="btn-ghost w-full" disabled={busy} onClick={cancel}>
                {race.status === 'registration_open' ? 'Cancelar inscrição' : 'Desistir'}
              </button>
            )}
            {['qualifying', 'race'].includes(race.status) && (
              <Link to={`/corridas/${race.id}/ao-vivo`} className="btn-danger w-full">
                {race.status === 'race' ? '🔴 Assistir ao vivo' : 'Grid e largada'}
              </Link>
            )}
            {['finished', 'archived'].includes(race.status) && (
              <div className="grid grid-cols-2 gap-2">
                <Link to={`/corridas/${race.id}/resultado`} className="btn-primary">
                  Resultado
                </Link>
                <Link to={`/corridas/${race.id}/replay`} className="btn-ghost">
                  Replay
                </Link>
              </div>
            )}
          </div>
          {quali.data && quali.data.length > 0 && (
            <div className="card">
              <h2 className="mb-2 font-display">Classificação</h2>
              <ol className="space-y-1 text-sm">
                {quali.data.map((q) => (
                  <li key={q.userId} className="flex items-center gap-2">
                    <span className="w-6 text-right font-mono text-muted">{q.position}</span>
                    <span className="flex-1 truncate font-semibold">{q.nickname}</span>
                    {q.usedDefaultTrace && <span title="Sem traçado: linha central com penalidade">⚠️</span>}
                    <span className="font-mono">
                      {q.position === 1 ? formatLapTime(q.lapTimeMs) : `+${(q.gapMs / 1000).toFixed(3)}`}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>
      <section aria-labelledby="grid">
        <h2 id="grid" className="font-display text-xl">
          Pilotos ({confirmed.length}/{race.capacity.capacity})
        </h2>
        {!confirmed.length && (
          <p className="mt-2 text-sm text-muted">Ninguém inscrito ainda. Seja o primeiro!</p>
        )}
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {confirmed.map((e) => (
            <li
              key={e.userId}
              className={`card flex items-center gap-3 !p-3 ${e.userId === me?.id ? 'border-race' : ''}`}
            >
              <CarIcon color={e.carColor} model={e.carModel} />
              <div className="min-w-0 flex-1">
                <Link to={`/pilotos/${e.userId}`} className="block truncate font-bold hover:text-race">
                  {e.nickname}
                </Link>
                <div className="text-xs text-muted">
                  <Flag country={e.country} /> #{e.carNumber} {e.gridSlot ? `· P${e.gridSlot}` : ''}{' '}
                  {e.status === 'dnf' ? '· abandono' : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {waitlist.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-bold uppercase text-muted">Fila de espera</h3>
            <ol className="mt-2 flex flex-wrap gap-2">
              {waitlist.map((e) => (
                <li key={e.userId} className="chip">
                  {e.waitlistPosition}º {e.nickname}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
