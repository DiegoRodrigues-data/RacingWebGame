import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp()));
afterAll(() => t.close());

describe('links de compartilhamento', () => {
  it('gera a prévia (Open Graph) do convite e redireciona para a corrida', async () => {
    const id = await t.createRace({ name: 'Corrida <das> "14h"' });
    const r = await t.app.inject({ method: 'GET', url: `/s/corridas/${id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain(
      '<meta property="og:title" content="Bora correr? Corrida &lt;das&gt; &quot;14h&quot; · Roda Presa"',
    );
    expect(r.body).toContain('og:image" content="http://localhost:5173/og.png"');
    expect(r.body).toContain(`url=/corridas/${id}"`);
    expect(r.body).not.toContain('<das>');
  });
  it('corrida inexistente ou id inválido leva para o início', async () => {
    for (const url of ['/s/corridas/00000000-0000-4000-8000-000000000000', '/s/corridas/nada']) {
      const r = await t.app.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('url=/"');
    }
  });
});
