import type { TrackGeometry } from '@tracado/trackgen';
import { useEffect, useRef, useState } from 'react';
import type { Biome } from '@tracado/shared';
import { TrackScene } from '../game/scene';

/** Cor de fundo de cada cenário (CSS), igual à do desenho da pista. */
export const BIOME_CSS: Record<Biome, string> = { grass: '#27ae60', desert: '#dcbb8a', canyon: '#a86b3a' };

/** Monta uma TrackScene no elemento e entrega a instância pronta via callback. */
export function TrackCanvas({
  geometry,
  onReady,
  className = '',
  label = 'Pista de corrida',
  biome = 'grass',
}: {
  geometry: TrackGeometry | null | undefined;
  /** Cenário em volta da pista. */
  biome?: Biome;
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
      scene.biome = biome;
      scene.setGeometry(geometry);
      onReady?.(scene);
    }
    // onReady é estável por contrato do chamador
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, geometry]);
  useEffect(() => {
    scene?.setBiome(biome);
  }, [scene, biome]);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={{ background: BIOME_CSS[biome] }}
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
