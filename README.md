# Traçado — corrida estratégica multiplayer (web, 2D top-down)

Jogo web em que até **22 pilotos** disputam corridas agendadas pelo servidor. Ninguém dirige em tempo real:
cada jogador **desenha o traçado** sobre a pista numa janela de 5 minutos, **acerta o carro** (pneus, paradas,
calibragem, asa, motor, câmbio, terreno e aposta de clima) e o **servidor simula** classificação e corrida de forma
determinística, transmitindo tudo ao vivo por WebSocket. Resultados alimentam rankings **local, regional, nacional e mundial**.

Arte: [Racing Pack da Kenney](https://kenney.nl) (CC0) — ver [CREDITS.md](CREDITS.md).

## Como rodar localmente

Requisitos: **Node 22+** e **pnpm 9** (via `corepack`). Docker é opcional.

```bash
corepack enable            # ou use "corepack pnpm" no lugar de "pnpm"
pnpm install
cp .env.example apps/api/.env   # opcional: valores padrão já funcionam em dev
pnpm dev                   # API em :3001 e web em :5173
```

Sem `DATABASE_URL` a API usa **PGlite** (Postgres real compilado em WASM) em `apps/api/.data/pglite`;
sem `REDIS_URL` usa armazenamento em memória. Para usar Postgres e Redis reais:

```bash
docker compose up -d
DATABASE_URL=postgres://tracado:tracado@localhost:5432/tracado REDIS_URL=redis://localhost:6379 pnpm dev
```

Para ter dados de demonstração, pilotos-bot e o relógio controlável, rode a API com:

```bash
SEED_DEMO=true DEMO_BOTS=14 ENABLE_DEV_ROUTES=true pnpm dev
```

Contas criadas pelo seed: `admin@tracado.local` / `admin12345` (admin) e `editor@tracado.local` / `editor12345` (editor de pistas).
Com `ENABLE_DEV_ROUTES=true` é possível adiantar o relógio do servidor para percorrer as fases:

```bash
curl -X POST localhost:3001/dev/clock/advance -H 'content-type: application/json' -d '{"ms": 300000}'
```

## Comandos

| Comando                                                 | O que faz                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm dev`                                              | API (tsx watch) + web (Vite)                                         |
| `pnpm test`                                             | testes unitários e de integração de todos os pacotes (Vitest)        |
| `pnpm test:e2e`                                         | testes de ponta a ponta (Playwright; sobe API e web isoladas)        |
| `pnpm lint` / `pnpm typecheck` / `pnpm build`           | qualidade e build de produção                                        |
| `pnpm balance`                                          | simula centenas de corridas e acusa configuração dominante           |
| `pnpm loadtest`                                         | carga contra um servidor rodando (sockets + inscrições concorrentes) |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | migrações Drizzle e seed                                             |

Antes do primeiro `pnpm test:e2e`: `pnpm --filter @tracado/e2e exec playwright install chromium`.

## Estrutura

```
apps/
  api/        Fastify + ws + Drizzle (Postgres/PGlite) + Redis opcional; motor de fases, simulação, rankings
  web/        React 19 + Vite + Tailwind 4 + PixiJS 8 + TanStack Query + Zustand
packages/
  shared/     tipos, schemas Zod, fases da corrida, protocolo WebSocket, códigos de erro
  trackgen/   geração procedural determinística, editor, validação, projeção do traçado
  sim/        modelo de desempenho, simulação de classificação/corrida, balanceamento
e2e/          Playwright
infra/        nginx.conf e scripts de backup
racing_pack/  pacote de arte original (Kenney)
```

Mais detalhes: [docs/API.md](docs/API.md) (contratos REST e WebSocket) e [DECISIONS.md](DECISIONS.md) (decisões, riscos e pendências).
O andamento está em [ROADMAP.md](ROADMAP.md).

## Regras do jogo (resumo)

- **Fases** controladas pelo servidor: agendada → inscrições → treino → janela de traçado (5 min) → parque fechado → classificação → corrida → encerrada → arquivada (ou cancelada).
- **Inscrição**: até 22 confirmados; depois, fila de espera (tamanho configurável); com a fila cheia, `RACE_FULL`. Cancelar antes do treino promove o primeiro da fila. A disputa pela última vaga é serializada (lock de linha + mutex), então duas tentativas simultâneas resultam em uma confirmada e uma na fila.
- **Traçado**: lista de pontos `(s, d)` — `s` é a fração da volta (0–1) e `d` o deslocamento lateral (−1 a 1). O servidor recusa pontos fora da pista (`TRACE_OUT_OF_BOUNDS`), traçado incompleto, em sentido contrário ou com mudança lateral brusca (`TRACE_INVALID`), e envios fora da janela (`TRACE_WINDOW_CLOSED`). Sem traçado válido o carro corre na linha central com penalidade de 1,5% de ritmo.
- **Grade automática**: o servidor mantém uma corrida a cada hora cheia nas próximas 24 h (`AUTO_RACES_PER_DAY=24`), amistosa e na Copa Novatos, com inscrições abertas para qualquer piloto. Corridas ranqueadas e competições são criadas pelo admin.
- **Setup**: editável até o parque fechado; limites por categoria. Sem setup, o servidor usa o padrão.
- **Simulação**: perfil de velocidade por volta a partir da curvatura da sua linha, aderência (pneu, desgaste, clima, terreno, pressão, asa, aposta de clima), motor e câmbio; ultrapassagens, pit stops, safety car, óleo, rodadas e falhas mecânicas semeados. Mesmos insumos ⇒ mesmo resultado (auditável por reprocessamento).
- **Pontos**: tabela da categoria (padrão 25-18-15-12-10-8-6-4-2-1, +1 pela volta mais rápida, × multiplicador). Desempate: vitórias → pódios → voltas mais rápidas → menos corridas → entrada mais antiga na temporada.

## Deploy (VPS com Dokploy)

1. No Dokploy, crie um serviço **Compose** apontando para este repositório e o arquivo `docker-compose.prod.yml`.
2. Defina as variáveis: `POSTGRES_PASSWORD`, `JWT_SECRET` (longo e aleatório), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_WEB_URL` (ex.: `https://tracado.seudominio.com`) e, se quiser, `METRICS_TOKEN`, `SENTRY_DSN`.
   A grade automática vem ligada: `AUTO_RACES_PER_DAY` (padrão 24; 0 desliga), `AUTO_RACES_CATEGORY` (slug, padrão `copa-novatos`) e `AUTO_RACES_RANKED` (padrão `false`).
3. Em **Domains**, aponte o domínio para o serviço **web**, porta **80**, com HTTPS. Se aparecer `404 page not found` com o certificado `TRAEFIK DEFAULT CERT` e os containers saudáveis, o domínio foi criado depois do container: confira serviço/porta e faça um novo Deploy.
4. Faça o Deploy. A API aplica as migrações sozinha ao subir (com lock consultivo) e cria o admin.
5. Confira depois de cada deploy:

```bash
curl -s https://SEU_DOMINIO/api/health                       # {"status":"ok",...}
curl -sI https://SEU_DOMINIO/ | grep -i cache-control         # no-cache
curl -sI https://SEU_DOMINIO/rota-qualquer | grep -i cache-control   # no-cache (fallback da SPA)
curl -s https://SEU_DOMINIO/ | grep -o '/assets/index-[^"]*\.js'      # mesmo hash do build local
curl -sI https://SEU_DOMINIO/assets/<arquivo>.js | grep -i cache-control  # public, max-age=31536000, immutable
```

Backups: o serviço `backup` grava `pg_dump` diário no volume `backups` com retenção de 14 dias. Para restaurar,
pare a `api` e rode `infra/backup/restore.sh /backups/tracado-<data>.sql.gz` dentro do container `backup`.

Métricas Prometheus em `/api/metrics` (com `Authorization: Bearer $METRICS_TOKEN` se definido).
