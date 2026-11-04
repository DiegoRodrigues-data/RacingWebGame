import type { AuthResponse, MeDto } from '@tracado/shared';
import { create } from 'zustand';
import { api, onSessionChange, post, refreshSession, setAccessToken } from './api';

interface SessionState {
  me: MeDto | null;
  ready: boolean;
  bootstrap(): Promise<void>;
  apply(r: AuthResponse): void;
  setMe(me: MeDto): void;
  logout(): Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  me: null,
  ready: false,
  async bootstrap() {
    const r = await refreshSession();
    set({ me: r?.me ?? null, ready: true });
  },
  apply(r) {
    setAccessToken(r.accessToken);
    set({ me: r.me, ready: true });
  },
  setMe(me) {
    set({ me });
  },
  async logout() {
    await post('/auth/logout').catch(() => undefined);
    setAccessToken(null);
    set({ me: null });
  },
}));

onSessionChange((r) => useSession.setState({ me: r?.me ?? null }));

export const isAdmin = (me: MeDto | null) => !!me?.roles.includes('admin');
export const isEditor = (me: MeDto | null) => !!me?.roles.some((r) => r === 'admin' || r === 'track_editor');
export { api };
