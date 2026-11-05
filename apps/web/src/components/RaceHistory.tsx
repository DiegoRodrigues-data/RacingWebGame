import type { RaceSummaryDto } from '@tracado/shared';
import clsx from 'clsx';
import { useState } from 'react';
import { Link } from 'react-router';

const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Uma linha do histórico: data, nome, pista e o link do resultado (ou "cancelada"). */
function Row({ r }: { r: RaceSummaryDto }) {
  const cancelled = r.status === 'cancelled';
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="w-24 shrink-0 font-mono text-xs text-muted">{when(r.timeline.practiceAt)}</span>
      <div className="min-w-0 flex-1">
        <Link to={`/corridas/${r.id}`} className="block truncate font-semibold hover:text-race">
          {r.crazy && <span title={`Corrida Maluca · ${r.crazy.groupName}`}>🤪 </span>}
          {r.name}
        </Link>
        <div className="truncate text-xs text-muted">
          {r.track.name} · {r.laps} voltas{r.ranked ? ' · ranqueada' : ''}
        </div>
      </div>
      {cancelled ? (
        <span className="chip shrink-0 border-hot/60 text-hot">Cancelada</span>
      ) : (
        <Link to={`/corridas/${r.id}/resultado`} className="btn-ghost shrink-0 !px-3 !py-1 text-xs">
          Resultado
        </Link>
      )}
    </li>
  );
}

/**
 * Histórico compacto de corridas encerradas: uma linha por corrida. Com `collapsed`, mostra só as `preview`
 * primeiras e um botão para ver o resto (para não ocupar a tela).
 */
export function RaceHistory({
  races,
  preview,
  className,
}: {
  races: RaceSummaryDto[];
  preview?: number;
  className?: string;
}) {
  const [all, setAll] = useState(false);
  if (!races.length) return null;
  const shown = preview && !all ? races.slice(0, preview) : races;
  return (
    <div className={clsx('card !p-0', className)}>
      <ul className="divide-y divide-line/60">
        {shown.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </ul>
      {preview != null && races.length > preview && (
        <button
          className="w-full border-t border-line/60 py-2 text-sm font-bold text-muted hover:text-ink"
          onClick={() => setAll((v) => !v)}
        >
          {all ? 'Mostrar menos' : `Ver todas (${races.length})`}
        </button>
      )}
    </div>
  );
}
