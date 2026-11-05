import { AppError, type RaceSummaryDto } from '@tracado/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { parse } from '../../lib/validate';
import { getGroup, invitePreview } from '../crazy/service';
import { getSummary } from '../races/service';

const GAME = 'Roda Presa';
const DEFAULT_COPY = {
  title: `${GAME} · Corrida estratégica`,
  description: 'Corridas multiplayer de estratégia toda hora. Desenhe o traçado, acerte o carro e vença.',
  path: '/',
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

/** Título, descrição e destino do link de uma corrida conforme a fase. */
export function shareCopy(r: RaceSummaryDto): { title: string; description: string; path: string } {
  const pista = `${r.track.name} · ${(r.track.length / 1000).toFixed(2).replace('.', ',')} km · ${r.laps} voltas`;
  if (r.status === 'race')
    return {
      title: `Ao vivo agora: ${r.name} · ${GAME}`,
      description: `${r.capacity.confirmed} carros na pista. ${pista}. Assista à corrida em tempo real.`,
      path: `/corridas/${r.id}/ao-vivo`,
    };
  if (r.status === 'finished' || r.status === 'archived')
    return {
      title: `Resultado: ${r.name} · ${GAME}`,
      description: `Veja o pódio, os tempos e o replay. ${pista}.`,
      path: `/corridas/${r.id}/resultado`,
    };
  if (r.crazy)
    return {
      title: `🤪 ${r.name} · Corrida Maluca`,
      description: `Corrida fechada da turma ${r.crazy.groupName}. Largada ${when(r.timeline.practiceAt)} (Brasília). ${pista}. Vem assistir!`,
      path: `/corridas/${r.id}`,
    };
  const vagas = r.capacity.free > 0 ? `${r.capacity.free} vagas` : 'grid cheio, fila de espera aberta';
  return {
    title: `Bora correr? ${r.name} · ${GAME}`,
    description: `Largada ${when(r.timeline.practiceAt)} (Brasília). ${pista}, ${vagas}. Monte o carro, desenhe o traçado e venha disputar comigo.`,
    path: `/corridas/${r.id}`,
  };
}

type Copy = { title: string; description: string; path: string };

function sharePage(reply: FastifyReply, base: string, copy: Copy) {
  const url = `${base}${copy.path}`;
  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(copy.title)}</title>
<meta name="description" content="${esc(copy.description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${GAME}" />
<meta property="og:locale" content="pt_BR" />
<meta property="og:title" content="${esc(copy.title)}" />
<meta property="og:description" content="${esc(copy.description)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="${esc(base)}/og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(copy.title)}" />
<meta name="twitter:description" content="${esc(copy.description)}" />
<meta name="twitter:image" content="${esc(base)}/og.png" />
<meta http-equiv="refresh" content="0; url=${esc(copy.path)}" />
<link rel="canonical" href="${esc(url)}" />
</head><body style="background:#0b1026;color:#eef2ff;font-family:system-ui;padding:24px">
<p>Abrindo <a style="color:#ffcc00" href="${esc(copy.path)}">${esc(copy.title)}</a>…</p>
<script>location.replace(${JSON.stringify(copy.path)})</script>
</body></html>`;
  return reply
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'public, max-age=60')
    .send(html);
}

/**
 * Links de compartilhamento com prévia: o app é uma SPA, então as redes sociais (que não rodam JavaScript)
 * leem as tags Open Graph desta página, e o navegador de quem clica é levado na hora para a corrida.
 */
export function shareRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/s/corridas/:id', async (req, reply) => {
    const base = ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '');
    let copy: Copy = DEFAULT_COPY;
    try {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      copy = shareCopy(await getSummary(ctx.db, id));
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
    return sharePage(reply, base, copy);
  });

  /** Convite da Corrida Maluca: a prévia mostra o grupo e quem chamou; o clique leva ao convite. */
  app.get('/s/maluca/:code', async (req, reply) => {
    const base = ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '');
    let copy: Copy = { ...DEFAULT_COPY, path: '/corrida-maluca' };
    try {
      const { code } = parse(z.object({ code: z.string().trim().min(6).max(32) }), req.params);
      const g = await invitePreview(ctx, code, null);
      copy = {
        title: `🤪 Convite: ${g.name} · Corrida Maluca`,
        description: `${g.ownerNickname} chamou você para ${g.races > 1 ? `um campeonato de ${g.races} corridas` : 'uma corrida'} com a turma (${g.members.length} já dentro). Entre só com o apelido, sem cadastro.`,
        path: `/corrida-maluca/convite/${code}`,
      };
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
    return sharePage(reply, base, copy);
  });

  /** Página do grupo: tabela, resenha e (no fim) o campeão. Não expõe o convite. */
  app.get('/s/grupo/:id', async (req, reply) => {
    const base = ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '');
    let copy: Copy = { ...DEFAULT_COPY, path: '/corrida-maluca' };
    try {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const g = await getGroup(ctx, id, null);
      const champ = g.standings[0];
      copy =
        g.status === 'finished' && champ?.races
          ? {
              title: `🏆 ${champ.nickname} venceu a ${g.name} · Corrida Maluca`,
              description: `${champ.points} pontos. Veja a tabela, os troféus da zoeira e os títulos de honra da turma.`,
              path: `/corrida-maluca/${g.id}`,
            }
          : {
              title: `🤪 ${g.name} · Corrida Maluca`,
              description: `${g.finishedRaces}/${g.races} corridas, ${g.members} pilotos. Acompanhe a tabela e a resenha de cada corrida.`,
              path: `/corrida-maluca/${g.id}`,
            };
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
    return sharePage(reply, base, copy);
  });
}
