/**
 * Onde desenhar as zebras: só nas curvas fechadas, em faixas contínuas e do lado de dentro.
 *
 * A curvatura vem ponto a ponto da spline e oscila perto do limite, o que deixava zebras
 * falhadas. Aqui o limite tem histerese, buracos curtos entre trechos do mesmo lado são
 * preenchidos e trechos curtos demais são descartados. Só afeta o desenho: a geometria e o
 * hash da pista não mudam.
 */

/** Curvatura (1/raio) para a zebra começar: raio abaixo de 90 m. */
export const CURB_ON = 1 / 90;
/** Curvatura para a zebra terminar: raio acima de 120 m. */
export const CURB_OFF = 1 / 120;
/** Buracos com menos pontos que isso, entre zebras do mesmo lado, são preenchidos. */
export const CURB_MIN_GAP = 3;
/** Zebras com menos pontos que isso são descartadas. */
export const CURB_MIN_RUN = 3;

type Run = { start: number; len: number; side: number };

/** Trechos consecutivos de mesmo valor numa pista fechada (o último pode emendar no primeiro). */
function runs(s: Int8Array): Run[] {
  const n = s.length;
  let start = 0;
  while (start < n && s[(start - 1 + n) % n] === s[start]) start++;
  if (start === n) return [{ start: 0, len: n, side: s[0]! }];
  const out: Run[] = [];
  for (let k = 0; k < n;) {
    const i0 = (start + k) % n;
    let len = 1;
    while (k + len < n && s[(start + k + len) % n] === s[i0]) len++;
    out.push({ start: i0, len, side: s[i0]! });
    k += len;
  }
  return out;
}

function fill(s: Int8Array, r: Run, side: number) {
  for (let k = 0; k < r.len; k++) s[(r.start + k) % s.length] = side;
}

/**
 * Lado da zebra em cada segmento `i` (entre os pontos `i` e `i + 1`): `1` na borda esquerda
 * (lado da normal), `-1` na direita e `0` sem zebra. Curvatura positiva curva para o lado da
 * normal, então a zebra fica na borda esquerda, a de dentro.
 */
export function curbSides(curvature: ArrayLike<number>): Int8Array {
  const n = curvature.length;
  const s = new Int8Array(n);
  if (n === 0) return s;

  // Histerese: começa num ponto claramente fora de curva; se não houver, a pista é toda curva.
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (Math.abs(curvature[i]!) < CURB_OFF) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    for (let i = 0; i < n; i++) s[i] = Math.sign(curvature[i]!);
  } else {
    let side = 0;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      const c = curvature[i]!;
      const a = Math.abs(c);
      const sign = Math.sign(c);
      if (side !== 0 && (a < CURB_OFF || sign !== side)) side = 0;
      if (side === 0 && a >= CURB_ON) side = sign;
      s[i] = side;
    }
  }

  // Fecha buracos curtos entre zebras do mesmo lado.
  const r1 = runs(s);
  if (r1.length > 2) {
    for (let j = 0; j < r1.length; j++) {
      const r = r1[j]!;
      const prev = r1[(j - 1 + r1.length) % r1.length]!;
      const next = r1[(j + 1) % r1.length]!;
      if (r.side === 0 && r.len < CURB_MIN_GAP && prev.side !== 0 && prev.side === next.side) {
        fill(s, r, prev.side);
      }
    }
  }

  // Descarta zebras curtas demais.
  for (const r of runs(s)) if (r.side !== 0 && r.len < CURB_MIN_RUN) fill(s, r, 0);
  return s;
}
