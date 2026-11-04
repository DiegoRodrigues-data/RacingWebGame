import type { TrackGeometry } from '@tracado/trackgen';
import { useEffect, useRef, useState } from 'react';
import { TrackScene } from '../game/scene';

/** Monta uma TrackScene no elemento e entrega a instância pronta via callback. */
export function TrackCanvas({
  geometry,
  onReady,
  className = '',
  label = 'Pista de corrida',
}: {
  geometry: TrackGeometry | null | undefined;
  onReady?: (scene: TrackScene) => void;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<TrackScene | null>(null);
  useEffect(() => {
    const s = new TrackScene();
    let alive = true;
    void s.init(ref.current!).then(() => alive && setScene(s));
    return () => {
      alive = false;
      s.destroy();
    };
  }, []);
  useEffect(() => {
    if (scene && geometry) {
      scene.setGeometry(geometry);
      onReady?.(scene);
    }
    // onReady é estável por contrato do chamador
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, geometry]);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={`relative overflow-hidden rounded-2xl bg-grass ${className}`}
    >
      {!geometry && (
        <div className="absolute inset-0 grid place-items-center text-sm font-bold text-night/70">
          Carregando pista…
        </div>
      )}
    </div>
  );
}

/** Botões flutuantes de câmera. */
export function CameraControls({ scene, extra }: { scene: TrackScene | null; extra?: React.ReactNode }) {
  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 flex flex-col gap-2">
      {extra}
      <button
        className="btn-ghost size-10 !p-0 text-lg"
        aria-label="Aproximar"
        onClick={() => scene?.setZoom(scene.zoom * 1.4)}
      >
        +
      </button>
      <button
        className="btn-ghost size-10 !p-0 text-lg"
        aria-label="Afastar"
        onClick={() => scene?.setZoom(scene.zoom / 1.4)}
      >
        −
      </button>
      <button
        className="btn-ghost size-10 !p-0 text-xs"
        aria-label="Enquadrar pista"
        onClick={() => {
          if (!scene) return;
          // Ver a pista inteira: para de seguir um carro.
          scene.followId = null;
          scene.onUserCamera?.();
          scene.fit();
        }}
      >
        ⤢
      </button>
    </div>
  );
}
