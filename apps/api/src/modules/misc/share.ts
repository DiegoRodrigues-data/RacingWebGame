import { AppError, type RaceSummaryDto } from '@tracado/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { parse } from '../../lib/validate';
import { getSummary } from '../races/service';

const GAME = 'Roda Presa';

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
  const vagas = r.capacity.free > 0 ? `${r.capacity.free} vagas` : 'grid cheio, fila de espera aberta';
  return {
    title: `Bora correr? ${r.name} · ${GAME}`,
    description: `Largada ${when(r.timeline.practiceAt)} (Brasília). ${pista}, ${vagas}. Monte o carro, desenhe o traçado e venha disputar comigo.`,
    path: `/corridas/${r.id}`,
  };
}

/**
 * Links de compartilhamento com prévia: o app é uma SPA, então as redes sociais (que não rodam JavaScript)
 * leem as tags Open Graph desta página, e o navegador de quem clica é levado na hora para a corrida.
 */
export function shareRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/s/corridas/:id', async (req, reply) => {
    const base = ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '');
    let copy = {
      title: `${GAME} · Corrida estratégica`,
      description: 'Corridas multiplayer de estratégia toda hora. Desenhe o traçado, acerte o carro e vença.',
      path: '/',
    };
    try {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      copy = shareCopy(await getSummary(ctx.db, id));
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
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
  });
}
