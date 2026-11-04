import type { Terrain, TrackSource, TrackTerrain } from '@tracado/shared';

export const GENERATOR_VERSION = 1;
/** Espaçamento alvo entre amostras da linha central (m). */
export const SAMPLE_SPACING = 5;

export interface GridSlot {
  x: number;
  y: number;
  heading: number;
  index: number;
}

export interface Decoration {
  kind:
    | 'tree_large'
    | 'tree_small'
    | 'tribune_full'
    | 'tribune_empty'
    | 'tires_red'
    | 'tires_white'
    | 'barrier_red_race'
    | 'barrier_white_race'
    | 'tent_blue'
    | 'tent_red'
    | 'cone_straight'
    | 'rock1'
    | 'rock2'
    | 'barrel_red'
    | 'barrel_blue';
  x: number;
  y: number;
  rot: number;
  scale: number;
}

export interface TrackGeometry {
  generatorVersion: number;
  source: TrackSource;
  name?: string;
  length: number;
  count: number;
  ds: number;
  /** x0,y0,x1,y1... da linha central; índice 0 = linha de largada/chegada. */
  points: number[];
  /** Normal à esquerda do sentido de corrida (unitária). */
  normals: number[];
  widths: number[];
  /** Curvatura com sinal (1/m). Positiva = curva à esquerda. */
  curvature: number[];
  terrain: Terrain[];
  terrainSegments: { from: number; to: number; terrain: Terrain }[];
  baseTerrain: TrackTerrain;
  sectors: number[];
  grid: GridSlot[];
  pit: { side: 1 | -1; entryIndex: number; exitIndex: number; lane: number[]; boxIndex: number };
  /** Bordas esquerda e direita (x,y planos). */
  left: number[];
  right: number[];
  decorations: Decoration[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  corners: number;
  minRadius: number;
  attempt: number;
  hash: string;
}

export interface ValidationIssue {
  code:
    | 'LENGTH'
    | 'MIN_RADIUS'
    | 'PROXIMITY'
    | 'CORNERS'
    | 'START_STRAIGHT'
    | 'PIT_CLEARANCE'
    | 'WIDTH'
    | 'POINTS';
  message: string;
  /** Posição aproximada para destacar no editor. */
  at?: { x: number; y: number };
}
