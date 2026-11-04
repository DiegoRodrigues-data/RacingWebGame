# ROADMAP — Traçado: corrida estratégica multiplayer (web, 2D top-down)

Acompanhamento da implementação completa e funcional do projeto.
Marque cada item conforme for concluído: `[ ]` → `[x]`.

**Legenda de status das fases:** ⬜ Não iniciada · 🟡 Em andamento · ✅ Concluída

Fonte dos requisitos: `claude_prompt_generator/output/20261103_231003_criar-um-jogo-web-de-corrida-multplayer-em-que-o-servid.md`

---

## Estado atual (04/11/2026)

**Funcional e testado:** monorepo completo; API (auth, corridas, inscrições com limite de 22, traçado, setup, motor de fases, simulação, resultados, rankings, notificações, admin, WebSocket); web (portal, calendário, box com traçado/setup/treino, ao vivo, replay, resultado, rankings, perfil, painel admin, editor de pistas); geração procedural determinística; balanceamento automático.

**Verificação executada:** 83 testes unitários/integração (Vitest), 6 testes E2E (Playwright, desktop e celular), lint, typecheck, build de produção, bundle da API rodando a partir da instalação mínima de produção, `pnpm audit` sem vulnerabilidades, teste de carga local (500 sockets, 60 inscrições simultâneas).

**Não verificado (falta ambiente):** build das imagens Docker, Postgres e Redis reais, deploy na VPS com Dokploy, GitHub Actions, determinismo em Firefox/Safari.

**Assets (`racing_pack/`, Kenney, CC0):** atlas de veículos e objetos e PNGs dos carros copiados para `apps/web/src/assets/racing_pack/` (com hash no build). Tiles de pista não são usados: a pista é vetorial com as cores dos tiles (ver DECISIONS.md).

---

## Decisões de stack (como implementado)

| Camada                 | Escolha                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Monorepo               | pnpm workspaces + Turborepo                                                                      |
| Frontend               | React 19 + Vite 6 + Tailwind 4 + PixiJS 8 + TanStack Query + Zustand + Motion                    |
| Backend                | Node 22 + Fastify 5 + `ws` (protocolo próprio v1) + Zod 4                                        |
| Banco                  | PostgreSQL 16 via Drizzle ORM; PGlite (Postgres em WASM) em dev/testes                           |
| Cache / estado volátil | Redis 7 (`RedisStore`) ou memória (`MemoryStore`), mesma interface                               |
| Agendador              | Motor de fases próprio dirigido pelo banco (substituiu BullMQ; ver DECISIONS.md)                 |
| Auth                   | Argon2id, JWT 15 min + refresh rotativo em cookie httpOnly, RBAC `player`/`track_editor`/`admin` |
| Observabilidade        | pino, Prometheus (`/metrics`), Sentry e OpenTelemetry opcionais por env                          |
| Testes                 | Vitest, Playwright, script de carga em Node                                                      |
| Hospedagem             | Docker Compose (web Nginx + api + postgres + redis + backup) para Dokploy                        |

**Modelo de jogo:** o jogador não dirige em tempo real. Define traçado + setup + estratégia; o servidor simula de forma determinística e transmite por WebSocket.

---

## Fase 0 — Fundação do monorepo e infraestrutura local ✅

Sem isso nenhuma outra fase compila, roda ou testa.

- [x] Criar o monorepo: `apps/web`, `apps/api`, `packages/shared`, `packages/sim`, `packages/trackgen`, `e2e`, `infra/` (componentes de UI ficaram em `apps/web`, sem `packages/ui`)
- [x] Configurar pnpm workspaces, Turborepo, TypeScript `strict`, ESLint + Prettier, Husky + lint-staged
- [x] `docker-compose.yml` de desenvolvimento com Postgres 16 e Redis 7, mais `.env.example` documentado
- [x] `apps/api`: Fastify com CORS, cookies, rate limit, helmet, compressão, validação Zod, rota `GET /health` (checa banco e Store)
- [x] `apps/web`: Vite + React + Tailwind, React Router, layout base, tema visual (paleta, tipografia, animações)
- [x] Drizzle com pasta de migrações e scripts `db:generate`, `db:migrate`, `db:seed`
- [x] Logger pino com `requestId`; Sentry desligado por padrão via env
- [x] Copiar assets do `racing_pack/` para o app web e criar `CREDITS.md` com atribuição à Kenney (CC0)
- [x] Pipeline de CI (`.github/workflows/ci.yml`): lint, typecheck, testes, build, balanceamento e E2E — **escrito, não executado no GitHub**
- [x] `README.md` com comandos e instruções

## Fase 1 — Autenticação, contas e perfis ✅

Jogar exige conta; regiões do perfil alimentam os rankings local/regional/nacional.

- [x] Tabelas `users`, `profiles`, `refresh_tokens`, `one_time_tokens` (papéis em `users.roles`)
- [x] `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`
- [x] Hash Argon2id, JWT de 15 min + refresh rotativo de 30 dias em cookie httpOnly/SameSite=Strict
- [x] `requireAuth` e `requireRole('admin' | 'track_editor')`
- [x] Rate limit em login/registro e bloqueio progressivo por conta
- [x] Telas: cadastro, login, recuperação de senha (link registrado no log), confirmação de e-mail, edição de perfil com região
- [x] Admin inicial via variáveis de ambiente
- [x] Testes: duplicidade, login inválido, bloqueio, refresh com rotação e reuso, expiração, acesso negado por papel

## Fase 2 — Domínio de corridas, agendamento e máquina de estados ✅

O servidor é a autoridade sobre horários e fases.

- [x] Entidades: `categories`, `events`, `races`, `tracks`, `track_versions` (fases como colunas de horário em `races`)
- [x] Estados em `packages/shared/src/phases.ts`: `scheduled → registration_open → practice → trace_window → setup_lock → qualifying → race → finished → archived`, mais `cancelled`
- [x] Configuração por corrida: horário, durações (traçado fixo em 5 min), voltas, categoria, pista, ranqueada, clima, capacidade e fila
- [x] Tabela de transições + funções puras `nextTransition`, `duePhase`, `canTransition`
- [x] Agendador: motor de fases com `UPDATE` condicional e eleição de líder (substituiu BullMQ)
- [x] Relógio do servidor como fonte única: `GET /time` e `serverTime` em todo evento WS
- [x] Recuperação automática no boot de corridas atrasadas (transições em cadeia)
- [x] `GET /races`, `GET /races/:id`, `GET /events`
- [x] Testes: transições válidas/inválidas, ticks concorrentes sem dupla transição, recuperação após queda

## Fase 3 — Inscrição com limite de 22 vagas ✅

Regra de negócio central e caso de concorrência explícito nos requisitos.

- [x] Tabela `entries` com índice único `(race_id, user_id)` e status `confirmed | waitlisted | cancelled | withdrawn | dnf`
- [x] Lock da vaga com `SELECT … FOR UPDATE` + mutex por corrida (substituiu Redis Lua)
- [x] Regras: inscrição só com inscrições abertas; cancelamento promove o primeiro da fila; fila com tamanho configurável; encerramento no treino
- [x] Limite de inscrições em corridas com horários sobrepostos (`SCHEDULE_CONFLICT`)
- [x] `POST /races/:id/entries`, `DELETE /races/:id/entries/me`, `GET /races/:id/entries`
- [x] Evento WS `race.capacity` em tempo real
- [x] Cor/modelo/número de carro sem duplicatas entre os 22
- [x] Testes: 23ª vai para a fila; duas simultâneas na última vaga ⇒ uma confirmada e uma na fila; 50 paralelas ⇒ 22/10/18; promoção da fila

## Fase 4 — Camada WebSocket, salas, reconexão e presença ✅

Todas as fases ao vivo dependem desse canal.

- [x] Servidor `ws` com ticket de uso único (`POST /auth/ws-ticket`), heartbeat e timeout
- [x] Protocolo versionado: envelope `{ v, type, room, seq, serverTime, payload }`; mensagens do cliente validadas com Zod
- [x] Salas `lobby`, `race:{id}`, `user:{id}`; pub/sub pelo Store para múltiplas instâncias
- [x] Snapshot ao entrar; deltas depois
- [x] Reconexão com `lastSeq`: reenvio do buffer (300 eventos) ou snapshot novo
- [x] Presença: contagem de sockets no painel (ausência não cancela inscrição)
- [x] Anti-flood (40 msgs/10 s), limite de salas e de tamanho de mensagem
- [x] Cliente com reconexão (backoff + jitter), sincronização de relógio e indicador de latência
- [x] Testes: reconexão recebe a fase nova, mensagem inválida descartada, sala privada proibida, flood encerra

## Fase 5 — Geração procedural de pistas (determinística) ✅

Precisa ser reproduzível para auditoria e replay.

- [x] PRNG sfc32 semeado por `seed` + `params` + `generatorVersion`
- [x] Pontos aleatórios → fecho convexo → deslocamento → Catmull-Rom centrípeta → suavização → reamostragem
- [x] Validação: proximidade/autointerseção, raio mínimo, largura mínima, comprimento, nº de curvas, reta de largada, boxes
- [x] Setores (3), largada/chegada, grid de 22, boxes, bordas
- [x] Terreno por pista (asfalto, terra, areia, misto por trechos)
- [x] Renderização: vetorial com as cores dos tiles do racing_pack (tiles descartados por serrilhado nas curvas)
- [x] Decoração procedural com sprites (tribunas, tendas, pneus, árvores, pedras)
- [x] Metadados e hash persistidos em `track_versions`; geometria regenerada e conferida pelo hash
- [x] Mesma função no cliente (editor/treino) e no servidor
- [x] Testes: mesma seed ⇒ mesmo hash, hash de referência fixo, reconstrução pela origem, 1.000 seeds válidas, fallback por complexidade

## Fase 6 — Renderização da pista e do carro (PixiJS) ✅

Base visual compartilhada por traçado, treino, classificação e corrida.

- [x] Atlas `spritesheet_vehicles` e `spritesheet_objects` lidos do XML
- [x] `TrackCanvas` com camadas: terreno, pista, decoração, linhas, carros, marcadores
- [x] Câmera com zoom e pan (mouse, roda, pinça e dois dedos) e modo "seguir carro"
- [x] Sprite de carro orientado pela direção e marcas de pneu nas curvas
- [x] Clima: camada de chuva sobre a pista durante a corrida
- [x] Minimapa e indicador de setores
- [ ] Medir ≥ 50 fps com 22 carros em celular intermediário (não medido em aparelho real)
- [x] Acessibilidade: rótulos com número, contraste, `prefers-reduced-motion` e opção no perfil

## Fase 7 — Janela de traçado de 5 minutos ✅

Interação principal do jogador.

- [x] Formato `{ points: Array<{ s, d }> }` com 64–1.024 pontos (o cliente envia 256)
- [x] Ferramentas (1ª versão): desenhar à mão, borracha, mover, desfazer/refazer (Ctrl+Z), linha sugerida, linha central, Chaikin
- [x] Editor por pontos de controle: a linha começa no centro e o jogador arrasta pontos a cada ~60 m (spline Catmull-Rom), ajuste fino por botões e toque duplo para centralizar; substitui o desenho à mão
- [x] Projeção para `(s, d)`; pontos fora da pista limitados à borda e destacados em vermelho
- [x] Validação no servidor: monotonicidade, cobertura, `|d| ≤ 1`, taxa lateral, 1 envio a cada 2 s
- [x] Envio automático a cada alteração; o último válido antes do prazo vale; rascunho local antes da janela é enviado ao abrir
- [x] Contagem regressiva sincronizada; `TRACE_WINDOW_CLOSED` após o prazo
- [x] Sem traçado válido: linha central com penalidade de 1,5% de ritmo
- [x] Eventos WS: `trace.window_opened`, `trace.saved`, `trace.rejected`, `trace.window_closed`
- [x] Testes: fora da pista, após o prazo, parcial, invertido, zigue-zague, rascunho persistido, E2E pela interface

## Fase 8 — Configuração do carro e modelo de simulação ✅

Profundidade estratégica com balanceamento verificável.

- [x] `CarSetup`: pneu, paradas, calibragem por eixo, asa, motor, câmbio, preparo de terreno, aposta de clima
- [x] Corridas de 30 a 60 voltas e parada obrigatória nos boxes (validação, setup padrão, bots, migração dos dados)
- [ ] Normalizar pela distância as chances de safety car, óleo, rodada e falha mecânica (hoje crescem com o número de voltas)
- [x] Contexto da corrida: terreno, clima base, temperatura, chance de chuva por volta (previsão com 75% de acerto)
- [x] `packages/sim`: perfil de velocidade por curvatura × aderência, aceleração/frenagem, desgaste, calibragem, determinístico
- [x] Trade-offs explícitos (asa, pneu, câmbio, motor, terreno, clima)
- [x] Efeito do traçado emergente da geometria da linha (a linha sugerida vence a central em ≥ 80% das pistas)
- [x] Eventos semeados por categoria (safety car, óleo, falha mecânica, furo, rodada, clima)
- [x] Tela de setup com prévia de tempo seco/chuva, velocidade, desgaste por volta e limites da categoria
- [x] Setup gamificado: garagem com o carro, ficha técnica (velocidade, curvas, pneus, confiabilidade, chuva) e nota, cartões de pneu/motor/terreno/clima, manômetros com faixa ideal, barra de stints e dicas do engenheiro
- [x] Escolha do carro na corrida (cor e modelo livres, só visual) com `PUT /races/:id/car`
- [x] `PUT/GET /races/:id/setup` com limites por categoria
- [x] Script de balanceamento (`pnpm balance`): estratégia mais vencedora 22%, maior lift 1,72
- [x] Testes: determinismo, limites, setup após o travamento, trade-offs, Chromium = Node

## Fase 9 — Treino, classificação, corrida e resultado ✅

Fecha o ciclo de vida com resultados persistidos.

- [x] **Treino:** volta e corrida de teste locais contra 5 fantasmas; tempos de referência do servidor
- [x] Treino com o carro na pista: volta lançada animada (1×/2×/5×, parciais por setor) e corrida de teste em replay com os 6 carros, posições ao vivo e controles
- [x] **Classificação:** volta lançada simulada no servidor; empate pela ordem de confirmação
- [x] **Corrida:** simulação completa com replay a 4 Hz gravado comprimido em `race_replays`
- [x] Transmissão: `race.started`, `race.tick`, `race.incident`, `race.finished`; replay sem revelar o futuro
- [x] Desistência, abandono (DNF) e queda de conexão (não afeta o resultado)
- [x] `race_results` gravado na mesma transação da mudança de fase e dos rankings
- [x] Telas: box, grid, ao vivo com semáforo e classificação, resultado com pódio e replay com controle de velocidade
- [x] Detalhe da corrida com barra de fases e contagem regressiva
- [x] Testes: ciclo completo (integração e E2E), reprocessamento idêntico

## Fase 10 — Rankings local, regional, nacional e mundial ✅

- [x] Pontuação configurável por categoria (padrão 25-18-15-12-10-8-6-4-2-1 + 1 pela volta mais rápida) × multiplicador
- [x] `seasons`, `season_memberships`, `ranking_entries` com índice de ordenação
- [x] Escopos pelo perfil; vínculo regional congelado na temporada
- [x] Atualização transacional + cache de páginas no Store; `rebuild` completo para auditoria
- [x] Desempate: vitórias → pódios → voltas mais rápidas → menos corridas → entrada mais antiga
- [x] Só corridas ranqueadas e não anuladas pontuam; anulação reverte; mínimo de corridas configurável
- [x] Temporadas com encerramento e histórico
- [x] `GET /rankings`, `GET /users/:id`
- [x] Telas: rankings por escopo com "você" fixado, perfil público com histórico, conquistas e posição por escopo
- [x] Testes: pontuação, desempate, vínculo congelado, anulação, rebuild idempotente

## Fase 11 — Categorias, níveis e corridas ranqueadas ✅

- [x] Categorias com nível, limites de setup, pista, voltas, clima, eventos, pontuação, requisitos e velocidade de transmissão
- [x] Corrida ranqueada ou amistosa
- [x] Elegibilidade na inscrição e promoção/rebaixamento no fim da temporada
- [x] Filtro de categoria no calendário
- [x] Testes: inscrição negada por nível, multiplicador de categoria

## Fase 12 — Painel administrativo e editor de pistas especiais ✅

- [x] `/admin` protegido por papel, com `admin_audit_log`
- [x] Categorias, eventos e corridas, inclusive geração em lote ("12h, 18h e 21h de X a Y")
- [x] Editar parâmetros antes do treino; cancelar com notificação; anular resultado; auditar por reprocessamento
- [x] Editor: mover/adicionar/remover pontos, largura por ponto, terreno por trecho, posição da largada, importar seed
- [x] Validação idêntica à procedural, com problemas marcados no canvas
- [x] Prévia com tempo de volta estimado pelo servidor
- [x] Versionamento imutável `draft → review → published → deprecated`; corrida usa versão específica
- [x] `track_editor` cria e submete; só `admin` publica
- [x] Dashboard: corridas do dia, inscrições, erros do motor, sockets, contas sinalizadas
- [x] Testes: publicação sem permissão negada, pista inválida não publica, corrida mantém versão antiga, E2E do editor

## Fase 13 — Portal público, lobby, notificações e identidade visual ✅

- [x] Portal: próximas corridas, destaques do ranking, últimos resultados, chamada para criar conta
- [x] Grade automática: uma corrida amistosa por hora (24 por dia), inscrições abertas a todos; ranqueadas e competições pelo admin
- [ ] Apagar replays antigos (a grade automática grava cerca de 20 MB por dia com bots ligados)
- [x] Cards de corrida com mini mapa da pista; corridas ao vivo mostram os carros andando (cauda do replay + `race.tick`)
- [x] Animação da home dentro do SVG (carros na linha em qualquer largura) e sem rolagem horizontal no celular
- [x] Lobby: minhas corridas com fase e atalhos para box, ao vivo e resultado
- [x] Calendário por dia/semana com filtros
- [x] Notificações in-app (central + toasts via WS) e lembretes por e-mail opcionais (e-mail ainda só no log)
- [x] Identidade visual: paleta, tipografia esportiva, animações, semáforo, confete, rival à frente e atrás no resultado
- [x] Progressão: nível, XP, conquistas
- [x] Layout responsivo; canvas com toque e sem rolagem acidental
- [x] Acessibilidade: teclado, foco visível, contraste, `prefers-reduced-motion`, rótulos
- [x] Página 404, estados vazios e skeletons

## Fase 14 — Segurança e antitrapaça ✅

- [x] Toda regra recalculada no servidor; o cliente só sugere
- [x] Hash de entradas, resultado e pista; reprocessamento administrativo
- [x] Rate limit por rota e por socket; limite de payload; apelidos validados
- [x] Multiconta básica: verificação de e-mail, limite por IP, sinalização para revisão
- [x] Cabeçalhos de segurança, CSRF no refresh, rotação com detecção de reuso
- [x] Teste de carga (script Node): 500 sockets e 60 inscrições simultâneas, sempre 22 confirmadas
- [x] `pnpm audit`: sem vulnerabilidades (zod 4 e drizzle 0.45); segredos fora do repositório

## Fase 15 — Observabilidade, testes de fluxo crítico e critérios de aceitação ✅

- [x] Métricas: duração HTTP, sockets, mensagens, inscrições, atraso das transições, tick do motor, simulação, erros
- [x] Logs com `raceId`; aviso para transição atrasada > 5 s; erros do motor no painel
- [x] E2E (Playwright): cadastro → inscrição → setup → traçado no canvas → corrida acelerada → resultado → ranking
- [x] Concorrência das vagas com 50 requisições paralelas
- [x] Determinismo cross-runtime: Chromium = Node (Firefox/Safari não testados)
- [x] Critérios de aceitação:
  - [x] A 23ª inscrição entra na fila; com a fila cheia recebe `RACE_FULL`; duas simultâneas na última vaga ⇒ exatamente 1 confirmada
  - [x] Envio 1 s após o prazo ⇒ `TRACE_WINDOW_CLOSED`; ponto com `|d| > 1` ⇒ `TRACE_OUT_OF_BOUNDS`
  - [x] Cliente reconectado recebe a fase atual (eventos perdidos ou snapshot)
  - [x] Mesma seed/params/versão ⇒ mesmo hash de pista
  - [x] `track_editor` não publica; `admin` publica apenas pista válida
  - [x] Reprocessamento reproduz o resultado persistido
- [x] `DECISIONS.md` com riscos e decisões pendentes

## Fase 16 — Deploy na VPS com Dokploy 🟡

- [x] `Dockerfile` da API (bundle + 3 dependências de runtime) e do web (Nginx)
- [x] Nginx: `no-cache` no `index.html` e no fallback da SPA; `immutable` nos assets com hash
- [x] `docker-compose.prod.yml`: web, api, postgres, redis, backup, com healthchecks
- [x] WebSocket pelo Nginx (upgrade) atrás do Traefik
- [x] Migrações na subida da API com lock consultivo
- [x] Backup diário com retenção e script de restauração
- [ ] Construir as imagens e subir o compose (Docker indisponível nesta máquina)
- [ ] Validar com Postgres e Redis reais
- [ ] Push, autodeploy no Dokploy, hash do bundle no domínio igual ao local, `curl -I` nos cabeçalhos de cache e `GET /api/health`
- [ ] Sentry e métricas apontando para produção

---

## Ordem recomendada (próximos passos)

1. Rodar `docker compose -f docker-compose.prod.yml up --build` numa máquina com Docker e corrigir o que aparecer.
2. Rodar a suíte com `DATABASE_URL` e `REDIS_URL` reais (`docker compose up -d`).
3. Criar o repositório remoto, fazer o push e configurar o serviço Compose no Dokploy com as variáveis do README.
4. Medir fps no celular e testar determinismo em Firefox e Safari pela página `/dev/determinismo`.
5. Escolher o provedor de e-mail e decidir as pendências listadas em DECISIONS.md.
