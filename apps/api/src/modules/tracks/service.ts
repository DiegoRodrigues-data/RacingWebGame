import { randomUUID } from 'node:crypto';
import {
  AppError,
  type EditorTrack,
  type TrackParams,
  type TrackVersionDto,
  type TrackVersionStatus,
} from '@tracado/shared';
import {
  buildEditorTrack,
  createRng,
  generateProceduralTrack,
  geometryFromSource,
  validateGeometry,
  type TrackGeometry,
} from '@tracado/trackgen';
import { and, desc, eq, max } from 'drizzle-orm';
import type { Ctx } from '../../context';
import type { Db, Tx } from '../../db/client';
import { tracks, trackVersions } from '../../db/schema';

type VersionRow = typeof trackVersions.$inferSelect;
type TrackRow = typeof tracks.$inferSelect;

const cache = new Map<string, TrackGeometry>();
const CACHE_MAX = 200;

/** Geometria da versão, regenerada a partir da origem persistida e conferida pelo hash (auditoria). */
export async function getGeometry(ctx: Pick<Ctx, 'db' | 'log'>, versionId: string): Promise<TrackGeometry> {
  const hit = cache.get(versionId);
  if (hit) return hit;
  const [row] = await ctx.db.select().from(trackVersions).where(eq(trackVersions.id, versionId));
  if (!row) throw new AppError('NOT_FOUND', 'Pista não encontrada.');
  const g = geometryFromSource(row.source);
  if (g.hash !== row.geometryHash) {
    ctx.log.error(
      { versionId, expected: row.geometryHash, got: g.hash },
      'Hash da pista divergente — gerador alterado?',
    );
    throw new AppError('INTERNAL', 'Geometria da pista não confere com o hash registrado.');
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(versionId, g);
  return g;
}

export function clearGeometryCache(versionId?: string) {
  if (versionId) cache.delete(versionId);
  else cache.clear();
}

const PLACES = [
  'Vale Verde',
  'Serra Azul',
  'Costa Dourada',
  'Lagoa Seca',
  'Pedra Alta',
  'Rio Bravo',
  'Monte Claro',
  'Vila Rubra',
  'Ponta Areia',
  'Campo Largo',
  'Morro do Vento',
  'Baía Clara',
  'Cerrado Alto',
  'Ilha Grande',
  'Chapada Sul',
];
const PREFIX = ['Autódromo', 'Circuito', 'Anel', 'Pista'];
export function proceduralName(seed: string): string {
  const r = createRng(`name|${seed}`);
  return `${r.pick(PREFIX)} ${r.pick(PLACES)}`;
}

export async function createProceduralVersion(
  db: Db | Tx,
  seed: string,
  params: TrackParams,
  createdBy: string | null,
): Promise<VersionRow> {
  const g = generateProceduralTrack(seed, params);
  const [t] = await db
    .insert(tracks)
    .values({ name: proceduralName(seed), kind: 'procedural', createdBy })
    .returning();
  const [v] = await db
    .insert(trackVersions)
    .values({
      trackId: t!.id,
      version: 1,
      status: 'published',
      source: g.source,
      geometryHash: g.hash,
      length: g.length,
      terrain: g.baseTerrain,
      corners: g.corners,
      createdBy,
      publishedAt: new Date(),
      publishedBy: createdBy,
    })
    .returning();
  cache.set(v!.id, g);
  return v!;
}

export function previewEditor(editor: EditorTrack) {
  const g = buildEditorTrack(editor);
  return { geometry: g, issues: validateGeometry(g) };
}

export function previewProcedural(seed: string, params: TrackParams) {
  const g = generateProceduralTrack(seed, params);
  return { geometry: g, issues: validateGeometry(g, { targetLength: params.length }) };
}

export async function createSpecialTrack(ctx: Ctx, name: string, editor: EditorTrack, actorId: string) {
  return ctx.db.transaction(async (tx) => {
    const [t] = await tx.insert(tracks).values({ name, kind: 'special', createdBy: actorId }).returning();
    const v = await insertEditorVersion(tx, t!.id, 1, editor, actorId);
    return { track: t!, version: v };
  });
}

async function insertEditorVersion(
  db: Db | Tx,
  trackId: string,
  version: number,
  editor: EditorTrack,
  actorId: string,
) {
  const { geometry, issues } = previewEditor(editor);
  const [v] = await db
    .insert(trackVersions)
    .values({
      trackId,
      version,
      status: 'draft',
      source: geometry.source,
      geometryHash: geometry.hash,
      length: geometry.length,
      terrain: geometry.baseTerrain,
      corners: geometry.corners,
      issues: issues.map((i) => ({ code: i.code, message: i.message })),
      createdBy: actorId,
    })
    .returning();
  return v!;
}

export async function newDraftVersion(ctx: Ctx, trackId: string, editor: EditorTrack, actorId: string) {
  const [t] = await ctx.db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!t || t.kind !== 'special') throw new AppError('NOT_FOUND', 'Pista especial não encontrada.');
  const [m] = await ctx.db
    .select({ v: max(trackVersions.version) })
    .from(trackVersions)
    .where(eq(trackVersions.trackId, trackId));
  return insertEditorVersion(ctx.db, trackId, (m?.v ?? 0) + 1, editor, actorId);
}

/** Versões publicadas são imutáveis: só rascunhos podem ser editados. */
export async function updateDraft(ctx: Ctx, versionId: string, editor: EditorTrack) {
  const [v] = await ctx.db.select().from(trackVersions).where(eq(trackVersions.id, versionId));
  if (!v) throw new AppError('NOT_FOUND');
  if (v.status !== 'draft')
    throw new AppError('CONFLICT', 'Apenas rascunhos podem ser editados; crie uma nova versão.');
  const { geometry, issues } = previewEditor(editor);
  clearGeometryCache(versionId);
  const [u] = await ctx.db
    .update(trackVersions)
    .set({
      source: geometry.source,
      geometryHash: geometry.hash,
      length: geometry.length,
      terrain: geometry.baseTerrain,
      corners: geometry.corners,
      issues: issues.map((i) => ({ code: i.code, message: i.message })),
    })
    .where(eq(trackVersions.id, versionId))
    .returning();
  return u!;
}

const NEXT: Record<
  'submit' | 'publish' | 'deprecate' | 'reject',
  { from: TrackVersionStatus[]; to: TrackVersionStatus }
> = {
  submit: { from: ['draft'], to: 'review' },
  reject: { from: ['review'], to: 'draft' },
  publish: { from: ['draft', 'review'], to: 'published' },
  deprecate: { from: ['published'], to: 'deprecated' },
};

export async function changeStatus(ctx: Ctx, versionId: string, action: keyof typeof NEXT, actorId: string) {
  const [v] = await ctx.db.select().from(trackVersions).where(eq(trackVersions.id, versionId));
  if (!v) throw new AppError('NOT_FOUND');
  const rule = NEXT[action];
  if (!rule.from.includes(v.status))
    throw new AppError('INVALID_TRANSITION', `Não é possível ${action} uma versão em ${v.status}.`);
  if (action === 'publish') {
    const issues = validateGeometry(geometryFromSource(v.source));
    if (issues.length) throw new AppError('TRACK_INVALID', 'A pista tem problemas de validação.', issues);
  }
  const [u] = await ctx.db
    .update(trackVersions)
    .set({
      status: rule.to,
      ...(action === 'publish' ? { publishedAt: new Date(ctx.clock.now()), publishedBy: actorId } : {}),
    })
    .where(and(eq(trackVersions.id, versionId), eq(trackVersions.status, v.status)))
    .returning();
  return u!;
}

export function versionDto(v: VersionRow, t: TrackRow): TrackVersionDto {
  return {
    id: v.id,
    trackId: t.id,
    trackName: t.name,
    kind: t.kind,
    version: v.version,
    status: v.status,
    source: v.source,
    geometryHash: v.geometryHash,
    meta: { length: v.length, terrain: v.terrain, corners: v.corners, sectors: 3 },
    createdAt: v.createdAt.toISOString(),
    publishedAt: v.publishedAt?.toISOString() ?? null,
  };
}

export async function listTracks(ctx: Ctx, kind?: 'special' | 'procedural') {
  const rows = await ctx.db
    .select()
    .from(trackVersions)
    .innerJoin(tracks, eq(tracks.id, trackVersions.trackId))
    .where(kind ? eq(tracks.kind, kind) : undefined)
    .orderBy(desc(trackVersions.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...versionDto(r.track_versions, r.tracks), issues: r.track_versions.issues }));
}

export const newSeed = () => randomUUID().slice(0, 8);
