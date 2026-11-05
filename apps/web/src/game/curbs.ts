/**
 * Onde desenhar as zebras: só nas curvas fechadas, em faixas contínuas. No resto da pista a
 * borda fica com uma faixa branca lisa, que cansa menos a vista em alta velocidade.
 *
 * A curvatura vem ponto a ponto da spline e oscila perto do limite, o que deixava zebras
 * falhadas. Aqui o limite tem histerese, buracos curtos entre zebras são preenchidos e
 * zebras curtas demais são descartadas. Só afeta o desenho: a geometria e o hash da pista
 * não mudam.
 */

/** Curvatura (1/raio) para a zebra começar: raio abaixo de 90 m. */
export const CURB_ON = 1 / 90;
/** Curvatura para a zebra terminar: raio acima de 120 m. */
export const CURB_OFF = 1 / 120;
/** Buracos com menos pontos que isso, entre duas zebras, são preenchidos. */
export const CURB_MIN_GAP = 3;
/** Zebras com menos pontos que isso são descartadas. */
export const CURB_MIN_RUN = 3;

type Run = { start: number; len: number; on: number };

/** Trechos consecutivos de mesmo valor numa pista fechada (o último pode emendar no primeiro). */
function runs(m: Uint8Array): Run[] {
  const n = m.length;
  let start = 0;
  while (start < n && m[(start - 1 + n) % n] === m[start]) start++;
  if (start === n) return [{ start: 0, len: n, on: m[0]! }];
  const out: Run[] = [];
  for (let k = 0; k < n;) {
    const i0 = (start + k) % n;
    let len = 1;
    while (k + len < n && m[(start + k + len) % n] === m[i0]) len++;
    out.push({ start: i0, len, on: m[i0]! });
    k += len;
  }
  return out;
}

function fill(m: Uint8Array, r: Run, on: number) {
  for (let k = 0; k < r.len; k++) m[(r.start + k) % m.length] = on;
}

/** `1` nos segmentos com zebra (entre os pontos `i` e `i + 1`), `0` nos de faixa branca. */
export function curbMask(curvature: ArrayLike<number>): Uint8Array {
  const n = curvature.length;
  const m = new Uint8Array(n);
  if (n === 0) return m;

  // Histerese: começa num ponto claramente fora de curva; se não houver, a pista é toda curva.
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (Math.abs(curvature[i]!) < CURB_OFF) {
      start = i;
      break;
    }
  }
  if (start < 0) return m.fill(1);
  let on = 0;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const a = Math.abs(curvature[i]!);
    on = on ? (a >= CURB_OFF ? 1 : 0) : a >= CURB_ON ? 1 : 0;
    m[i] = on;
  }

  // Fecha buracos curtos entre zebras e descarta zebras curtas demais.
  for (const r of runs(m)) if (!r.on && r.len < CURB_MIN_GAP && r.len < n) fill(m, r, 1);
  for (const r of runs(m)) if (r.on && r.len < CURB_MIN_RUN) fill(m, r, 0);
  return m;
}
