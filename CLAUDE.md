# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Roda Presa** (nome interno do código: Traçado, pacotes `@tracado/*`) é um jogo web multiplayer de corrida estratégica 2D top-down. O jogador não pilota: ele monta o setup e desenha o traçado antes da corrida. O servidor agenda as corridas, simula e transmite o replay. Código, comentários, mensagens de erro e documentação são em português.

Docs de referência: `README.md` (como rodar e as variáveis de ambiente), `DECISIONS.md` (por que cada escolha diverge do plano), `docs/API.md` (rotas REST e eventos WebSocket), `ROADMAP.md` (progresso, mantenha os checkboxes em dia).

## Comandos

Monorepo com pnpm 9 (via corepack) e Turborepo. Node >= 22. Se `pnpm` não estiver no PATH, rode `corepack enable` ou use `corepack pnpm …`. O Turbo precisa do `pnpm` no PATH.

```bash
pnpm install
pnpm dev            # API :3001 (tsx watch) + web :5173 (Vite faz proxy de /api e /ws)
pnpm lint           # eslint . (flat config na raiz)
pnpm typecheck      # tsc em todos os pacotes
pnpm test           # vitest em todos os pacotes
pnpm build          # bundle da API (tsup) + build da web (vite)
pnpm test:e2e       # Playwright; sobe API :3101 e web :5174 sozinho
pnpm balance        # balanceamento da simulação (packages/sim/scripts/balance.ts)
pnpm loadtest       # carga de WebSocket e inscrições (apps/api/scripts/loadtest.ts)
pnpm db:generate    # drizzle-kit: gera migração SQL a partir de apps/api/src/db/schema.ts
```

Um teste só:

```bash
pnpm --filter @tracado/api exec vitest run test/entries.test.ts -t "fila"
pnpm --filter @tracado/trackgen exec vitest run          # um pacote
cd e2e && npx playwright test tests/admin.spec.ts        # um spec E2E
SHOTS=1 npx playwright test tests/visual.spec.ts         # screenshots (só com SHOTS=1)
```

Na primeira vez, rode `pnpm --filter @tracado/e2e install-browsers` antes do E2E. O hook de pre-commit (Husky + lint-staged) roda eslint --fix e prettier.

## Ambiente local sem Docker

- Sem `DATABASE_URL`, a API usa **PGlite** (Postgres em WASM) em `PGLITE_DIR` (`apps/api/.data/pglite`). Para zerar o banco, apague essa pasta.
- Sem `REDIS_URL`, o `Store` usa memória.
- O `apps/api/.env` é lido por `loadDotEnv()`. O `.env.example` traz `SEED_DEMO` e `DEMO_BOTS`, que criam categorias, bots e corridas de demonstração.
- O admin padrão é `admin@tracado.local` / `admin12345`. Em produção a config recusa essa senha, um JWT secret fraco e `ENABLE_DEV_ROUTES`.
- O `docker-compose.yml` sobe Postgres e Redis reais para desenvolvimento. O `docker-compose.prod.yml` é o deploy no Dokploy.

## Arquitetura

### Pacotes

Os pacotes são consumidos direto como TypeScript: o `exports` aponta para `src/index.ts` e não há etapa de build.

- `packages/shared`: contrato entre front e back.
  - Schemas Zod e DTOs (`schemas.ts`).
  - Máquina de fases (`phases.ts`: `ALLOWED_TRANSITIONS`, `buildTimeline`, `duePhase`).
  - Envelope e eventos do WebSocket (`ws.ts`).
  - Constantes do jogo, como `MAX_CARS = 22` e a janela de traçado de 5 min.
  - `ClockSync`, a sincronização de relógio com o servidor.
  - `AppError` e `ERROR_CODES`.
  - Mudou um DTO? Ajuste aqui primeiro.
- `packages/trackgen`: geração procedural determinística de pistas.
  - PRNG sfc32 com seed cyrb128, spline e validação geométrica.
  - `trace.ts`: o traçado do jogador é uma lista de pontos `(s, d)`, com `s` = distância ao longo da linha central e `d` = deslocamento lateral. O arquivo valida o traçado e converte para coordenadas do mundo.
  - O snapshot do hash golden prende o resultado: se mudar o algoritmo, incremente `GENERATOR_VERSION`.
- `packages/sim`: simulação determinística da corrida.
  - `model.ts`: coeficientes de pneu, aero, motor e pit em `COEF`.
  - `race.ts`: `simulateRace` e `simulateQualifying`.
  - Os frames saem a 4 Hz.
  - Ela roda no servidor e no navegador (`probe.ts` e a página `/determinism`). Por isso, nada de `Math.random` nem `Date.now`: toda aleatoriedade vem do PRNG com seed.
  - Depois de mexer em `COEF`, rode `pnpm balance`.

### API (`apps/api`): Fastify 5 + `ws` + Drizzle

- `buildApp` (`src/app.ts`) recebe as dependências injetadas: config, db, `Store`, `Clock` e logger. Os testes usam `ManualClock` e `MemoryStore`. O servidor usa `SystemClock`, ou `OffsetClock` quando as rotas de dev estão ligadas.
- Os módulos ficam em `src/modules/*`. Em cada um, `service.ts` concentra a regra de negócio e `routes.ts` só valida e chama o serviço.
- **Motor de fases** (`modules/engine/engine.ts`): substitui o BullMQ.
  - Um `tick` periódico lê do banco as corridas com transição vencida e avança cada uma com um UPDATE condicional na fase atual. Isso deixa o avanço idempotente e retoma sozinho depois de uma queda.
  - Só uma instância executa: há eleição de líder pela chave `engine:leader` no `Store`, com TTL.
  - As fases são agendamento → inscrições → treino → classificação → traçado → corrida → resultados.
  - `runner.ts` simula a corrida e grava o replay em gzip na tabela `race_replays`. Depois publica resultados e rankings e transmite o playback em tempo real pelo hub de WebSocket.
- **Vagas**: as inscrições (`races/entries.ts`) usam `SELECT … FOR UPDATE` mais um `KeyedMutex` por corrida, no lugar de Lua no Redis. Excedeu 22 carros, a inscrição vai para a lista de espera.
- **Auth**: access token JWT HS256 de 15 min mais o cookie de refresh `tracado_rt`. O refresh é rotativo e detecta reuso. Requisições que mudam estado exigem o header `x-tracado-csrf: 1`. Senhas usam Argon2id.
- **Banco**:
  - O schema está em `src/db/schema.ts` e as migrações em `drizzle/`.
  - A migração roda no boot, com advisory lock no Postgres.
  - Postgres e PGlite passam pelo mesmo código Drizzle. Evite recursos que o PGlite não suporta.
- **Rotas de dev** (`modules/misc/dev.ts`, só com `ENABLE_DEV_ROUTES`):
  - `/dev/clock/advance` e `/dev/clock/reset` controlam o relógio do servidor.
  - `/dev/engine/tick` força um tick do motor.
  - `/dev/mail` lista os e-mails enviados (o mailer só grava no log).
  - O E2E depende delas para acelerar as fases.
- **Build**:
  - O tsup embute tudo menos `@electric-sql/pglite` e `@node-rs/argon2`, que têm WASM ou binário nativo.
  - `scripts/runtime-package.mjs` gera `dist/package.json` só com esses dois pacotes.
  - Ao adicionar uma dependência nativa, inclua-a nos dois lugares.
- **Testes** (`apps/api/test`): `setupApp()` em `helpers.ts` sobe o app com PGlite em memória, `ENGINE_ENABLED=false` e relógio manual. Os helpers aceitam os tokens marcadores `'ADMIN'` e `'USER:<id>'`, que geram um JWT válido no relógio atual.

### Web (`apps/web`): React 19 + Vite 6 + Tailwind 4 + PixiJS 8

- Estado do servidor no TanStack Query e sessão no Zustand (`lib/session`). `lib/api` refaz a requisição depois de renovar o token num 401.
- `lib/realtime`: cliente WebSocket com `lastSeq` para retomar e reconexão com backoff. Os eventos atualizam o cache do Query direto em `lib/queries`.
- `game/scene.ts`: a pista é desenhada em vetor com as cores do racing_pack e os carros são sprites do atlas.
- `game/playback.ts`: `FrameBuffer` interpola os frames de 4 Hz usando o relógio sincronizado.
- Tailwind 4: classes de componente se declaram com `@utility` em `styles.css`. O `@apply` de classes próprias não funciona.
- Os assets estão em `src/assets/racing_pack` (licença CC0, créditos em `CREDITS.md`).
- `pages/Box.tsx` concentra a preparação: setup, desenho do traçado e treino com carro fantasma. O envio automático do traçado tem uma trava em nível de módulo contra envio duplicado quando o componente remonta após renovar o token.
- As páginas de admin ficam em `pages/admin/` e incluem o editor de pistas.

## Deploy (VPS com Dokploy)

- `infra/nginx.conf` serve a SPA.
  - `index.html` (inclusive o fallback) vai com `Cache-Control: no-cache`; os assets com hash, com `public, max-age=31536000, immutable`.
  - Faz proxy de `/api` e upgrade de `/ws`. O prefixo `/api` é removido (as rotas da API não têm prefixo) e o `proxy_cookie_path` corrige o path do cookie de refresh. O proxy do Vite faz o mesmo em dev.
  - Mexeu no Nginx? Confira com `curl -I`.
- Depois do push com autodeploy, só diga que publicou depois de três checagens:
  - o hash do bundle no HTML do domínio bate com o do build local;
  - a rota de saúde (`/api/health` pelo Nginx, `/health` na API) responde;
  - os cabeçalhos de cache estão certos.
- Backup e restore do Postgres: `infra/backup/`.
