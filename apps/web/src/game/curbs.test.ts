import { describe, expect, it } from 'vitest';
import { CURB_OFF, CURB_ON, curbMask } from './curbs';

const T = CURB_ON * 1.5; // curva fechada
const MID = (CURB_ON + CURB_OFF) / 2; // entre os dois limites

const mask = (k: number[]) => Array.from(curbMask(k));

describe('curbMask', () => {
  it('retas e curvas abertas ficam com faixa branca', () => {
    expect(mask(Array(20).fill(0))).toEqual(Array(20).fill(0));
    expect(mask(Array(20).fill(CURB_OFF * 0.9))).toEqual(Array(20).fill(0));
  });

  it('curvas para os dois lados ganham zebra', () => {
    const k = [0, 0, T, T, T, T, 0, 0, 0, -T, -T, -T, -T, 0, 0];
    expect(mask(k)).toEqual([0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0]);
  });

  it('histerese: não desliga enquanto a curvatura fica entre os limites', () => {
    expect(mask([0, 0, T, MID, MID, T, MID, 0, 0, 0])).toEqual([0, 0, 1, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('não liga com curvatura entre os limites vinda de reta', () => {
    expect(mask([0, 0, MID, MID, MID, MID, 0, 0])).toEqual(Array(8).fill(0));
  });

  it('preenche buraco curto entre zebras, inclusive em chicane', () => {
    const k = [0, 0, T, T, T, 0, 0, -T, -T, -T, 0, 0, 0, 0];
    expect(mask(k)).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it('descarta zebra curta demais', () => {
    expect(mask([0, 0, 0, T, T, 0, 0, 0, 0, 0])).toEqual(Array(10).fill(0));
  });

  it('trata a pista como fechada (zebra que cruza o fim emenda no começo)', () => {
    expect(mask([T, T, 0, 0, 0, 0, 0, 0, T, T])).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('pista toda em curva fica com zebra em toda a volta', () => {
    expect(mask(Array(12).fill(T))).toEqual(Array(12).fill(1));
  });
});
