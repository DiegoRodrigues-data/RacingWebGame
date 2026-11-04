import { TYRE_LABELS, type Tyre } from '@tracado/shared';
import { COEF } from '@tracado/sim';
import clsx from 'clsx';
import { CAR_CSS } from '../game/assets';
import { TYRE_COLOR, TYRE_SHORT, TYRES_BY_CODE } from '../lib/format';

/** Desgaste (%) a partir do qual o pneu perde rendimento rápido (o "penhasco" do modelo). */
export const TYRE_CLIFF_PCT = Math.round(COEF.cliffAt * 100);

export function tyreState(wear: number): { label: string; tone: string } {
  if (wear >= 100) return { label: 'risco de furo', tone: 'text-hot' };
  if (wear >= TYRE_CLIFF_PCT) return { label: 'no limite', tone: 'text-hot' };
  if (wear >= TYRE_CLIFF_PCT - 15) return { label: 'gasto', tone: 'text-race' };
  return { label: 'bom', tone: 'text-go' };
}

export function engineState(wear: number): { label: string; tone: string } {
  if (wear >= 90) return { label: 'no limite', tone: 'text-hot' };
  if (wear >= 70) return { label: 'gasto', tone: 'text-race' };
  if (wear >= 35) return { label: 'bom', tone: 'text-go' };
  return { label: 'novo', tone: 'text-go' };
}

/** Barra de desgaste: enche com o desgaste; a marca branca é o limite de rendimento do pneu. */
function WearBar({ value, color, mark }: { value: number; color: string; mark?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-night-3">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, background: color }}
      />
      {mark != null && (
        <span aria-hidden className="absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${mark}%` }} />
      )}
    </div>
  );
}

/** Mini barra de pneu para a classificação: cor do composto, enche com o desgaste, vermelha no limite. */
export function TyreWearMini({ tyreCode, wear }: { tyreCode: number; wear: number | null }) {
  const tyre = TYRES_BY_CODE[tyreCode] ?? 'medium';
  if (wear == null)
    return <span className="size-2.5 rounded-full" style={{ background: TYRE_COLOR[tyre] }} title={tyre} />;
  const over = wear >= TYRE_CLIFF_PCT;
  return (
    <span
      className="flex items-center gap-1"
      title={`${TYRE_LABELS[tyre]}: ${wear}% gasto${over ? ' (perdendo rendimento)' : ''}`}
    >
      <span
        className="grid size-4 place-items-center rounded-full text-[8px] font-black text-white"
        style={{ background: TYRE_COLOR[tyre] }}
      >
        {TYRE_SHORT[tyre]}
      </span>
      <span className="relative h-1.5 w-8 overflow-hidden rounded-full bg-night-3">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${Math.min(100, wear)}%`, background: over ? '#ff5a5a' : TYRE_COLOR[tyre] }}
        />
      </span>
    </span>
  );
}

export interface CarWearInfo {
  nickname: string;
  carColor: string;
  carNumber: number;
  position: number | null;
  tyreCode: number;
  tyreWear: number | null;
  engineWear: number | null;
  /** Voltas com o jogo de pneus atual. */
  stintLaps: number | null;
  status: number;
  isMe: boolean;
  nextStop?: { lap: number; tyre: Tyre } | null;
}

/** Painel do carro em foco: pneu (composto, desgaste, voltas no jogo) e motor (desgaste e estado). */
export function CarWearPanel({ info, className }: { info: CarWearInfo; className?: string }) {
  const tyre = TYRES_BY_CODE[info.tyreCode] ?? 'medium';
  const ts = info.tyreWear != null ? tyreState(info.tyreWear) : null;
  const es = info.engineWear != null ? engineState(info.engineWear) : null;
  return (
    <div className={clsx('card !p-3', className)}>
      <div className="flex items-center gap-2">
        <span
          className="grid size-7 place-items-center rounded-full text-[11px] font-black"
          style={{ background: CAR_CSS[info.carColor], color: info.carColor === 'yellow' ? '#111' : '#fff' }}
        >
          {info.carNumber}
        </span>
        <div className="min-w-0 flex-1">
          <div className="label !mb-0">{info.isMe ? 'Seu carro' : 'Carro em foco'}</div>
          <div className="truncate font-semibold">
            {info.position != null && <span className="text-muted">P{info.position} · </span>}
            {info.nickname}
          </div>
        </div>
        {info.status === 1 && <span className="chip !px-1.5 text-sky">NOS BOXES</span>}
        {info.status === 2 && <span className="chip !px-1.5 text-hot">ABANDONOU</span>}
        {info.status === 3 && <span>🏁</span>}
      </div>
      {info.tyreWear == null || info.engineWear == null ? (
        <p className="mt-2 text-xs text-muted">
          Esta corrida foi simulada antes do desgaste aparecer na transmissão.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-bold">
                <span
                  className="grid size-5 place-items-center rounded-full text-[9px] font-black text-white"
                  style={{ background: TYRE_COLOR[tyre] }}
                >
                  {TYRE_SHORT[tyre]}
                </span>
                Pneu {TYRE_LABELS[tyre].toLowerCase()}
                {info.stintLaps != null && (
                  <span className="font-normal text-muted">
                    · {info.stintLaps} {info.stintLaps === 1 ? 'volta' : 'voltas'}
                  </span>
                )}
              </span>
              <span className={clsx('font-mono', ts!.tone)}>
                {info.tyreWear}% · {ts!.label}
              </span>
            </div>
            <WearBar
              value={info.tyreWear}
              color={info.tyreWear >= TYRE_CLIFF_PCT ? '#ff5a5a' : TYRE_COLOR[tyre]}
              mark={TYRE_CLIFF_PCT}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-bold">🔧 Motor</span>
              <span className={clsx('font-mono', es!.tone)}>
                {info.engineWear}% · {es!.label}
              </span>
            </div>
            <WearBar
              value={info.engineWear}
              color={info.engineWear >= 90 ? '#ff5a5a' : info.engineWear >= 70 ? '#ffb020' : '#3ddc84'}
            />
          </div>
          {info.nextStop !== undefined && (
            <p className="text-xs text-muted">
              {info.nextStop
                ? `Próxima parada: fim da volta ${info.nextStop.lap}, ${TYRE_LABELS[info.nextStop.tyre].toLowerCase()}.`
                : 'Sem mais paradas planejadas.'}
            </p>
          )}
          <p className="text-[11px] leading-snug text-muted">
            O pneu perde rendimento depois de {TYRE_CLIFF_PCT}% (marca branca) e pode furar acima de 100%.
            Motor gasto quebra com mais facilidade.
          </p>
        </div>
      )}
    </div>
  );
}
