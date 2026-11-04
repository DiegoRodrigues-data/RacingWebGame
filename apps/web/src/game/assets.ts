import { Assets, Rectangle, Texture } from 'pixi.js';
import objectsPng from '../assets/racing_pack/spritesheet_objects.png';
import objectsXml from '../assets/racing_pack/spritesheet_objects.xml?raw';
import vehiclesPng from '../assets/racing_pack/spritesheet_vehicles.png';
import vehiclesXml from '../assets/racing_pack/spritesheet_vehicles.xml?raw';

/** Lê um TextureAtlas (formato Kenney/Starling) e devolve os retângulos por nome. */
export function parseAtlas(xml: string): Record<string, { x: number; y: number; w: number; h: number }> {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const re = /<SubTexture\s+name="([^"]+)"\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)))
    out[m[1]!.replace(/\.png$/, '')] = { x: +m[2]!, y: +m[3]!, w: +m[4]!, h: +m[5]! };
  return out;
}

export interface Atlases {
  vehicle(name: string): Texture;
  object(name: string): Texture;
}

let loading: Promise<Atlases> | null = null;

export function loadAtlases(): Promise<Atlases> {
  loading ??= (async () => {
    const [veh, obj] = await Promise.all([
      Assets.load<Texture>(vehiclesPng),
      Assets.load<Texture>(objectsPng),
    ]);
    const vf = parseAtlas(vehiclesXml),
      of = parseAtlas(objectsXml);
    const cache = new Map<string, Texture>();
    const make = (base: Texture, frames: typeof vf, name: string) => {
      const key = `${base.uid}:${name}`;
      let t = cache.get(key);
      if (!t) {
        const f = frames[name];
        if (!f) return Texture.WHITE;
        t = new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, f.h) });
        cache.set(key, t);
      }
      return t;
    };
    return { vehicle: (n) => make(veh, vf, n), object: (n) => make(obj, of, n) };
  })();
  return loading;
}

const carUrls = import.meta.glob('../assets/racing_pack/cars/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;
export function carImage(color: string, model: number): string {
  return (
    carUrls[`../assets/racing_pack/cars/car_${color}_${Math.min(5, Math.max(1, model || 1))}.png`] ??
    Object.values(carUrls)[0]!
  );
}

export const CAR_HEX: Record<string, number> = {
  red: 0xe74c3c,
  blue: 0x3498db,
  green: 0x2ecc71,
  yellow: 0xf1c40f,
  black: 0x3d4b5c,
};
export const CAR_CSS: Record<string, string> = {
  red: '#e74c3c',
  blue: '#3498db',
  green: '#2ecc71',
  yellow: '#f1c40f',
  black: '#3d4b5c',
};
