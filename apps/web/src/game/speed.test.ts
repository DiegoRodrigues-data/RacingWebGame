import { describe, expect, it } from 'vitest';
import { SpeedTracker } from './speed';

describe('SpeedTracker', () => {
  it('mede a velocidade pela distância entre quadros e suaviza', () => {
    const s = new SpeedTracker();
    expect(s.push('a', 0, 0, 0)).toBeNull();
    expect(s.push('a', 25, 0, 1000)).toBeCloseTo(25); // 25 m/s
    expect(s.kmh).toBeCloseTo(90);
    s.push('a', 75, 0, 2000); // 50 m/s = 180 km/h: a média sobe, sem pular
    expect(s.kmh).toBeGreaterThan(90);
    expect(s.kmh).toBeLessThan(180);
  });

  it('pausa mantém o valor; troca de carro e pulo no tempo recomeçam', () => {
    const s = new SpeedTracker();
    s.push('a', 0, 0, 0);
    s.push('a', 25, 0, 1000);
    expect(s.push('a', 25, 0, 1000)).toBeNull();
    expect(s.kmh).toBeCloseTo(90);
    expect(s.push('b', 500, 0, 1000)).toBeNull();
    s.push('b', 510, 0, 1500); // 20 m/s, sem média com o carro anterior
    expect(s.kmh).toBeCloseTo(72);
    expect(s.push('b', 9000, 0, 60_000)).toBeNull(); // replay arrastado
    s.push('b', 9010, 0, 61_000);
    expect(s.kmh).toBeCloseTo(36);
  });
});
