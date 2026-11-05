import { formatLapTime, LEVEL_LABELS, PHASE_LABELS, type QualifyingRowDto } from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { CrazyBadge, ReadyBar } from '../components/CrazyBits';
import { isRegistered, JoinRaceButton, lateEntryOpen } from '../components/JoinRace';
import { LiveTrack } from '../components/LiveTrack';
import { QualifyingLive } from '../components/QualifyingLive';
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
import { del, errorMessage, get } from '../lib/api';
import { fmtDateTime, fmtKm, TERRAIN_LABEL, WEATHER_ICON, WEATHER_LABEL } from '../lib/format';
import { useGeometry, useRace } from '../lib/queries';
import { useServerNow } from '../lib/realtime';
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
  const now = useServerNow(1000);
  const qualiVisible = race && ['qualifying', 'race', 'finished', 'archived'].includes(race.status);
  const quali = useQuery({
    queryKey: ['quali', id],
    queryFn: () => get<QualifyingRowDto[]>(`/races/${id}/qualifying`),
    enabled: !!qualiVisible,
    // Durante a sessão a tabela é provisória: só as voltas já fechadas.
    refetchInterval: race?.status === 'qualifying' ? 3000 : false,
  });
  if (isLoading) return <Spinner />;
  if (error || !race) return <Empty title="Corrida não encontrada" icon="🚧" />;
  const entry = race.me?.entry;
  const active = isRegistered(race);
  const prepPhase =
    ['registration_open', 'practice', 'trace_window'].includes(race.status) &&
    now < Date.parse(race.timeline.setupLockAt);
  const late = lateEntryOpen(race, now);
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
  // Antes da classificação, quem assiste vê como está a preparação de cada piloto (nunca o conteúdo).
  const showPrep = ['registration_open', 'practice', 'trace_window', 'setup_lock'].includes(race.status);
  const traces = confirmed.filter((e) => e.hasTrace).length;
  const setupsSaved = confirmed.filter((e) => e.hasSetup).length;
  const phaseBanner =
    race.status === 'practice'
      ? {
          icon: '⏱️',
          title: 'Treino',
          text: 'Pilotos testando setups e linhas',
          until: race.timeline.traceWindowAt,
          untilLabel: 'traçado abre em',
        }
      : race.status === 'trace_window'
        ? {
            icon: '✍️',
            title: 'Janela de traçado',
            text: `${traces}/${confirmed.length} traçados enviados`,
            until: race.timeline.setupLockAt,
            untilLabel: 'fecha em',
          }
        : race.status === 'setup_lock'
          ? {
              icon: '🔒',
              title: 'Parque fechado',
              text: 'Carros, setups e traçados travados',
              until: race.timeline.qualifyingAt,
              untilLabel: 'classificação em',
            }
          : null;
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
            <CrazyBadge race={race} />
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
      <ReadyBar race={race} />
      <div className="card">
        <PhaseTimeline race={race} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {race.status === 'race' ? (
            <LiveTrack race={race} geometry={geo.data} className="h-[340px] sm:h-[420px]" />
          ) : race.status === 'qualifying' ? (
            <QualifyingLive
              race={race}
              geometry={geo.data}
              variant="compact"
              className="h-[340px] sm:h-[420px]"
            />
          ) : (
            <div className="relative self-start">
              <TrackCanvas
                geometry={geo.data}
                onReady={setScene}
                className="h-[340px] sm:h-[420px]"
                label={`Mapa da pista ${race.track.name}`}
              />
              <CameraControls scene={scene} />
              {phaseBanner && (
                <div
                  role="status"
                  className="pointer-events-none absolute inset-x-3 top-3 mx-auto w-fit max-w-full rounded-2xl bg-night/85 px-4 py-2 text-center backdrop-blur"
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    {phaseBanner.icon} {phaseBanner.title}
                  </div>
                  <div className="font-display text-lg">{phaseBanner.text}</div>
                  <div className="text-xs text-muted">
                    {phaseBanner.untilLabel} <Countdown to={phaseBanner.until} className="text-ink" />
                  </div>
                </div>
              )}
              {prepPhase && (
                <Link
                  to={`/corridas/${race.id}/box?aba=treino`}
                  className="btn-go absolute bottom-3 left-3 !px-3 !py-2 text-sm shadow-xl"
                >
                  ⏱️ Treinar nesta pista
                </Link>
              )}
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
            <JoinRaceButton race={race} now={now} />
            {me && !active && late && (
              <p className="text-center text-xs text-muted">
                O treino já começou, mas ainda há {race.capacity.free}{' '}
                {race.capacity.free === 1 ? 'vaga' : 'vagas'}: entre até o parque fechado (
                <Countdown to={race.timeline.setupLockAt} className="text-ink" />
                ).
              </p>
            )}
            {me &&
              !active &&
              !late &&
              ['practice', 'trace_window'].includes(race.status) &&
              now < Date.parse(race.timeline.setupLockAt) && (
                <p className="text-center text-sm text-muted">
                  O grid está completo. Você ainda pode treinar nesta pista.
                </p>
              )}
            {!active && prepPhase && (
              <Link to={`/corridas/${race.id}/box?aba=treino`} className="btn-ghost w-full">
                ⏱️ Treinar nesta pista
              </Link>
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
                        {race.me?.hasSetup ? '✅ setup salvo' : '⚠️ setup padrão (você não salvou um)'} ·{' '}
                        {race.me?.hasTrace ? (
                          '✅ traçado salvo'
                        ) : (
                          <>
                            ⚠️ traçado não salvo: o carro corre na linha central, 1,5% mais lento
                            {prepPhase && (
                              <>
                                {' · '}
                                <Link
                                  className="font-bold text-race underline"
                                  to={`/corridas/${race.id}/box?aba=tracado`}
                                >
                                  desenhar agora
                                </Link>
                              </>
                            )}
                          </>
                        )}
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
                {race.status === 'race' ? '🔴 Assistir ao vivo' : '⏱️ Classificação ao vivo'}
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
              <h2 className="mb-2 font-display">
                Classificação{race.status === 'qualifying' ? ' (provisória)' : ''}
              </h2>
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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="grid" className="font-display text-xl">
            Pilotos ({confirmed.length}/{race.capacity.capacity})
          </h2>
          {showPrep && confirmed.length > 0 && (
            <p className="text-sm text-muted">
              ✍️ {traces}/{confirmed.length} traçados enviados · 🔧 {setupsSaved}/{confirmed.length} setups
              salvos
            </p>
          )}
        </div>
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
                {showPrep && (
                  <div className="mt-0.5 flex gap-2 text-[11px]">
                    <span
                      className={e.hasTrace ? 'text-go' : 'text-muted'}
                      title={e.hasTrace ? 'Traçado enviado' : 'Ainda sem traçado: corre na linha central'}
                    >
                      ✍️ {e.hasTrace ? 'traçado ✓' : 'sem traçado'}
                    </span>
                    <span
                      className={e.hasSetup ? 'text-go' : 'text-muted'}
                      title={e.hasSetup ? 'Setup salvo' : 'Ainda no setup padrão'}
                    >
                      🔧 {e.hasSetup ? 'setup ✓' : 'padrão'}
                    </span>
                    {race.crazy && e.ready && <span className="font-bold text-violet">✅ pronto</span>}
                  </div>
                )}
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
