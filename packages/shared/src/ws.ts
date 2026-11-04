import { z } from 'zod';
import { WS_PROTOCOL_VERSION } from './constants';
import type { RacePhase } from './phases';
import type {
  CapacityDto,
  EntryDto,
  NotificationDto,
  QualifyingRowDto,
  RaceSummaryDto,
  ResultRowDto,
  Tyre,
  Weather,
} from './schemas';

/** Envelope de toda mensagem servidor → cliente. `seq` é monotônico por sala. */
export interface WsEnvelope<T extends ServerEventType = ServerEventType> {
  v: typeof WS_PROTOCOL_VERSION;
  type: T;
  room: string;
  seq: number;
  serverTime: number;
  payload: ServerEvents[T];
}

/** Frame de replay: `c` é plano, com CAR_FRAME_STRIDE números por carro na ordem de `cars` de race.started. */
export interface ReplayFrame {
  t: number; // ms desde a largada (tempo simulado)
  c: number[];
}
/**
 * x, y (m), heading (rad), progresso (voltas.fração), pneu (índice TYRES), status (0 correndo, 1 box, 2 abandono,
 * 3 terminou), desgaste do pneu (%, passa de 100 depois da vida útil) e desgaste do motor (%).
 * Replays gravados antes da simulação v2 têm só os 6 primeiros (CAR_FRAME_STRIDE_V1).
 */
export const CAR_FRAME_STRIDE = 8;
export const CAR_FRAME_STRIDE_V1 = 6;
export const CAR_STATUS = { running: 0, pit: 1, dnf: 2, finished: 3 } as const;

export interface LiveCarDto {
  userId: string;
  nickname: string;
  carColor: string;
  carModel: number;
  carNumber: number;
  gridSlot: number;
}

export interface RaceIncidentDto {
  t: number;
  userId: string | null;
  kind:
    | 'spin'
    | 'mechanical'
    | 'puncture'
    | 'safety_car'
    | 'safety_car_end'
    | 'oil'
    | 'pit'
    | 'weather'
    | 'overtake'
    | 'fastest_lap';
  lap: number;
  detail?: string;
}

export interface ServerEvents {
  hello: { connectionId: string; userId: string | null; protocol: number };
  pong: { clientTime: number };
  error: { code: string; message: string };
  resync: { reason: string };
  'lobby.race': { race: RaceSummaryDto };
  'race.snapshot': {
    race: RaceSummaryDto;
    entries: EntryDto[];
    live: null | {
      startedAt: number;
      durationMs: number;
      frameHz: number;
      playbackSpeed: number;
      cars: LiveCarDto[];
      frames: ReplayFrame[];
      incidents: RaceIncidentDto[];
    };
  };
  'race.phase': {
    raceId: string;
    from: RacePhase;
    to: RacePhase;
    phaseDeadline: number | null;
    race: RaceSummaryDto;
  };
  'race.capacity': CapacityDto;
  'race.entries': { raceId: string; entries: EntryDto[] };
  'trace.window_opened': { raceId: string; deadline: number };
  'trace.window_closed': { raceId: string };
  'trace.saved': { raceId: string; version: number; submittedAt: number; points: number };
  'trace.rejected': { raceId: string; code: string; message: string };
  'race.qualifying': { raceId: string; rows: QualifyingRowDto[] };
  'race.started': {
    raceId: string;
    startedAt: number;
    durationMs: number;
    frameHz: number;
    playbackSpeed: number;
    cars: LiveCarDto[];
    weatherByLap: Weather[];
  };
  'race.tick': { raceId: string; fromFrame: number; frames: ReplayFrame[] };
  'race.incident': { raceId: string; incidents: RaceIncidentDto[] };
  'race.finished': { raceId: string; results: ResultRowDto[] };
  notification: NotificationDto;
}
export type ServerEventType = keyof ServerEvents;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    room: z.string().max(80),
    lastSeq: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal('unsubscribe'), room: z.string().max(80) }),
  z.object({ type: z.literal('ping'), clientTime: z.number() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const ROOM = {
  lobby: 'lobby',
  race: (id: string) => `race:${id}`,
  user: (id: string) => `user:${id}`,
} as const;

export function tyreCode(t: Tyre): number {
  return ['soft', 'medium', 'hard', 'wet'].indexOf(t);
}
