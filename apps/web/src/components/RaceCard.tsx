import { LEVEL_LABELS, type RaceSummaryDto } from '@tracado/shared';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { fmtDateTime, fmtKm, TERRAIN_LABEL, WEATHER_ICON, WEATHER_LABEL } from '../lib/format';
import { RaceMiniMap } from './RaceMiniMap';
import { CapacityMeter, Countdown, PhaseBadge } from './ui';
import { ShareRace } from './ShareRace';

export function RaceCard({ race, cta }: { race: RaceSummaryDto; cta?: React.ReactNode }) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card flex flex-col gap-3 transition hover:border-race/60"
    >
      <Link
        to={race.status === 'race' ? `/corridas/${race.id}/ao-vivo` : `/corridas/${race.id}`}
        aria-label={
          race.status === 'race' ? `Assistir ${race.name} ao vivo` : `Mapa da pista ${race.track.name}`
        }
        className="block"
      >
        <RaceMiniMap race={race} className="aspect-[16/8] w-full" />
      </Link>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/corridas/${race.id}`} className="font-display text-lg leading-tight hover:text-race">
            {race.name}
          </Link>
          <div className="mt-0.5 truncate text-xs text-muted">
            {race.category.name} · {LEVEL_LABELS[race.category.level]}{' '}
            {race.ranked ? '· Ranqueada' : '· Amistosa'}
          </div>
        </div>
        <PhaseBadge phase={race.status} />
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="chip">🛣️ {race.track.name}</span>
        <span className="chip">
          {fmtKm(race.track.length)} · {race.laps} voltas
        </span>
        <span className="chip">{TERRAIN_LABEL[race.track.terrain]}</span>
        <span className="chip" title={`Chance de chuva ${Math.round(race.weather.rainChance * 100)}%`}>
          {WEATHER_ICON[race.weather.base]} {WEATHER_LABEL[race.weather.base]} · {race.weather.temperature}°C
        </span>
      </div>
      <CapacityMeter cap={race.capacity} />
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="text-muted">
          {race.phaseDeadline ? (
            <>
              próxima fase em <Countdown to={race.phaseDeadline} className="text-ink" />
            </>
          ) : (
            <span>{fmtDateTime(race.timeline.practiceAt)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ShareRace race={race} compact />
          {cta ?? (
            <Link to={`/corridas/${race.id}`} className="btn-ghost !py-1.5">
              Detalhes
            </Link>
          )}
        </div>
      </div>
    </motion.article>
  );
}
