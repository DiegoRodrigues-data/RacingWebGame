import type { Level, RacePhase, Terrain, TrackTerrain, Tyre, Weather } from '@tracado/shared';

export const fmtDateTime = (iso: string | number) =>
  new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
export const fmtTime = (iso: string | number) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fmtKm = (m: number) => `${(m / 1000).toFixed(2).replace('.', ',')} km`;
export const fmtGap = (ms: number | null) =>
  ms == null ? '' : ms === 0 ? 'líder' : `+${(ms / 1000).toFixed(3).replace('.', ',')}s`;

export const WEATHER_LABEL: Record<Weather, string> = {
  dry: 'Seco',
  cloudy: 'Nublado',
  light_rain: 'Garoa',
  rain: 'Chuva',
};
export const WEATHER_ICON: Record<Weather, string> = {
  dry: '☀️',
  cloudy: '⛅',
  light_rain: '🌦️',
  rain: '🌧️',
};
export const TERRAIN_LABEL: Record<TrackTerrain | Terrain, string> = {
  asphalt: 'Asfalto',
  dirt: 'Terra',
  sand: 'Areia',
  mixed: 'Misto',
};
export const TYRE_COLOR: Record<Tyre, string> = {
  soft: '#ff5a5a',
  medium: '#ffcc00',
  hard: '#eef2ff',
  wet: '#4cc9f0',
};
export const TYRE_SHORT: Record<Tyre, string> = { soft: 'M', medium: 'Md', hard: 'D', wet: 'C' };
export const TYRES_BY_CODE: Tyre[] = ['soft', 'medium', 'hard', 'wet'];
export const LEVEL_COLOR: Record<Level, string> = {
  rookie: '#2ee59d',
  amateur: '#4cc9f0',
  pro: '#9b7bff',
  elite: '#ffcc00',
};
export const PHASE_COLOR: Record<RacePhase, string> = {
  scheduled: '#aab4dc',
  registration_open: '#2ee59d',
  practice: '#4cc9f0',
  trace_window: '#ffcc00',
  setup_lock: '#9b7bff',
  qualifying: '#ff9f43',
  race: '#ff5a5a',
  finished: '#eef2ff',
  archived: '#6b76a3',
  cancelled: '#6b76a3',
};
export function flag(country: string): string {
  if (!/^[A-Z]{2}$/i.test(country)) return '🏁';
  return String.fromCodePoint(
    ...country
      .toUpperCase()
      .split('')
      .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}
