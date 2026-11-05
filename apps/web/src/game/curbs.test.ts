import { describe, expect, it } from 'vitest';
import { CURB_OFF, CURB_ON, curbSides } from './curbs';

const STRAIGHT = 0;
const TIGHT = CURB_ON * 1.5;
const MID = (CURB_ON + CURB_OFF) / 2; // entre os dois limites

const sides = (k: number[]) => Array.from(curbSides(k));

describe('curbSides', () => {
  it('retas e curvas abertas ficam sem zebra', () => {
    expect(sides(Array(20).fill(STRAIGHT))).toEqual(Array(20).fill(0));
    expect(sides(Array(20).fill(CURB_OFF * 0.9))).toEqual(Array(20).fill(0));
  });

  it('zebra fica do lado de dentro da curva', () => {
    const k = [0, 0, TIGHT, TIGHT, TIGHT, TIGHT, 0, 0, -TIGHT, -TIGHT, -TIGHT, -TIGHT, 0, 0];
    expect(sides(k)).toEqual([0, 0, 1, 1, 1, 1, 0, 0, -1, -1, -1, -1, 0, 0]);
  });

  it('histerese: não desliga enquanto a curvatura fica entre os limites', () => {
    const k = [0, 0, TIGHT, MID, MID, TIGHT, MID, 0, 0, 0];
    expect(sides(k)).toEqual([0, 0, 1, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('não liga com curvatura entre os limites vinda de reta', () => {
    expect(sides([0, 0, MID, MID, MID, MID, 0, 0])).toEqual(Array(8).fill(0));
  });

  it('preenche buraco curto entre zebras do mesmo lado', () => {
    const k = [0, 0, TIGHT, TIGHT, TIGHT, 0, 0, TIGHT, TIGHT, TIGHT, 0, 0, 0, 0];
    expect(sides(k)).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it('não preenche buraco entre lados opostos', () => {
    const k = [0, 0, TIGHT, TIGHT, TIGHT, 0, -TIGHT, -TIGHT, -TIGHT, 0, 0, 0];
    expect(sides(k)).toEqual([0, 0, 1, 1, 1, 0, -1, -1, -1, 0, 0, 0]);
  });

  it('descarta zebra curta demais', () => {
    expect(sides([0, 0, 0, TIGHT, TIGHT, 0, 0, 0, 0, 0])).toEqual(Array(10).fill(0));
  });

  it('trata a pista como fechada (zebra que cruza o fim emenda no começo)', () => {
    const k = [TIGHT, TIGHT, 0, 0, 0, 0, 0, 0, TIGHT, TIGHT];
    expect(sides(k)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('pista toda em curva fica com zebra em toda a volta', () => {
    expect(sides(Array(12).fill(TIGHT))).toEqual(Array(12).fill(1));
  });
});
