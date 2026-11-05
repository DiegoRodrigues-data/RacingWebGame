import type { Biome, Terrain } from '@tracado/shared';
import type { TrackGeometry } from '@tracado/trackgen';
import { Application, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { CAR_HEX, loadAtlases, type Atlases } from './assets';
import { curbSides } from './curbs';

/** 1 m em pixels dos sprites do racing_pack (carro de 131 px ≈ 5 m). */
const PX_PER_M = 26.2;
/** Comprimento do sprite do carro (px no atlas) e tamanho mínimo dele na tela. */
const CAR_SPRITE_PX = 131;
const CAR_MIN_PX = 30;
const TERRAIN_COLOR: Record<Terrain, number> = { asphalt: 0xa6c9cb, dirt: 0xbb8044, sand: 0xecdcb8 };
const GRASS = 0x27ae60;

/**
 * Cenários (cores do Racing Pack): fundo, pintas de textura e troca de decoração. As árvores do gerador viram
 * pedras e barris no deserto e no cânion (a posição continua a mesma, então nada muda na pista).
 */
export const BIOME_STYLE: Record<
  Biome,
  { ground: number; stripes: boolean; speckles: number[]; deco: Partial<Record<string, string>> }
> = {
  grass: { ground: GRASS, stripes: true, speckles: [], deco: {} },
  desert: {
    ground: 0xdcbb8a,
    stripes: false,
    speckles: [0xc5935d, 0xe9d9b5],
    deco: { tree_large: 'rock1', tree_small: 'rock3' },
  },
  canyon: {
    ground: 0xa86b3a,
    stripes: false,
    speckles: [0x8e5a30, 0xc58d55],
    deco: { tree_large: 'rock2', tree_small: 'barrel_red' },
  },
};

export interface CarView {
  id: string;
  x: number;
  y: number;
  heading: number;
  color: string;
  model: number;
  number: number;
  highlight?: boolean;
  status?: number;
  label?: string;
}

interface LineSpec {
  points: ArrayLike<number>;
  color: number;
  widthPx: number;
  alpha: number;
  closed: boolean;
  colors?: number[];
}

export interface Marker {
  x: number;
  y: number;
  color: number;
  /** Raio em pixels de tela (constante com o zoom). */
  r: number;
  stroke?: number;
  ring?: number;
}

export type PointerMode = 'pan' | 'draw';
export interface ScenePointerEvent {
  type: 'down' | 'move' | 'up' | 'cancel';
  x: number;
  y: number;
}

/** Cena da pista em PixiJS. O mundo usa metros; a câmera converte para pixels. */
export class TrackScene {
  app = new Application();
  private world = new Container();
  private ground = new Graphics();
  private road = new Container();
  private deco = new Container();
  private lines = new Container();
  private cars = new Container();
  private overlay = new Container();
  private lineSpecs = new Map<string, { spec: LineSpec; g: Graphics }>();
  private markers = new Map<string, { pts: Marker[]; g: Graphics }>();
  private carNodes = new Map<
    string,
    { root: Container; sprite: Sprite; badge: Container; ring: Graphics; look: string }
  >();
  private atlases: Atlases | null = null;
  private el: HTMLElement | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number; cx: number; cy: number } | null = null;
  private dragging: { x: number; y: number } | null = null;
  private drawingId: number | null = null;
  private destroyed = false;
  private dirtyZoom = false;
  geometry: TrackGeometry | null = null;
  zoom = 1;
  mode: PointerMode = 'pan';
  followId: string | null = null;
  onPointer: ((e: ScenePointerEvent) => void) | null = null;
  /**
   * No modo 'draw', decide se o toque em (x, y) do mundo pega algo editável (ex.: um ponto de controle).
   * Se devolver false, o arraste move a câmera. Também define o cursor ao passar o mouse.
   */
  grabTest: ((x: number, y: number) => boolean) | null = null;
  onFrame: ((dtMs: number) => void) | null = null;
  onUserCamera: (() => void) | null = null;

  async init(el: HTMLElement) {
    this.el = el;
    await this.app.init({
      resizeTo: el,
      background: BIOME_STYLE[this.biome].ground,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    el.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';
    this.app.canvas.style.display = 'block';
    this.world.addChild(this.ground, this.road, this.deco, this.lines, this.cars, this.overlay);
    this.app.stage.addChild(this.world);
    this.atlases = await loadAtlases();
    this.bindInput(this.app.canvas);
    this.app.ticker.add((t) => {
      this.onFrame?.(t.deltaMS);
      if (this.followId) {
        const n = this.carNodes.get(this.followId);
        if (n) this.centerOn(n.root.x, n.root.y, true);
      }
      if (this.dirtyZoom) {
        this.dirtyZoom = false;
        this.redrawScaled();
      }
    });
  }

  destroy() {
    this.destroyed = true;
    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* ainda não inicializado */
    }
  }

  // ------------------------------------------------------------------ Câmera
  private get size() {
    return {
      w: this.app.renderer?.width / this.app.renderer.resolution || 1,
      h: this.app.renderer?.height / this.app.renderer.resolution || 1,
    };
  }
  setZoom(z: number, ax?: number, ay?: number) {
    const { w, h } = this.size;
    const cx = ax ?? w / 2,
      cy = ay ?? h / 2;
    const wx = (cx - this.world.x) / this.zoom,
      wy = (cy - this.world.y) / this.zoom;
    this.zoom = Math.max(0.05, Math.min(40, z));
    this.world.scale.set(this.zoom);
    this.world.x = cx - wx * this.zoom;
    this.world.y = cy - wy * this.zoom;
    this.dirtyZoom = true;
  }
  centerOn(x: number, y: number, smooth = false) {
    const { w, h } = this.size;
    const tx = w / 2 - x * this.zoom,
      ty = h / 2 - y * this.zoom;
    if (smooth) {
      this.world.x += (tx - this.world.x) * 0.15;
      this.world.y += (ty - this.world.y) * 0.15;
    } else {
      this.world.x = tx;
      this.world.y = ty;
    }
  }
  fit(padding = 40) {
    const g = this.geometry;
    if (!g) return;
    const { w, h } = this.size;
    const bw = g.bounds.maxX - g.bounds.minX + 60,
      bh = g.bounds.maxY - g.bounds.minY + 60;
    this.zoom = Math.max(0.05, Math.min((w - padding * 2) / bw, (h - padding * 2) / bh));
    this.world.scale.set(this.zoom);
    this.centerOn((g.bounds.minX + g.bounds.maxX) / 2, (g.bounds.minY + g.bounds.maxY) / 2);
    this.dirtyZoom = true;
  }
  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.world.x) / this.zoom, y: (sy - this.world.y) / this.zoom };
  }

  private bindInput(c: HTMLCanvasElement) {
    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = local(e);
        this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
        this.followId = null;
        this.onUserCamera?.();
      },
      { passive: false },
    );
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        if (this.drawingId !== null) {
          this.onPointer?.({ type: 'cancel', x: 0, y: 0 });
          this.drawingId = null;
        }
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: this.zoom,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        };
        this.dragging = null;
        return;
      }
      const w = this.screenToWorld(p.x, p.y);
      if (this.mode === 'draw' && e.button === 0 && (!this.grabTest || this.grabTest(w.x, w.y))) {
        this.drawingId = e.pointerId;
        c.style.cursor = this.grabTest ? 'grabbing' : '';
        this.onPointer?.({ type: 'down', ...w });
      } else {
        this.dragging = p;
        c.style.cursor = 'move';
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse' && this.mode === 'draw' && this.grabTest) {
          const p = local(e);
          const w = this.screenToWorld(p.x, p.y);
          c.style.cursor = this.grabTest(w.x, w.y) ? 'grab' : '';
        }
        return;
      }
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2,
          cy = (a.y + b.y) / 2;
        this.world.x += cx - this.pinch.cx;
        this.world.y += cy - this.pinch.cy;
        this.pinch.cx = cx;
        this.pinch.cy = cy;
        this.setZoom((this.pinch.zoom * d) / this.pinch.dist, cx, cy);
        this.followId = null;
        this.onUserCamera?.();
        return;
      }
      if (this.drawingId === e.pointerId) {
        const w = this.screenToWorld(p.x, p.y);
        this.onPointer?.({ type: 'move', ...w });
      } else if (this.dragging) {
        this.world.x += p.x - this.dragging.x;
        this.world.y += p.y - this.dragging.y;
        this.dragging = p;
        this.followId = null;
        this.onUserCamera?.();
      }
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.drawingId === e.pointerId) {
        const p = local(e);
        this.onPointer?.({ type: 'up', ...this.screenToWorld(p.x, p.y) });
        this.drawingId = null;
      }
      if (!this.pointers.size) {
        this.dragging = null;
        c.style.cursor = '';
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  // ------------------------------------------------------------------ Pista
  /** Cenário em volta da pista; redesenha se a pista já estiver na tela. */
  biome: Biome = 'grass';
  setBiome(b: Biome) {
    if (b === this.biome) return;
    this.biome = b;
    if (this.geometry) this.setGeometry(this.geometry, false);
  }

  setGeometry(g: TrackGeometry, fit = true) {
    this.geometry = g;
    const style = BIOME_STYLE[this.biome];
    this.app.renderer.background.color = style.ground;
    this.ground.clear();
    this.road.removeChildren().forEach((c) => c.destroy());
    this.deco.removeChildren().forEach((c) => c.destroy());
    const b = g.bounds,
      m = 400;
    this.ground
      .rect(b.minX - m, b.minY - m, b.maxX - b.minX + 2 * m, b.maxY - b.minY + 2 * m)
      .fill({ color: style.ground });
    if (style.stripes)
      // Faixas de grama "aparada".
      for (let x = b.minX - m; x < b.maxX + m; x += 40)
        this.ground.rect(x, b.minY - m, 20, b.maxY - b.minY + 2 * m).fill({ color: 0x000000, alpha: 0.035 });
    if (style.speckles.length) {
      // Pintas de areia/terra (posições fixas pela pista, sem aleatoriedade entre telas).
      let seed = Number.parseInt(g.hash.slice(0, 8), 16) || 1;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const w = b.maxX - b.minX + 2 * m,
        h = b.maxY - b.minY + 2 * m;
      const count = Math.min(4000, Math.round((w * h) / 900));
      for (let k = 0; k < count; k++) {
        const r = 1.5 + rnd() * 5;
        this.ground
          .ellipse(b.minX - m + rnd() * w, b.minY - m + rnd() * h, r, r * (0.5 + rnd() * 0.5))
          .fill({ color: style.speckles[k % style.speckles.length]!, alpha: 0.35 });
      }
    }

    const n = g.count;
    const L = (i: number) => [g.left[(i % n) * 2]!, g.left[(i % n) * 2 + 1]!] as const;
    const R = (i: number) => [g.right[(i % n) * 2]!, g.right[(i % n) * 2 + 1]!] as const;
    const P = (i: number) => [g.points[(i % n) * 2]!, g.points[(i % n) * 2 + 1]!] as const;
    const N = (i: number) => [g.normals[(i % n) * 2]!, g.normals[(i % n) * 2 + 1]!] as const;

    // Boxes (por baixo da pista).
    const pit = new Graphics();
    const lane = g.pit.lane;
    pit.moveTo(lane[0]!, lane[1]!);
    for (let k = 2; k < lane.length; k += 2) pit.lineTo(lane[k]!, lane[k + 1]!);
    pit.stroke({ width: 8, color: 0xffffff, cap: 'round', join: 'round' });
    pit.moveTo(lane[0]!, lane[1]!);
    for (let k = 2; k < lane.length; k += 2) pit.lineTo(lane[k]!, lane[k + 1]!);
    pit.stroke({ width: 7, color: 0x8fb3b5, cap: 'round', join: 'round' });
    this.road.addChild(pit);
    const mid = Math.floor(lane.length / 4) * 2;
    const pitText = new Text({
      text: 'PIT',
      style: new TextStyle({ fontFamily: 'Russo One', fontSize: 64, fill: 0xffffff }),
    });
    pitText.anchor.set(0.5);
    pitText.scale.set(0.06);
    pitText.position.set(lane[mid]!, lane[mid + 1]!);
    pitText.alpha = 0.85;
    this.road.addChild(pitText);

    // Asfalto/terra/areia por segmento de terreno.
    const surface = new Graphics();
    for (const seg of g.terrainSegments) {
      const pts: number[] = [];
      for (let i = seg.from; i <= seg.to + 1; i++) pts.push(...L(i));
      for (let i = seg.to + 1; i >= seg.from; i--) pts.push(...R(i));
      surface.poly(pts, true).fill({ color: TERRAIN_COLOR[seg.terrain] });
    }
    this.road.addChild(surface);
    // Contorno escuro nas bordas: a pista nunca some no fundo, em qualquer cenário.
    const edge = new Graphics();
    for (const side of [L, R]) {
      const [x0, y0] = side(0);
      edge.moveTo(x0, y0);
      for (let i = 1; i <= n; i++) {
        const [x, y] = side(i);
        edge.lineTo(x, y);
      }
      edge.stroke({ width: 0.5, color: 0x1b1b1b, alpha: this.biome === 'grass' ? 0.18 : 0.35 });
    }
    this.road.addChild(edge);

    // Zebras vermelho/branco nas curvas fechadas, do lado de dentro (ver curbs.ts).
    const curbs = new Graphics();
    const curbSide = curbSides(g.curvature);
    for (let i = 0; i < n; i++) {
      const side = curbSide[i]!;
      if (side === 0) continue;
      const color = i % 2 ? 0xff4d4d : 0xffffff;
      const [ax, ay] = side === 1 ? L(i) : R(i);
      const [bx, by] = side === 1 ? L(i + 1) : R(i + 1);
      const [nx, ny] = N(i);
      const [mx, my] = N(i + 1);
      const o = 1.3 * side;
      curbs.poly([ax, ay, bx, by, bx + mx * o, by + my * o, ax + nx * o, ay + ny * o], true).fill({ color });
    }
    this.road.addChild(curbs);

    // Bordas brancas.
    const edges = new Graphics();
    edges.poly(g.left, true).stroke({ width: 0.35, color: 0xffffff, alpha: 0.9 });
    edges.poly(g.right, true).stroke({ width: 0.35, color: 0xffffff, alpha: 0.9 });
    this.road.addChild(edges);

    // Linhas de setor.
    const sectors = new Graphics();
    g.sectors.slice(1).forEach((s, k) => {
      const [lx, ly] = L(s),
        [rx, ry] = R(s);
      sectors
        .moveTo(lx, ly)
        .lineTo(rx, ry)
        .stroke({ width: 0.8, color: k === 0 ? 0xffcc00 : 0x4cc9f0, alpha: 0.8 });
    });
    this.road.addChild(sectors);

    // Largada/chegada quadriculada e grid.
    const start = new Graphics();
    const [px, py] = P(0),
      [nx, ny] = N(0);
    const tx = ny,
      ty = -nx; // tangente (sentido contrário ao da normal girada)
    const half = g.widths[0]! / 2;
    const cells = Math.ceil((half * 2) / 1.2);
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < cells; c++) {
        const off = -half + c * 1.2;
        const along = r * 1.2 - 1.2;
        const x0 = px + nx * off - tx * along,
          y0 = py + ny * off - ty * along;
        const color = (r + c) % 2 ? 0x111111 : 0xffffff;
        start
          .poly(
            [
              x0,
              y0,
              x0 + nx * 1.2,
              y0 + ny * 1.2,
              x0 + nx * 1.2 - tx * 1.2,
              y0 + ny * 1.2 - ty * 1.2,
              x0 - tx * 1.2,
              y0 - ty * 1.2,
            ],
            true,
          )
          .fill({ color });
      }
    for (const s of g.grid) {
      const ch = Math.cos(s.heading),
        sh = Math.sin(s.heading);
      const fx = s.x + ch * 2.6,
        fy = s.y + sh * 2.6;
      start
        .moveTo(fx - sh * 1.4, fy + ch * 1.4)
        .lineTo(fx + sh * 1.4, fy - ch * 1.4)
        .stroke({ width: 0.3, color: 0xffffff, alpha: 0.9 });
    }
    this.road.addChild(start);

    // Marcas de pneu nas zonas de frenagem das curvas mais fechadas.
    if (this.atlases) {
      for (let i = 0; i < n; i += 1) {
        const k = Math.abs(g.curvature[i]!);
        if (k < 1 / 35 || i % 9) continue;
        const j = (i - 4 + n) % n;
        const [x, y] = P(j);
        const [nx2, ny2] = N(j);
        const side = (i % 2 ? 1 : -1) * g.widths[j]! * 0.18;
        const sk = new Sprite(this.atlases.object(i % 3 ? 'skidmark_long_1' : 'skidmark_long_2'));
        sk.anchor.set(0.5);
        sk.alpha = 0.35;
        sk.scale.set(1 / PX_PER_M);
        sk.position.set(x + nx2 * side, y + ny2 * side);
        const [ax, ay] = P(j - 1),
          [bx, by] = P(j + 1);
        sk.rotation = Math.atan2(by - ay, bx - ax) + Math.PI / 2;
        this.road.addChild(sk);
      }
    }
    // Decoração com sprites do racing_pack.
    if (this.atlases) {
      for (const d of g.decorations) {
        const sp = new Sprite(this.atlases.object(style.deco[d.kind] ?? d.kind));
        sp.anchor.set(0.5);
        sp.scale.set(d.scale / PX_PER_M);
        sp.rotation = d.rot + (d.kind.startsWith('tribune') || d.kind.startsWith('tent') ? Math.PI / 2 : 0);
        sp.position.set(d.x, d.y);
        this.deco.addChild(sp);
      }
    }
    if (fit) this.fit();
  }

  // ------------------------------------------------------------------ Linhas e marcadores (espessura constante em pixels)
  setLine(key: string, points: ArrayLike<number> | null, opts: Partial<Omit<LineSpec, 'points'>> = {}) {
    let entry = this.lineSpecs.get(key);
    if (!points) {
      if (entry) {
        entry.g.destroy();
        this.lineSpecs.delete(key);
      }
      return;
    }
    if (!entry) {
      entry = { spec: null as unknown as LineSpec, g: new Graphics() };
      this.lines.addChild(entry.g);
      this.lineSpecs.set(key, entry);
    }
    entry.spec = {
      points,
      color: opts.color ?? 0xffffff,
      widthPx: opts.widthPx ?? 3,
      alpha: opts.alpha ?? 1,
      closed: opts.closed ?? false,
      ...(opts.colors ? { colors: opts.colors } : {}),
    };
    this.drawLine(entry.g, entry.spec);
  }
  private drawLine(g: Graphics, s: LineSpec) {
    g.clear();
    const n = s.points.length / 2;
    if (n < 2) return;
    const w = s.widthPx / this.zoom;
    if (s.colors) {
      for (let i = 0; i < (s.closed ? n : n - 1); i++) {
        const j = (i + 1) % n;
        g.moveTo(s.points[i * 2]!, s.points[i * 2 + 1]!)
          .lineTo(s.points[j * 2]!, s.points[j * 2 + 1]!)
          .stroke({ width: w, color: s.colors[i] ?? s.color, alpha: s.alpha, cap: 'round' });
      }
      return;
    }
    g.moveTo(s.points[0]!, s.points[1]!);
    for (let i = 1; i < n; i++) g.lineTo(s.points[i * 2]!, s.points[i * 2 + 1]!);
    if (s.closed) g.closePath();
    g.stroke({ width: w, color: s.color, alpha: s.alpha, cap: 'round', join: 'round' });
  }
  setMarkers(key: string, pts: Marker[] | null) {
    let e = this.markers.get(key);
    if (!pts) {
      if (e) {
        e.g.destroy();
        this.markers.delete(key);
      }
      return;
    }
    if (!e) {
      e = { pts, g: new Graphics() };
      this.overlay.addChild(e.g);
      this.markers.set(key, e);
    }
    e.pts = pts;
    this.drawMarkers(e);
  }
  private drawMarkers(e: { pts: Marker[]; g: Graphics }) {
    e.g.clear();
    for (const p of e.pts)
      e.g
        .circle(p.x, p.y, p.r / this.zoom)
        .fill({ color: p.color })
        .stroke({ width: (p.ring ?? 1.5) / this.zoom, color: p.stroke ?? 0xffffff });
  }
  private redrawScaled() {
    for (const { g, spec } of this.lineSpecs.values()) this.drawLine(g, spec);
    for (const e of this.markers.values()) this.drawMarkers(e);
    for (const n of this.carNodes.values()) this.scaleCar(n);
  }

  // ------------------------------------------------------------------ Carros
  /**
   * Com a pista inteira na tela, o carro em escala real teria poucos pixels. O sprite nunca fica menor que
   * CAR_MIN_PX na tela, e o número fica acima dele (sem cobrir o desenho do carro).
   */
  private scaleCar(n: { sprite: Sprite; badge: Container; ring: Graphics }) {
    const real = 1 / PX_PER_M;
    const min = CAR_MIN_PX / (CAR_SPRITE_PX * this.zoom);
    const k = Math.max(real, min);
    n.sprite.scale.set(k);
    const lenPx = CAR_SPRITE_PX * k * this.zoom;
    n.badge.scale.set(1 / this.zoom);
    n.badge.position.set(0, -(lenPx / 2 + 11) / this.zoom);
    n.badge.visible = this.zoom < 6;
    n.ring.scale.set(Math.max(1, lenPx / 28) / this.zoom);
  }

  setCars(list: CarView[]) {
    const seen = new Set<string>();
    for (const c of list) {
      seen.add(c.id);
      let node = this.carNodes.get(c.id);
      const look = `${c.color}-${c.model}-${c.number}`;
      if (node && node.look !== look) {
        // Trocou de carro: recria o sprite e o número.
        node.root.destroy({ children: true });
        this.carNodes.delete(c.id);
        node = undefined;
      }
      if (!node) {
        const root = new Container();
        const tex = this.atlases?.vehicle(`car_${c.color}_${Math.min(5, Math.max(1, c.model))}`);
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        sprite.scale.set(1 / PX_PER_M);
        const ring = new Graphics();
        ring.circle(0, 0, 14).stroke({ width: 3, color: 0xffcc00 });
        ring.visible = false;
        const badge = new Container();
        const bg = new Graphics()
          .circle(0, 0, 9)
          .fill({ color: CAR_HEX[c.color] ?? 0xffffff })
          .stroke({ width: 2, color: 0xffffff });
        const txt = new Text({
          text: String(c.number),
          style: new TextStyle({
            fontFamily: 'Inter',
            fontWeight: '800',
            fontSize: 10,
            fill: c.color === 'yellow' ? 0x111111 : 0xffffff,
          }),
        });
        txt.anchor.set(0.5);
        badge.addChild(bg, txt);
        root.addChild(sprite, ring, badge);
        this.cars.addChild(root);
        node = { root, sprite, badge, ring, look };
        this.carNodes.set(c.id, node);
        this.scaleCar(node);
      }
      node.root.position.set(c.x, c.y);
      node.sprite.rotation = c.heading + Math.PI / 2;
      node.ring.visible = !!c.highlight;
      node.root.alpha = c.status === 2 ? 0.35 : 1;
      if (c.highlight) this.cars.setChildIndex(node.root, this.cars.children.length - 1);
    }
    for (const [id, n] of this.carNodes)
      if (!seen.has(id)) {
        n.root.destroy({ children: true });
        this.carNodes.delete(id);
      }
  }
}
