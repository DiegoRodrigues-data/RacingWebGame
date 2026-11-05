import {
  CAR_FRAME_STRIDE,
  formatLapTime,
  type CarSetup,
  type CrazyAwardDto,
  type CrazyAwardKey,
} from '@tracado/shared';
import type { CarResult } from '@tracado/sim';
import { createRng } from '@tracado/trackgen';
import { and, eq } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { profiles, qualifyingResults, raceReplays, raceResults, users } from '../../db/schema';
import { loadReplay } from '../engine/runner';

/** Frases da resenha. `{n}` vira o apelido. Sorteadas com a seed da corrida (sempre as mesmas para a corrida). */
const LINES: Record<CrazyAwardKey, string[]> = {
  rocket: [
    '{n} viu a pista passar como um borrão. Alguém conferiu se tinha limitador?',
    '{n} fez a volta mais rápida e já está pedindo patrocínio de energético.',
    'Dizem que {n} ainda está acelerando até agora.',
  ],
  turtle: [
    '{n} chegou por último, mas chegou. O importante é competir (e admirar a paisagem).',
    '{n} não estava lento: estava fazendo turismo pela pista.',
    'A torcida de {n} já pediu música do Fantástico para a próxima chegada.',
  ],
  bus: [
    '{n} parou em todos os pontos dessa volta. Faltou só cobrar a passagem.',
    'Nessa volta {n} pegou o caminho mais longo, com direito a cafezinho.',
    '{n} fez uma volta tão lenta que deu tempo de mandar áudio de 3 minutos.',
  ],
  beetle: [
    'O motor de {n} pediu aposentadoria. Ou um padre.',
    '{n} tirou do motor o que ele não tinha. Cheiro de queimado confirmado.',
    'Ouviram aquele barulho de liquidificador? Era o motor de {n}.',
  ],
  rubber: [
    '{n} torrou pneu como quem torra dinheiro em churrasco. Borrachudo oficial!',
    'A borracharia da esquina mandou um cartão de agradecimento para {n}.',
    '{n} deixou mais borracha na pista que uma fábrica de chinelos.',
  ],
  brain: [
    '{n} largou lá atrás e foi passando todo mundo com a calma de quem planejou tudo.',
    '{n} fez a estratégia no guardanapo e deu certo. Professor!',
    'Enquanto todos aceleravam, {n} pensava. Estrategista da turma.',
  ],
  couch: [
    '{n} correu com tudo no padrão. Tava no sofá comendo pipoca, né?',
    '{n} nem abriu o box. Confia no carro de fábrica.',
    'Setup? Traçado? {n} preferiu deixar o destino decidir.',
  ],
  pit: [
    '{n} parou tanto no box que já tem crachá de mecânico.',
    'A equipe de {n} pediu adicional de insalubridade de tanto pit stop.',
    '{n} visitou o box mais do que visita a mãe.',
  ],
};

const cache = new Map<string, CrazyAwardDto[]>();
const CACHE_MAX = 200;

/**
 * Troféus de zoeira de uma corrida encerrada, só entre pilotos humanos (bots nunca levam troféu).
 * Calculados do resultado gravado, da classificação e dos frames do replay (desgaste de pneu e motor).
 */
export async function raceAwards(
  ctx: Pick<Ctx, 'db'>,
  race: { id: string; seed: string },
): Promise<CrazyAwardDto[]> {
  const hit = cache.get(race.id);
  if (hit) return hit;
  const rows = await ctx.db
    .select({ r: raceResults, nick: profiles.nickname })
    .from(raceResults)
    .innerJoin(users, eq(users.id, raceResults.userId))
    .innerJoin(profiles, eq(profiles.userId, raceResults.userId))
    .where(and(eq(raceResults.raceId, race.id), eq(users.isBot, false)));
  if (!rows.length) return [];
  const [rep] = await ctx.db
    .select({ sr: raceReplays.simResults, si: raceReplays.simInput })
    .from(raceReplays)
    .where(eq(raceReplays.raceId, race.id));
  const sim = new Map(
    ((rep?.sr as { results: CarResult[] } | undefined)?.results ?? []).map((r) => [r.id, r]),
  );
  const setupOf = new Map(
    ((rep?.si as { cars: { id: string; setup: CarSetup }[] } | undefined)?.cars ?? []).map((c) => [
      c.id,
      c.setup,
    ]),
  );
  const quali = new Map(
    (await ctx.db.select().from(qualifyingResults).where(eq(qualifyingResults.raceId, race.id))).map((q) => [
      q.userId,
      q,
    ]),
  );
  const humans = rows.map(({ r, nick }) => ({ ...r, nick }));
  const nickOf = new Map(humans.map((h) => [h.userId, h.nick]));
  const out: CrazyAwardDto[] = [];
  const give = (key: CrazyAwardKey, userId: string, detail: string) => {
    const lines = LINES[key];
    const line = createRng(`${race.seed}|award|${key}|${userId}`).pick(lines);
    out.push({
      key,
      userId,
      nickname: nickOf.get(userId)!,
      detail,
      line: line.replace('{n}', nickOf.get(userId)!),
    });
  };
  const best = <T>(list: T[], score: (x: T) => number | null) => {
    let top: T | null = null;
    let topScore = -Infinity;
    for (const x of list) {
      const s = score(x);
      if (s != null && s > topScore) {
        top = x;
        topScore = s;
      }
    }
    return top ? { x: top, score: topScore } : null;
  };

  const rocket = best(humans, (h) => (h.bestLapMs != null ? -h.bestLapMs : null));
  if (rocket) give('rocket', rocket.x.userId, formatLapTime(-rocket.score));

  if (humans.length >= 2) {
    const turtle = best(humans, (h) => h.position);
    if (turtle)
      give(
        'turtle',
        turtle.x.userId,
        turtle.x.status === 'dnf' ? 'abandonou' : `chegou em P${turtle.x.position}`,
      );
  }

  // Pior volta: fora a volta de largada e as voltas de parada (entrada e saída do box).
  const bus = best(humans, (h) => {
    const laps = sim.get(h.userId)?.lapTimesMs ?? [];
    const pits = new Set((setupOf.get(h.userId)?.pitStops ?? []).flatMap((p) => [p.lap, p.lap + 1]));
    let worst: number | null = null;
    laps.forEach((ms, i) => {
      const lap = i + 1;
      if (lap === 1 || pits.has(lap)) return;
      if (worst == null || ms > worst) worst = ms;
    });
    return worst;
  });
  if (bus) give('bus', bus.x.userId, formatLapTime(bus.score));

  // Desgaste pelos frames (formato com 8 números por carro).
  const wear = new Map<string, { tyre: number; engine: number }>();
  const replay = await loadReplay(ctx, race.id).catch(() => null);
  if (replay && replay.frames[0] && replay.frames[0].c.length === replay.cars.length * CAR_FRAME_STRIDE) {
    replay.cars.forEach((car, i) => {
      if (!nickOf.has(car.userId)) return;
      let tyre = 0,
        engine = 0,
        last: number | null = null;
      for (const f of replay.frames) {
        const tw = f.c[i * CAR_FRAME_STRIDE + 6]!;
        const ew = f.c[i * CAR_FRAME_STRIDE + 7]!;
        if (last != null && tw > last) tyre += tw - last;
        last = tw;
        engine = Math.max(engine, ew);
      }
      wear.set(car.userId, { tyre, engine });
    });
  }
  const broken = humans.find((h) => h.status === 'dnf' && sim.get(h.userId)?.dnfReason === 'mechanical');
  if (broken) give('beetle', broken.userId, 'o motor abriu o bico');
  else {
    const beetle = best(humans, (h) => wear.get(h.userId)?.engine ?? null);
    if (beetle && beetle.score > 0)
      give('beetle', beetle.x.userId, `${Math.round(beetle.score)}% de desgaste`);
  }
  const rubber = best(humans, (h) => wear.get(h.userId)?.tyre ?? null);
  if (rubber && rubber.score > 0)
    give(
      'rubber',
      rubber.x.userId,
      rubber.score < 100
        ? `${Math.round(rubber.score)}% de pneu gasto`
        : `${(rubber.score / 100).toFixed(1).replace('.', ',')} jogos de pneu`,
    );

  const brain = best(humans, (h) => {
    const q = quali.get(h.userId);
    return q && h.status === 'finished' ? q.position - h.position : null;
  });
  if (brain && brain.score > 0)
    give('brain', brain.x.userId, `+${brain.score} ${brain.score === 1 ? 'posição' : 'posições'}`);

  // Piloto de Sofá só vale se alguém da turma se mexeu (se todo mundo ficou no padrão, não tem graça).
  const couch = humans.filter((h) => {
    const q = quali.get(h.userId);
    return q?.usedDefaultSetup && q.usedDefaultTrace;
  });
  if (couch.length < humans.length) for (const h of couch) give('couch', h.userId, 'tudo no padrão');

  const minPits = Math.min(...humans.map((h) => h.pitStops));
  const pit = best(humans, (h) => h.pitStops);
  if (pit && pit.score > minPits) give('pit', pit.x.userId, `${pit.score} paradas`);

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(race.id, out);
  return out;
}
