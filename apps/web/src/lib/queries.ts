import type {
  CategoryDto,
  EntryDto,
  NotificationDto,
  RaceDetailDto,
  RaceSummaryDto,
  RankingPageDto,
  RankingRowDto,
  ResultRowDto,
  ServerEvents,
} from '@tracado/shared';
import { ROOM } from '@tracado/shared';
import type { TrackGeometry } from '@tracado/trackgen';
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from './api';
import { useRoom } from './realtime';
import { useSession } from './session';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (n, e) => n < 2 && !(e as { status?: number }).status?.toString().startsWith('4'),
      refetchOnWindowFocus: true,
    },
  },
});

export interface LobbyDto {
  live: RaceSummaryDto[];
  upcoming: RaceSummaryDto[];
  recent: { race: RaceSummaryDto; podium: ResultRowDto[] }[];
  top: RankingRowDto[];
  mine: RaceSummaryDto[];
  stats: { players: number; liveRaces: number; online: number };
}

export function useLobby() {
  const me = useSession((s) => s.me);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['lobby', me?.id ?? null],
    queryFn: () => get<LobbyDto>('/lobby'),
    refetchInterval: 30_000,
  });
  useRoom(ROOM.lobby, (env) => {
    if (env.type !== 'lobby.race') return;
    const { race } = env.payload as ServerEvents['lobby.race'];
    qc.setQueryData<LobbyDto>(['lobby', me?.id ?? null], (old) => {
      if (!old) return old;
      const swap = (list: RaceSummaryDto[]) => list.map((r) => (r.id === race.id ? race : r));
      return { ...old, live: swap(old.live), upcoming: swap(old.upcoming), mine: swap(old.mine) };
    });
    if (['practice', 'finished', 'cancelled', 'registration_open'].includes(race.status))
      void qc.invalidateQueries({ queryKey: ['lobby'] });
  });
  return q;
}

/** Detalhe da corrida mantido em sincronia pelo WebSocket (fase, vagas, inscritos). */
export function useRace(id: string | undefined) {
  const qc = useQueryClient();
  const me = useSession((s) => s.me);
  const key = ['race', id, me?.id ?? null];
  const q = useQuery({ queryKey: key, queryFn: () => get<RaceDetailDto>(`/races/${id}`), enabled: !!id });
  useRoom(id ? ROOM.race(id) : null, (env) => {
    const set = (fn: (d: RaceDetailDto) => RaceDetailDto) =>
      qc.setQueryData<RaceDetailDto>(key, (old) => (old ? fn(old) : old));
    switch (env.type) {
      case 'race.snapshot': {
        const p = env.payload as ServerEvents['race.snapshot'];
        set((d) => ({ ...d, ...p.race, entries: p.entries }));
        break;
      }
      case 'race.phase': {
        const p = env.payload as ServerEvents['race.phase'];
        set((d) => ({ ...d, ...p.race }));
        void qc.invalidateQueries({ queryKey: ['race', id] });
        break;
      }
      case 'race.capacity':
        set((d) => ({ ...d, capacity: env.payload as ServerEvents['race.capacity'] }));
        break;
      case 'race.entries':
        set((d) => {
          const entries = (env.payload as ServerEvents['race.entries']).entries;
          const mine = me ? (entries.find((e: EntryDto) => e.userId === me.id) ?? null) : null;
          return { ...d, entries, me: d.me ? { ...d.me, entry: mine } : d.me };
        });
        break;
    }
  });
  return q;
}

export function useGeometry(versionId: string | undefined) {
  return useQuery({
    queryKey: ['geometry', versionId],
    queryFn: () => get<TrackGeometry>(`/tracks/versions/${versionId}/geometry`),
    enabled: !!versionId,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => get<CategoryDto[]>('/categories'),
    staleTime: 5 * 60_000,
  });
}

export function useNotifications() {
  const me = useSession((s) => s.me);
  return useQuery({
    queryKey: ['notifications', me?.id],
    queryFn: () => get<NotificationDto[]>('/notifications'),
    enabled: !!me,
  });
}

export function useRanking(params: { scope: string; key?: string; season?: string; page?: number }) {
  const me = useSession((s) => s.me);
  const qs = new URLSearchParams(
    Object.entries({ ...params, page: String(params.page ?? 1) }).filter(([, v]) => v) as [string, string][],
  );
  return useQuery({
    queryKey: ['ranking', qs.toString(), me?.id],
    queryFn: () => get<RankingPageDto>(`/rankings?${qs}`),
  });
}
