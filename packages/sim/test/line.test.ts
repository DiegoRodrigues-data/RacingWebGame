import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP } from '@tracado/shared';
import { generateProceduralTrack, offsetsToTrace, suggestedLine } from '@tracado/trackgen';
import { estimateLap } from '../src';

describe('efeito do traçado', () => {
  it('a linha sugerida (fora–dentro–fora) é mais rápida que a linha central na maioria das pistas', () => {
    let better = 0;
    const N = 20;
    for (let i = 0; i < N; i++) {
      const g = generateProceduralTrack(`line-${i}`, {
        length: 2500,
        complexity: 0.6,
        width: 12,
        terrain: 'asphalt',
      });
      const center = estimateLap(
        g,
        DEFAULT_SETUP,
        offsetsToTrace(new Float64Array(g.count), 256),
        'dry',
        25,
        5,
      ).lapTimeMs;
      const ideal = estimateLap(
        g,
        DEFAULT_SETUP,
        offsetsToTrace(suggestedLine(g), 256),
        'dry',
        25,
        5,
      ).lapTimeMs;
      if (ideal < center) better++;
    }
    expect(better).toBeGreaterThanOrEqual(N * 0.8);
  });
});
