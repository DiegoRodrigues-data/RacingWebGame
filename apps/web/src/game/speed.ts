/**
 * Velocidade de um carro a partir das posições que a tela desenha (frames interpolados ou a volta do treino).
 * Os frames chegam a 4 Hz, então a velocidade entre dois quadros oscila: o valor exibido é suavizado.
 */
export class SpeedTracker {
  private prev: { id: string; x: number; y: number; t: number } | null = null;
  private fresh = true;
  /** Velocidade suavizada (km/h). */
  kmh = 0;

  /**
   * Registra a posição do carro `id` no instante `t` (ms simulados) e devolve a velocidade crua deste passo (m/s),
   * ou null quando não dá para medir (outro carro, pausa, replay arrastado).
   */
  push(id: string, x: number, y: number, t: number): number | null {
    const p = this.prev;
    this.prev = { id, x, y, t };
    if (!p || p.id !== id) {
      this.fresh = true;
      return null;
    }
    const dt = t - p.t;
    if (dt === 0) return null; // pausado: mantém o valor
    if (dt < 0 || dt > 2000) {
      this.fresh = true; // pulo no tempo: recomeça a média
      return null;
    }
    const v = Math.hypot(x - p.x, y - p.y) / (dt / 1000);
    const kmh = v * 3.6;
    this.kmh = this.fresh ? kmh : this.kmh + (kmh - this.kmh) * (1 - Math.exp(-dt / 300));
    this.fresh = false;
    return v;
  }
}
