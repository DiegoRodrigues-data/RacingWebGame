import { DEFAULT_SETUP, defaultPitStops, type CarSetup, type TracePoint } from '@tracado/shared';
import { traceToOffsets } from '@tracado/trackgen';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ReadyBar } from '../components/CrazyBits';
import { isRegistered, JoinRaceButton, lateEntryOpen } from '../components/JoinRace';
import { Countdown, PhaseBadge, Spinner, Tabs } from '../components/ui';
import { get } from '../lib/api';
import { useGeometry, useRace } from '../lib/queries';
import { useServerNow } from '../lib/realtime';
import { useSession } from '../lib/session';
import { draftKey, loadDraft, type PracticeInfo } from './box/common';
import { PracticeTab } from './box/PracticeTab';
import { SetupTab } from './box/SetupTab';
import { TraceTab } from './box/TraceTab';

export default function Box() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const me = useSession((s) => s.me);
  const { data: race, isLoading } = useRace(id);
  const now = useServerNow(1000);
  const registered = !!race && isRegistered(race);
  // Sem inscrição o box vira treino livre: tudo fica neste aparelho. Começa na aba de treino.
  const tab =
    (params.get('aba') as 'tracado' | 'setup' | 'treino' | null) ??
    (race && !registered ? 'treino' : 'tracado');
  const geo = useGeometry(race?.track.versionId);
  const practice = useQuery({
    queryKey: ['practice', id],
    queryFn: () => get<PracticeInfo>(`/races/${id}/practice`),
    enabled: !!id,
  });
  const serverTrace = useQuery({
    queryKey: ['trace', id, me?.id],
    queryFn: () =>
      get<{ points: TracePoint[]; version: number; submittedAt: string } | null>(`/races/${id}/trace`),
    enabled: !!id && !!me,
  });
  const serverSetup = useQuery({
    queryKey: ['setup', id, me?.id],
    queryFn: () => get<{ setup: CarSetup; updatedAt: string } | null>(`/races/${id}/setup`),
    enabled: !!id && !!me,
  });

  const [offsets, setOffsets] = useState<Float64Array | null>(null);
  const [setup, setSetup] = useState<CarSetup | null>(null);

  // Estado inicial: servidor > rascunho local > padrão.
  useEffect(() => {
    if (!geo.data || offsets || serverTrace.isLoading) return;
    const pts = serverTrace.data?.points ?? loadDraft<TracePoint[]>(draftKey(id!, 'trace'));
    setOffsets(pts ? traceToOffsets(geo.data, pts) : new Float64Array(geo.data.count));
  }, [geo.data, serverTrace.isLoading, serverTrace.data, offsets, id]);
  useEffect(() => {
    if (setup || serverSetup.isLoading || !practice.data) return;
    const lim = practice.data.limits;
    const fallback: CarSetup = {
      ...DEFAULT_SETUP,
      tyre: lim.allowedTyres.includes('medium') ? 'medium' : lim.allowedTyres[0]!,
      pitStops: defaultPitStops(practice.data.laps, lim.allowedTyres),
      terrainPrep:
        race?.track.terrain === 'dirt' || race?.track.terrain === 'sand' ? race.track.terrain : 'asphalt',
    };
    setSetup(serverSetup.data?.setup ?? loadDraft<CarSetup>(draftKey(id!, 'setup')) ?? fallback);
  }, [serverSetup.isLoading, serverSetup.data, setup, practice.data, id, race?.track.terrain]);

  if (isLoading || !race) return <Spinner />;
  const late = lateEntryOpen(race, now);
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/corridas/${id}`} className="text-sm text-muted hover:text-ink">
            ← {race.name}
          </Link>
          <h1 className="font-display text-2xl">Box · {race.track.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          <PhaseBadge phase={race.status} />
          {race.phaseDeadline && <Countdown to={race.phaseDeadline} className="text-2xl" />}
        </div>
      </header>
      <ReadyBar
        race={race}
        unsavedSetup={
          !!setup &&
          !!serverSetup.data?.setup &&
          JSON.stringify(setup) !== JSON.stringify(serverSetup.data.setup)
        }
      />
      {!registered && (
        <div className="card flex flex-wrap items-center gap-3 border-sky">
          <div className="min-w-0 flex-1 text-sm">
            <b>Treino livre.</b>{' '}
            <span className="text-muted">
              Você não está inscrito: teste setups, traçados e corridas contra fantasmas à vontade, mas nada
              disso vale para a corrida.{' '}
              {!me
                ? 'Entre na sua conta para disputar.'
                : late || race.status === 'registration_open'
                  ? 'Inscreva-se para levar o seu carro ao grid.'
                  : ''}
            </span>
          </div>
          {!me ? (
            <Link to={`/entrar?voltar=/corridas/${id}/box`} className="btn-primary">
              Entrar
            </Link>
          ) : (
            <JoinRaceButton race={race} now={now} className="btn-primary" />
          )}
        </div>
      )}
      <Tabs
        value={tab}
        onChange={(v) => setParams({ aba: v }, { replace: true })}
        items={[
          { value: 'tracado', label: '✍️ Traçado' },
          { value: 'setup', label: '🔧 Setup' },
          { value: 'treino', label: '⏱️ Treino' },
        ]}
      />
      {!geo.data || !offsets || !setup || !practice.data ? (
        <Spinner />
      ) : tab === 'tracado' ? (
        <TraceTab
          race={race}
          g={geo.data}
          offsets={offsets}
          setOffsets={setOffsets}
          setup={setup}
          practice={practice.data}
          serverVersion={serverTrace.data?.version ?? null}
        />
      ) : tab === 'setup' ? (
        <SetupTab
          race={race}
          g={geo.data}
          offsets={offsets}
          setup={setup}
          setSetup={setSetup}
          practice={practice.data}
        />
      ) : (
        <PracticeTab race={race} g={geo.data} offsets={offsets} setup={setup} practice={practice.data} />
      )}
    </div>
  );
}
