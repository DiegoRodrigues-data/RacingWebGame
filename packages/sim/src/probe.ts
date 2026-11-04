import { DEFAULT_SETUP } from '@tracado/shared';
import { generateProceduralTrack, offsetsToTrace, suggestedLine } from '@tracado/trackgen';
import { simulateRace } from './race';

/** Entradas fixas cujos hashes devem ser idênticos em qualquer runtime (Node e navegadores). */
export function determinismProbe() {
  const g = generateProceduralTrack('determinismo', {
    length: 2400,
    complexity: 0.6,
    width: 12,
    terrain: 'mixed',
  });
  const trace = offsetsToTrace(suggestedLine(g), 256);
  const out = simulateRace({
    geometry: g,
    cars: [
      { id: 'a', setup: DEFAULT_SETUP, trace },
      {
        id: 'b',
        setup: { ...DEFAULT_SETUP, tyre: 'soft', pitStops: [{ lap: 2, tyre: 'hard' }] },
        trace: null,
      },
      { id: 'c', setup: { ...DEFAULT_SETUP, aero: 9, engine: 'power' }, trace },
    ],
    laps: 4,
    seed: 'determinismo',
    weather: { base: 'cloudy', rainChance: 0.5, temperature: 21 },
    randomEvents: { safetyCar: true, oil: true, mechanical: true },
  });
  return {
    trackHash: g.hash,
    resultHash: out.resultHash,
    inputHash: out.inputHash,
    durationMs: out.durationMs,
  };
}
