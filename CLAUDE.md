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
pnpm balance        # balanceamento da simulação (packages/sim/scripts/balance.ts); sem pnpm no PATH: corepack pnpm --filter @tracado/sim balance
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
- O admin é criado uma vez no boot (`db/bootstrap.ts`); trocar `ADMIN_PASSWORD` depois não muda a senha. Para recuperar o acesso, `ADMIN_RESET_PASSWORD=true` por um deploy.
- O `docker-compose.yml` sobe Postgres e Redis reais para desenvolvimento. O `docker-compose.prod.yml` é o deploy no Dokploy.

## Arquitetura

### Pacotes

Os pacotes são consumidos direto como TypeScript: o `exports` aponta para `src/index.ts` e não há etapa de build.

- `packages/shared`: contrato entre front e back.
  - Schemas Zod e DTOs (`schemas.ts`).
  - Máquina de fases (`phases.ts`: `ALLOWED_TRANSITIONS`, `buildTimeline`, `duePhase`).
  - Envelope e eventos do WebSocket (`ws.ts`).
  - Constantes do jogo, como `MAX_CARS = 22`. A janela de traçado depois do treino foi desligada (`TRACE_WINDOW_MS = 0`); as durações das fases vêm das configurações do jogo (admin).
  - `settings.ts`: `gameSettingsSchema` e `DEFAULT_GAME_SETTINGS` (ver "Configurações do jogo"). `crazy.ts`: DTOs e troféus da Corrida Maluca.
  - `ClockSync`, a sincronização de relógio com o servidor.
  - `AppError` e `ERROR_CODES`.
  - Mudou um DTO? Ajuste aqui primeiro.
- `packages/trackgen`: geração procedural determinística de pistas.
  - PRNG sfc32 com seed cyrb128, spline e validação geométrica.
  - `trace.ts`: o traçado do jogador é uma lista de pontos `(s, d)`, com `s` = distância ao longo da linha central e `d` = deslocamento lateral. O arquivo valida o traçado e converte para coordenadas do mundo.
  - O snapshot do hash golden prende o resultado: se mudar o algoritmo, incremente `GENERATOR_VERSION`.
- `packages/sim`: simulação determinística da corrida.
  - `model.ts`: coeficientes de pneu, aero, motor e pit em `COEF`. O pneu gasta por km (`tyreWear` a cada `wearRefKm`); o máximo de paradas de uma corrida sai da distância (`maxPitStopsFor` em `shared/setup.ts`).
  - `race.ts`: `simulateRace` e `simulateQualifying`.
  - Os frames saem a 4 Hz.
  - Perfil do piloto (`DriverProfile` em `shared/driver.ts`: ataque, defesa, ritmo) e colisões: `COEF.driver`. As regras do admin (`GameSettings.drivers`) entram como `RaceSimInput.rules` e ficam em `simInput`. A simulação usa `setup.driver ?? profiles.driver ?? driverProfileFor(id)`.
  - Ela roda no servidor e no navegador (`probe.ts` e a página `/determinism`). Por isso, nada de `Math.random` nem `Date.now`: toda aleatoriedade vem do PRNG com seed.
  - Cada frame tem 8 números por carro (`CAR_FRAME_STRIDE`: x, y, direção, progresso, pneu, status, desgaste do pneu %, desgaste do motor %); replays antigos têm 6 e o cliente decodifica os dois.
  - Mudou o resultado da simulação? Incremente `SIM_VERSION`: o reprocessamento do admin passa a marcar as corridas antigas como `outdated` em vez de divergentes.
  - Depois de mexer em `COEF`, rode `pnpm balance`.

### API (`apps/api`): Fastify 5 + `ws` + Drizzle

- `buildApp` (`src/app.ts`) recebe as dependências injetadas: config, db, `Store`, `Clock` e logger. Os testes usam `ManualClock` e `MemoryStore`. O servidor usa `SystemClock`, ou `OffsetClock` quando as rotas de dev estão ligadas.
- Os módulos ficam em `src/modules/*`. Em cada um, `service.ts` concentra a regra de negócio e `routes.ts` só valida e chama o serviço.
- **Motor de fases** (`modules/engine/engine.ts`): substitui o BullMQ.
  - Um `tick` periódico lê do banco as corridas com transição vencida e avança cada uma com um UPDATE condicional na fase atual. Isso deixa o avanço idempotente e retoma sozinho depois de uma queda.
  - Só uma instância executa: há eleição de líder pela chave `engine:leader` no `Store`, com TTL.
  - As fases são `scheduled` → `registration_open` → `practice` → `trace_window` → `setup_lock` → `qualifying` → `race` → `finished` → `archived` (ou `cancelled`). Treino e janela de traçado têm duração zero por padrão: o motor passa pelas duas no mesmo tick. O traçado, o setup e o perfil do piloto são editáveis da inscrição até o parque fechado.
  - Na entrada da classificação, `runner.ts` já simula classificação e corrida inteiras e grava o replay em gzip em `race_replays`. A classificação é transmitida aos poucos como sessão de volta lançada (`qualiLive.ts`, `GET /races/:id/qualifying/live`) sem revelar o futuro; o grid só é publicado na largada. Na corrida, o motor transmite os frames pelo hub; em `finished`, publica resultados e rankings.
  - Grade automática e corridas teste (`autoRaces.ts`): corridas criadas sozinhas a partir das configurações do jogo. Os horários da grade repetem as pistas do dia (`tracksPerDay`, por dia de Brasília e categoria, `dayPoolTrack`). Corrida teste é uma só por vez: a próxima nasce na bandeirada da anterior, com terrenos em rodízio.
  - Pistas do dia (`modules/schedule`, tabela `track_plans`, página `/admin/pistas-do-dia`): o admin vê o que entra em cada horário, troca a pista de corridas abertas e reserva especiais para horários ainda não criados (a grade consome a reserva ao criar a corrida).
- **Vagas**: as inscrições (`races/entries.ts`) usam `SELECT … FOR UPDATE` mais um `KeyedMutex` por corrida, no lugar de Lua no Redis. Excedeu 22 carros, a inscrição vai para a lista de espera. Uma inscrição por horário: a corrida ocupa do treino até a bandeirada prevista (voltas × comprimento) mais 2 min (`overlappingRaces`).
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
- **Configurações do jogo** (`modules/settings`, tabela `game_settings`): durações das fases, grade automática, corridas teste, bots, terrenos e cenários com peso, rodízio de pistas salvas e limites da Corrida Maluca. Editadas pelo admin, valem na hora (cache de 5 s por instância) e para corridas criadas daqui em diante. Sem linha salva, os padrões vêm das variáveis antigas (`AUTO_RACES_*`, `DEMO_BOTS`). Use `getSettings(ctx)`; dentro de uma transação do PGlite, leia antes de abrir a transação.
- **Pilotos simulados** (`modules/bots`, tabelas `bot_personas` e `bot_plans`, configurações `botPool`): personas `is_bot` que se inscrevem sozinhas e aos poucos na grade automática e aparecem como gente (sem a marca `bot` no grid, somam no online, entram no ranking salvo `inRanking` desligado). O motor planeja na abertura das inscrições e `runBotPlans` inscreve a cada tick; com o grid cheio, um deles cede a vaga a um humano. Os bots sem persona são os de demonstração (corridas teste, corridas do admin, Corrida Maluca) e continuam marcados.
- **Convidados** (`users.is_guest`): jogam só com apelido, sem e-mail nem senha, pela página `/jogar` ou pelo convite da Corrida Maluca (`POST /auth/guest`, `inviteCode` opcional; o código fica em `modules/crazy/service.ts`). Correm nas corridas abertas e nos grupos, mas não criam grupo; voltam em outro aparelho pelo link `/voltar/:key` ou viram conta normal em Minha conta.
- **Corrida Maluca** (`modules/crazy`): grupos fechados com convite por link. As corridas do grupo têm `crazy_group_id` e ficam fora das listas públicas (`listRaces` só as traz com `crazy: true`). A conta de admin não corre nem entra em grupos (`assertPlayer`).
- **Migrações**: depois de `pnpm db:generate`, confira se o `when` da entrada nova em `drizzle/meta/_journal.json` é maior que o da anterior; o drizzle pula migração com data menor que a última aplicada (`test/migrations.test.ts` cobre). Não rode o prettier sobre `drizzle/meta`.
- **Testes** (`apps/api/test`): `setupApp()` em `helpers.ts` sobe o app com PGlite em memória, `ENGINE_ENABLED=false` e relógio manual. Os helpers aceitam os tokens marcadores `'ADMIN'` e `'USER:<id>'`, que geram um JWT válido no relógio atual. O `createRace` dos helpers (e do E2E) cria corridas com janela de traçado de 120 s para os testes que ainda a exercitam.

### Web (`apps/web`): React 19 + Vite 6 + Tailwind 4 + PixiJS 8

- Estado do servidor no TanStack Query e sessão no Zustand (`lib/session`). `lib/api` refaz a requisição depois de renovar o token num 401.
- `lib/realtime`: cliente WebSocket com `lastSeq` para retomar e reconexão com backoff. Os eventos atualizam o cache do Query direto em `lib/queries`.
- `game/scene.ts`: a pista é desenhada em vetor com as cores do racing_pack e os carros são sprites do atlas. O cenário (`races.biome`: grama, deserto, cânion) muda o fundo e troca a decoração na hora de desenhar, sem mudar a geometria nem o hash da pista.
- `game/audio.ts`: trilha e efeitos sintetizados com Web Audio a partir de notas MIDI escritas no código (sem arquivos de áudio); o som só começa no primeiro gesto do usuário.
- `game/playback.ts`: `FrameBuffer` interpola os frames de 4 Hz usando o relógio sincronizado.
- Tailwind 4: classes de componente se declaram com `@utility` em `styles.css`. O `@apply` de classes próprias não funciona.
- Os assets estão em `src/assets/racing_pack` (licença CC0, créditos em `CREDITS.md`).
- `pages/Box.tsx` concentra a preparação: setup, desenho do traçado e treino com carro fantasma. O envio automático do traçado tem uma trava em nível de módulo contra envio duplicado quando o componente remonta após renovar o token.
- As páginas de admin ficam em `pages/admin/`: configurações do jogo, corridas teste, gerador de pistas por seed (roda o gerador no navegador) e editor de pistas. A conta de admin só vê o painel (`PlayerOnly` em `App.tsx` redireciona as telas de jogador).
- `components/Guest.tsx`: formulário de apelido do convidado (usado em `/jogar` e no convite da Corrida Maluca), link de volta e a página `/voltar/:key`.
- `pages/Crazy.tsx` é a Corrida Maluca (grupos de amigos com convite por link, convidados só com apelido e troféus de zoeira). No servidor fica em `modules/crazy`; as corridas do grupo têm `crazy_group_id` e ficam fora das listas públicas.

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
