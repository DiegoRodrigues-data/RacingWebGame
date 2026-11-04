import { determinismProbe } from '@tracado/sim';
import { useMemo } from 'react';

/** Página de verificação: os mesmos insumos devem gerar os mesmos hashes no navegador e no Node (teste E2E). */
export default function Determinism() {
  const r = useMemo(determinismProbe, []);
  return (
    <div className="card">
      <h1 className="font-display text-xl">Determinismo</h1>
      <p className="text-sm text-muted">Hashes da pista e da simulação calculados neste navegador.</p>
      <pre data-testid="determinism" className="mt-2 overflow-auto font-mono text-sm">
        {JSON.stringify(r, null, 2)}
      </pre>
    </div>
  );
}
