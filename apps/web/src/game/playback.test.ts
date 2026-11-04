import { describe, expect, it } from 'vitest';
import { FrameBuffer } from './playback';

describe('FrameBuffer', () => {
  const fb = new FrameBuffer();
  fb.put(0, [
    { t: 0, c: [0, 0, 0, 0, 1, 0] },
    { t: 1000, c: [10, 0, Math.PI - 0.1, 0.1, 1, 0] },
  ]);
  it('interpola posição linearmente', () => {
    const s = fb.sample(500, 1)![0]!;
    expect(s.x).toBeCloseTo(5);
    expect(s.progress).toBeCloseTo(0.05);
  });
  it('limita aos extremos', () => {
    expect(fb.sample(-100, 1)![0]!.x).toBe(0);
    expect(fb.sample(5000, 1)![0]!.x).toBe(10);
  });
  it('aceita frames que chegam fora de ordem (buracos)', () => {
    const b = new FrameBuffer();
    b.put(2, [{ t: 2000, c: [20, 0, 0, 0.2, 1, 0] }]);
    b.put(0, [{ t: 0, c: [0, 0, 0, 0, 1, 0] }]);
    expect(b.sample(1000, 1)![0]!.x).toBeCloseTo(10);
  });
  it('lê o desgaste de pneu e motor nos frames novos e deixa null nos antigos', () => {
    const novo = new FrameBuffer();
    novo.put(0, [{ t: 0, c: [0, 0, 0, 0, 1, 0, 42, 17, 5, 5, 0, 0, 2, 0, 80, 33] }]);
    const [a, b] = novo.sample(0, 2)!;
    expect(a).toMatchObject({ x: 0, tyreWear: 42, engineWear: 17 });
    expect(b).toMatchObject({ x: 5, tyre: 2, tyreWear: 80, engineWear: 33 });
    const antigo = new FrameBuffer();
    antigo.put(0, [{ t: 0, c: [0, 0, 0, 0, 1, 0, 5, 5, 0, 0, 2, 0] }]);
    const [c, d] = antigo.sample(0, 2)!;
    expect(c).toMatchObject({ tyreWear: null, engineWear: null });
    expect(d).toMatchObject({ x: 5, tyre: 2 });
  });
});
