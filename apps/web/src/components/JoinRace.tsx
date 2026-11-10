import { LATE_ENTRY_PHASES, type RaceDetailDto } from '@tracado/shared';
import { useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { useState } from 'react';
import { errorMessage, post } from '../lib/api';
import { useSession } from '../lib/session';
import { toast } from './ui';

/** Inscrição tardia: treino ou janela de traçado, antes do parque fechado e com vaga no grid. */
export function lateEntryOpen(race: RaceDetailDto, now: number): boolean {
  return (
    LATE_ENTRY_PHASES.includes(race.status) &&
    now < Date.parse(race.timeline.setupLockAt) &&
    race.capacity.free > 0
  );
}

export function isRegistered(race: RaceDetailDto): boolean {
  const s = race.me?.entry?.status;
  return s === 'confirmed' || s === 'waitlisted';
}

/** Botão de inscrição (normal ou tardia). Some quando não há como se inscrever agora. */
export function JoinRaceButton({
  race,
  now,
  className = 'btn-primary w-full',
  onJoined,
}: {
  race: RaceDetailDto;
  now: number;
  className?: string;
  onJoined?: () => void;
}) {
  const me = useSession((s) => s.me);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const late = lateEntryOpen(race, now);
  if (!me || isRegistered(race) || (race.status !== 'registration_open' && !late)) return null;
  if (me.roles.includes('admin'))
    return <p className="text-sm text-muted">Conta de administração: acompanha, mas não corre.</p>;
  // Corrida Maluca: grupo fechado (entra quem recebeu o convite).
  if (race.crazy)
    return (
      <p className="text-sm text-muted">
        🤪 Corrida do grupo <b className="text-ink">{race.crazy.groupName}</b>: só entra quem recebeu o link
        de convite.
      </p>
    );

  async function join() {
    setBusy(true);
    try {
      const r = await post<{ status: string; waitlistPosition: number | null }>(`/races/${race.id}/entries`);
      if (r.status === 'confirmed') {
        toast(
          'Você está no grid! 🏎️',
          late
            ? 'Corra para o box: ajuste o setup e o traçado antes do parque fechado.'
            : 'Configure o carro e prepare seu traçado.',
          'ok',
        );
        if (!me?.profile.reducedMotion) void confetti({ particleCount: 80, spread: 70, origin: { y: 0.7 } });
      } else toast('Corrida lotada', `Você é o ${r.waitlistPosition}º da fila de espera.`, 'warn');
      await qc.invalidateQueries({ queryKey: ['race', race.id] });
      onJoined?.();
    } catch (e) {
      toast('Não foi possível se inscrever', errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className={className} disabled={busy} onClick={join}>
      {late
        ? '🏎️ Entrar no grid agora'
        : race.capacity.free > 0
          ? 'Inscrever-se'
          : 'Entrar na fila de espera'}
    </button>
  );
}
