# Contratos da API

Base: `/api` no navegador (o Nginx/Vite remove o prefixo). JSON em UTF-8. Datas em ISO 8601 (UTC) ou epoch ms.
Tipos TypeScript e schemas Zod em `packages/shared/src/schemas.ts` e `packages/shared/src/ws.ts`.

## Autenticação e autorização

- **Acesso**: JWT HS256 de 15 min em `Authorization: Bearer <token>`.
- **Refresh**: cookie `tracado_rt` (httpOnly, SameSite=Strict, path `/auth`, 30 dias), rotacionado a cada uso; reuso de um token antigo revoga a família inteira (`TOKEN_REUSED`).
- Rotas que usam o cookie exigem o cabeçalho `x-tracado-csrf: 1`.
- Papéis: `player` (padrão), `track_editor` (cria e submete pistas), `admin` (tudo, inclusive publicar pistas).
- Login com bloqueio progressivo após 5 falhas (15 min, 30 min, … até 24 h). Limites por IP: 10/min nas rotas de autenticação, 20/min em inscrições, 300/min global.

## Erros

```json
{ "error": { "code": "RACE_FULL", "message": "Corrida lotada e fila de espera completa.", "details": null } }
```

| Código                                                                                                                                                                                                              | HTTP | Quando                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------- |
| VALIDATION_ERROR                                                                                                                                                                                                    | 400  | payload inválido (`details`: lista de `{path, message}`) |
| UNAUTHORIZED / INVALID_CREDENTIALS / TOKEN_REUSED                                                                                                                                                                   | 401  | sem sessão, credenciais erradas, reuso de refresh        |
| FORBIDDEN / INELIGIBLE_LEVEL / EMAIL_NOT_VERIFIED                                                                                                                                                                   | 403  | papel ou nível insuficiente                              |
| NOT_FOUND                                                                                                                                                                                                           | 404  | recurso inexistente                                      |
| EMAIL_TAKEN / NICKNAME_TAKEN / ALREADY_REGISTERED / NOT_REGISTERED / RACE_FULL / REGISTRATION_CLOSED / SCHEDULE_CONFLICT / TRACE_WINDOW_CLOSED / SETUP_LOCKED / INVALID_TRANSITION / TRACK_NOT_PUBLISHED / CONFLICT | 409  | regra de negócio                                         |
| TRACE_OUT_OF_BOUNDS / TRACE_INVALID / SETUP_INVALID / TRACK_INVALID                                                                                                                                                 | 422  | validação de domínio (`details.indices` para traçado)    |
| ACCOUNT_LOCKED                                                                                                                                                                                                      | 423  | conta bloqueada (`details.until`)                        |
| RATE_LIMITED / TRACE_RATE_LIMITED                                                                                                                                                                                   | 429  | excesso de requisições / traçado a cada 2 s              |

## REST

| Método e rota                                                                                              | Acesso                         | Descrição                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /auth/register`                                                                                      | público                        | `{email, password, nickname, country, region, city}` → `AuthResponse` + cookie                                                                                                                                                 |
| `POST /auth/login`                                                                                         | público                        | `{email, password}` → `AuthResponse` + cookie                                                                                                                                                                                  |
| `POST /auth/refresh` · `POST /auth/logout`                                                                 | cookie + CSRF                  | renova / encerra a sessão                                                                                                                                                                                                      |
| `POST /auth/forgot-password` · `/auth/reset-password` · `/auth/verify-email` · `/auth/resend-verification` | público / jogador              | tokens de uso único por e-mail                                                                                                                                                                                                 |
| `POST /auth/ws-ticket`                                                                                     | jogador                        | `{ticket}` de uso único (60 s) para o WebSocket                                                                                                                                                                                |
| `GET /auth/providers`                                                                                      | público                        | provedores de login disponíveis (`{ google }`)                                                                                                                                                                                 |
| `GET /auth/google/start?next` · `GET /auth/google/callback`                                                | público                        | login com Google (OAuth + PKCE); conta nova vai para `/conta?bemvindo=1`                                                                                                                                                       |
| `GET /s/maluca/:code` · `GET /s/grupo/:id`                                                                 | público                        | prévia (Open Graph) do convite da Corrida Maluca e da página do grupo (tabela, resenha, campeão; sem o código do convite)                                                                                                      |
| `POST /auth/change-password`                                                                               | jogador                        | `{currentPassword, newPassword}`: troca a senha e encerra as outras sessões                                                                                                                                                    |
| `GET /s/corridas/:id`                                                                                      | público                        | página de compartilhamento com Open Graph; redireciona para a corrida                                                                                                                                                          |
| `GET /me` · `PATCH /me/profile`                                                                            | jogador                        | perfil (mudança de região vale na próxima temporada); `driver: {attack, defense, pace}` (0–100) é o perfil do piloto, e `profile.driverChosen` diz se ele foi salvo ou é o sorteado                                            |
| `GET /me/races`                                                                                            | jogador                        | minhas corridas (inscrito ou na fila), mais recentes primeiro                                                                                                                                                                  |
| `GET /lobby`                                                                                               | público                        | ao vivo, próximas, resultados recentes, top 5, minhas corridas                                                                                                                                                                 |
| `GET /races?from&to&category&status&ranked&test&limit&order`                                               | público                        | calendário (`RaceSummaryDto[]`, com `track.biome` = cenário); `test=true                                                                                                                                                       | all` inclui as corridas teste |
| `GET /races/:id`                                                                                           | público                        | `RaceDetailDto` (inscritos, previsão por volta, `me` se logado)                                                                                                                                                                |
| `POST /races/:id/entries` · `DELETE /races/:id/entries/me`                                                 | jogador                        | inscrever (também no treino e no traçado, se houver vaga, até o parque fechado) / cancelar ou desistir                                                                                                                         |
| `PUT /races/:id/car`                                                                                       | jogador confirmado             | trocar cor e modelo do carro até o parque fechado (`CAR_TAKEN` se ocupado)                                                                                                                                                     |
| `PUT /races/:id/trace` · `GET /races/:id/trace`                                                            | jogador confirmado             | enviar / ler o próprio traçado (da inscrição ao parque fechado)                                                                                                                                                                |
| `PUT /races/:id/setup` · `GET /races/:id/setup`                                                            | jogador inscrito               | salvar / ler o próprio setup                                                                                                                                                                                                   |
| `GET /races/:id/practice`                                                                                  | público                        | linha sugerida, tempos de referência e limites de setup                                                                                                                                                                        |
| `GET /races/:id/qualifying` · `/results` · `/replay`                                                       | público                        | após cada fase; o replay revela só até o instante atual; `?tail=N` traz só os últimos N frames e `fromFrame`                                                                                                                   |
| `GET /races/:id/qualifying/live?from=N`                                                                    | público                        | sessão de classificação ao vivo: carros na ordem de saída, parciais e voltas já fechadas e os frames a partir de `from` até agora; durante a fase, `/qualifying` traz só as voltas fechadas                                    |
| `GET /tracks/versions/:id` · `/geometry`                                                                   | público (publicadas)           | geometria imutável, cache de 1 ano                                                                                                                                                                                             |
| `GET /rankings?scope&key&season&page&pageSize`                                                             | público                        | `RankingPageDto` (escopos `local`, `regional`, `national`, `world`)                                                                                                                                                            |
| `GET /events` · `GET /events/:id`                                                                          | público                        | eventos publicados (com corridas por vir, encerradas e próxima largada) / evento com as corridas dele                                                                                                                          |
| `GET /seasons` · `GET /categories` · `GET /users/:id` · `GET /time`                                        | público                        | apoio                                                                                                                                                                                                                          |
| `POST /auth/guest`                                                                                         | público                        | Corrida Maluca: `{inviteCode, nickname, carColor}` cria um convidado (sem e-mail nem senha), entra no grupo e devolve `AuthResponse` + `groupId` + cookie; apelido repetido responde `NICKNAME_TAKEN` com `details.suggestion` |
| `POST /auth/guest/resume` · `POST /auth/guest/upgrade`                                                     | público / convidado            | entrar pelo link pessoal de volta (`{key}`) / virar conta normal (`{email, password}`, mantém apelido e histórico)                                                                                                             |
| `GET /crazy/groups` · `POST /crazy/groups`                                                                 | jogador (criar: não convidado) | meus grupos / criar grupo com 1 a 10 corridas (`{name, races, laps, startAt, intervalMinutes, chaos, botFill}`)                                                                                                                |
| `GET /crazy/groups/:id`                                                                                    | público                        | calendário, tabela entre os amigos, troféus de cada corrida e títulos de honra; `inviteCode` só para membros                                                                                                                   |
| `GET /crazy/invite/:code` · `POST /crazy/invite/:code/join`                                                | público / jogador              | prévia do convite / entrar no grupo (inscreve nas corridas que ainda não fecharam o parque)                                                                                                                                    |
| `PUT /races/:id/ready` · `POST /races/:id/start-now`                                                       | piloto do grupo / organizador  | Corrida Maluca, no treino ou na janela de traçado: `{ready}` marca "Estou pronto" (todos prontos pulam o preparo) / largar já com metade da turma pronta; respondem `{humans, ready, skipped}`                                 |
| `POST /crazy/guest-link`                                                                                   | convidado                      | gera o link pessoal de volta (substitui o anterior)                                                                                                                                                                            |
| `GET /settings`                                                                                            | público                        | durações das fases e limites da Corrida Maluca em vigor                                                                                                                                                                        |
| `GET /notifications` · `POST /notifications/:id/read` (`id` ou `all`)                                      | jogador                        | notificações                                                                                                                                                                                                                   |
| `GET /health` · `GET /metrics`                                                                             | público / token                | saúde (DB e Store) e Prometheus                                                                                                                                                                                                |

### Administração (`admin`, salvo indicação)

`GET /admin/dashboard` · `GET /admin/audit` · `GET|POST|PATCH /admin/categories` · `GET|POST|PATCH /admin/events` ·
`POST /admin/races` · `POST /admin/races/batch` · `PATCH /admin/races/:id` (só agendada ou com inscrições abertas) ·
`POST /admin/races/:id/cancel {reason}` · `POST /admin/races/:id/annul {reason}` · `POST /admin/races/:id/reprocess` ·
`GET /admin/tracks` _(editor)_ · `POST /admin/tracks/preview` _(editor)_ · `POST /admin/tracks` _(editor)_ ·
`POST /admin/tracks/:id/versions` _(editor)_ · `PATCH /admin/tracks/versions/:id` _(editor, só rascunho)_ ·
`POST /admin/tracks/versions/:id/submit` _(editor)_ · `.../publish` · `.../reject` · `.../deprecate` ·
`POST /admin/seasons` · `POST /admin/seasons/:id/close` · `POST /admin/rankings/rebuild` · `GET|PATCH /admin/users`.
O `.../deprecate` devolve `retired: {pool, plans, races}`: a pista sai do rodízio, as reservas são apagadas e as
corridas ainda abertas que a usavam passam para uma pista gerada. Toda ação administrativa grava em `admin_audit_log`.

Configurações e painel (admin):

| Método e rota                                 | Descrição                                                                                                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/settings` · `PUT /admin/settings` | configurações do jogo (`GameSettings`), categorias disponíveis e pistas do rodízio; o PUT valida categorias e pistas publicadas e vai para a auditoria                                                                            |
| `POST /admin/tracks/from-seed`                | `{name?, seed, params, addToPool}`: salva a pista da seed como oficial (e no rodízio)                                                                                                                                             |
| `GET /admin/stats`                            | jogadores, corridas por dia (14 dias), terrenos, grupos ativos e próximas corridas                                                                                                                                                |
| `GET /admin/bots`                             | pilotos simulados: configuração (`botPool`), resumo (ligados, ativos hoje, online agora, inscrições na fila) e lista com persona, corridas e pontos                                                                               |
| `PATCH /admin/bots/:id`                       | `{active?, skill?, aggression?, pitRisk?, joinRate?, hourFrom?, hourTo?, driver?}`; desligar tira o piloto das corridas ainda abertas (`leftRaces`) e vai para a auditoria                                                        |
| `POST /admin/bots`                            | `{count}` (1–30): cria mais personas além do rodízio                                                                                                                                                                              |
| `POST /admin/settings/drivers/test`           | `{rules, races?}`: simula corridas com as regras de perfil e colisões (sem salvar) e devolve toques, abandonos e posição média por faixa do perfil                                                                                |
| `GET /admin/track-day?day=AAAA-MM-DD`         | pistas do dia (horário de Brasília; padrão hoje): cada horário da grade e as corridas avulsas com pista, origem (`auto`, `pool`, `admin`), reserva e se dá para trocar; e as especiais publicadas com quantas vezes entram no dia |
| `PUT /admin/track-day/slots/:at`              | `{trackVersionId \| null}`: reserva uma especial para um horário da grade que ainda não virou corrida (null tira a reserva); usada quando a corrida é criada                                                                      |
| `PUT /admin/races/:id/track`                  | `{trackVersionId \| null}`: troca a pista de uma corrida aberta até 1 min antes do parque fechado (null gera outra); apaga os traçados salvos e avisa os inscritos (`track_changed`)                                              |
| `PUT /admin/track-day/pool`                   | `{trackVersionId, inPool}`: põe ou tira uma especial do rodízio da grade                                                                                                                                                          |

### Exemplos

```http
POST /races/0b5c…/entries
Authorization: Bearer eyJ…

201 { "status": "waitlisted", "waitlistPosition": 1,
      "capacity": { "raceId": "0b5c…", "capacity": 22, "confirmed": 22, "waitlisted": 1, "waitlistMax": 10, "free": 0 } }
```

```http
PUT /races/0b5c…/trace
{ "points": [ { "s": 0, "d": 0.12 }, { "s": 0.0039, "d": 0.15 }, … 256 pontos … ] }

200 { "version": 3, "submittedAt": "2026-11-04T21:03:12.000Z" }
422 { "error": { "code": "TRACE_OUT_OF_BOUNDS", "message": "2 ponto(s) fora dos limites da pista.", "details": { "indices": [40, 41] } } }
```

```http
PUT /races/0b5c…/setup
{ "tyre": "soft", "pitStops": [{ "lap": 18, "tyre": "medium" }], "tyrePressure": { "front": 22.5, "rear": 23 },
  "aero": 6, "engine": "balanced", "gearing": 4, "terrainPrep": "asphalt", "weatherBet": "mixed" }
```

Toda corrida tem de 30 a 60 voltas e exige ao menos uma parada: `pitStops` vazio responde `422 SETUP_INVALID`
("Parada obrigatória…"). Cada parada precisa ficar antes da última volta e respeitar o máximo de paradas da corrida: o `maxPitStops` da
categoria ou, em corridas longas, uma a cada 20 km (`maxPitStopsFor`, até 8). O `GET /races/:id/practice` já devolve
`limits.maxPitStops` com esse valor.

## WebSocket (`/ws`, protocolo v1)

Conexão: `wss://host/ws?ticket=<ticket>` (sem ticket = visitante). Ticket inválido fecha com código `4401`.

Envelope servidor → cliente:

```ts
{ v: 1, type: 'race.phase', room: 'race:<id>', seq: 42, serverTime: 1793761782696, payload: { … } }
```

Cliente → servidor:

```ts
{ type: 'subscribe', room: 'race:<id>', lastSeq?: 41 }   // salas: lobby, race:<id>, user:<seu id>
{ type: 'unsubscribe', room: 'race:<id>' }
{ type: 'ping', clientTime: 1793761782000 }              // resposta 'pong' com serverTime (sincronização de relógio)
```

Reconexão: ao assinar com `lastSeq`, o servidor reenvia os eventos perdidos do buffer da sala (300 últimos);
se o buffer não cobrir o intervalo, envia um `race.snapshot` novo. Sem `lastSeq`, sempre envia o snapshot.
A sala `user:<id>` é assinada automaticamente para conexões autenticadas.

| Evento                                        | Sala   | Payload                                                                                                                                                                                    |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hello`                                       | direto | `{connectionId, userId, protocol}`                                                                                                                                                         |
| `race.snapshot`                               | race   | resumo, inscritos e, durante a corrida, últimos frames e incidentes                                                                                                                        |
| `race.phase`                                  | race   | `{raceId, from, to, phaseDeadline, race}`                                                                                                                                                  |
| `race.capacity` / `race.entries`              | race   | vagas e lista de inscritos em tempo real                                                                                                                                                   |
| `trace.window_opened` / `trace.window_closed` | race   | `{raceId, deadline}`                                                                                                                                                                       |
| `trace.saved` / `trace.rejected`              | user   | confirmação ou motivo da recusa                                                                                                                                                            |
| `race.qualifying`                             | race   | grid final (`QualifyingRowDto[]`), enviado na largada, depois da sessão ao vivo                                                                                                            |
| `race.started`                                | race   | `{startedAt, durationMs, frameHz, playbackSpeed, cars}` (luzes apagam em `startedAt`)                                                                                                      |
| `race.tick`                                   | race   | `{fromFrame, frames}` — frame `{t, c}` com 8 números por carro: x, y, direção, progresso, pneu, status, desgaste do pneu (%) e do motor (%); replays da simulação v1 têm só os 6 primeiros |
| `race.incident`                               | race   | rodadas, paradas, safety car, óleo, clima, volta mais rápida                                                                                                                               |
| `race.finished`                               | race   | resultado final (`ResultRowDto[]`)                                                                                                                                                         |
| `lobby.race`                                  | lobby  | resumo atualizado de uma corrida                                                                                                                                                           |
| `notification`                                | user   | `NotificationDto`                                                                                                                                                                          |

Limites: mensagens de até 8 KB, 40 mensagens por 10 s por conexão (acima disso fecha com `1008`), 20 salas por conexão, heartbeat a cada 25 s.
