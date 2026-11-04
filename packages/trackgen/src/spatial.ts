/** Grade espacial simples para consultas de vizinhança na linha central. */
export class SpatialGrid {
  private cells = new Map<string, number[]>();
  constructor(
    private readonly pts: ArrayLike<number>,
    private readonly cell: number,
  ) {
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const k = this.key(pts[i * 2]!, pts[i * 2 + 1]!);
      const arr = this.cells.get(k);
      if (arr) arr.push(i);
      else this.cells.set(k, [i]);
    }
  }
  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }
  /** Índices de amostras dentro do raio r de (x,y). */
  query(x: number, y: number, r: number): number[] {
    const out: number[] = [];
    const c0x = Math.floor((x - r) / this.cell),
      c1x = Math.floor((x + r) / this.cell);
    const c0y = Math.floor((y - r) / this.cell),
      c1y = Math.floor((y + r) / this.cell);
    const r2 = r * r;
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cy = c0y; cy <= c1y; cy++) {
        const arr = this.cells.get(`${cx},${cy}`);
        if (!arr) continue;
        for (const i of arr) {
          const dx = this.pts[i * 2]! - x,
            dy = this.pts[i * 2 + 1]! - y;
          if (dx * dx + dy * dy <= r2) out.push(i);
        }
      }
    return out;
  }
}
