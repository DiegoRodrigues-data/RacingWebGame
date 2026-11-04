import { describe, expect, it } from 'vitest';
import type { TrackParams } from '@tracado/shared';
import {
  buildEditorTrack,
  createRng,
  generateProceduralTrack,
  geometryFromSource,
  hashGeometry,
  validateGeometry,
} from '../src';

const P: TrackParams = { length: 3000, complexity: 0.6, width: 12, terrain: 'asphalt' };

describe('PRNG', () => {
  it('é determinístico por seed', () => {
    const a = createRng('abc'),
      b = createRng('abc'),
      c = createRng('abd');
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(sa);
  });
});

describe('geração procedural', () => {
  it('mesma seed + params ⇒ mesma geometria e mesmo hash', () => {
    const a = generateProceduralTrack('copa-2026', P);
    const b = generateProceduralTrack('copa-2026', P);
    expect(a.hash).toBe(b.hash);
    expect(a.points).toEqual(b.points);
    expect(hashGeometry(a)).toBe(a.hash);
  });

  it('seed diferente ⇒ pista diferente', () => {
    expect(generateProceduralTrack('a', P).hash).not.toBe(generateProceduralTrack('b', P).hash);
  });

  it('hash de referência fixo para a versão 1 do gerador (detecta mudança acidental de algoritmo)', () => {
    const g = generateProceduralTrack('golden', {
      length: 2500,
      complexity: 0.5,
      width: 12,
      terrain: 'mixed',
    });
    expect(g.hash).toMatchSnapshot();
    expect(g.generatorVersion).toBe(1);
  });

  it('reconstrói a partir da origem persistida (auditoria/replay)', () => {
    const g = generateProceduralTrack('audit', P);
    expect(geometryFromSource(g.source).hash).toBe(g.hash);
  });

  it('1.000 seeds geram pistas válidas com metadados completos', () => {
    for (let i = 0; i < 1000; i++) {
      const params: TrackParams = {
        length: [1200, 2000, 3000, 4500][i % 4]!,
        complexity: (i % 7) / 6,
        width: 10 + (i % 3) * 2,
        terrain: (['asphalt', 'dirt', 'sand', 'mixed'] as const)[i % 4]!,
      };
      const g = generateProceduralTrack(`seed-${i}`, params);
      expect(validateGeometry(g, { targetLength: params.length })).toEqual([]);
      expect(g.grid).toHaveLength(22);
      expect(g.sectors).toHaveLength(3);
      expect(g.pit.lane.length).toBeGreaterThan(10);
      expect(g.terrain).toHaveLength(g.count);
    }
  }, 60_000);
});

describe('validação', () => {
  it('detecta pista que se cruza (figura em 8)', () => {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      pts.push({ x: Math.sin(t) * 400, y: Math.sin(t) * Math.cos(t) * 300, width: 12 });
    }
    const g = buildEditorTrack({
      controlPoints: pts,
      terrainSegments: [],
      baseTerrain: 'asphalt',
      startAt: 0,
      decorationSeed: 'x',
    });
    expect(validateGeometry(g).map((i) => i.code)).toContain('PROXIMITY');
  });

  it('detecta curva fechada demais e falta de reta de largada', () => {
    const g = buildEditorTrack({
      controlPoints: [
        { x: 0, y: 0, width: 12 },
        { x: 30, y: 0, width: 12 },
        { x: 30, y: 30, width: 12 },
        { x: 0, y: 30, width: 12 },
      ],
      terrainSegments: [],
      baseTerrain: 'asphalt',
      startAt: 0,
      decorationSeed: 'x',
    });
    const codes = validateGeometry(g).map((i) => i.code);
    expect(codes).toContain('LENGTH');
    expect(codes).toContain('MIN_RADIUS');
  });

  it('aceita uma pista especial bem formada do editor', () => {
    const ctrl = [
      [0, 0],
      [300, 0],
      [500, 0],
      [560, 40],
      [560, 120],
      [480, 160],
      [380, 160],
      [330, 220],
      [360, 300],
      [300, 360],
      [120, 360],
      [40, 300],
      [60, 200],
      [-40, 120],
      [-60, 40],
    ].map(([x, y]) => ({ x: x!, y: y!, width: 12 }));
    const g = buildEditorTrack({
      controlPoints: ctrl,
      terrainSegments: [{ from: 0.4, to: 0.6, terrain: 'dirt' }],
      baseTerrain: 'asphalt',
      startAt: 0.08,
      decorationSeed: 'esp',
    });
    expect(validateGeometry(g)).toEqual([]);
    expect(g.terrain.includes('dirt')).toBe(true);
    expect(buildEditorTrack(g.source.type === 'editor' ? g.source.editor : (null as never)).hash).toBe(
      g.hash,
    );
  });
});
