# Roda Presa

**Corrida estratégica multiplayer para a web, em 2D vista de cima.** Ninguém pilota: você desenha o traçado,
acerta o carro e o servidor decide a corrida.

[![CI](https://github.com/DiegoRodrigues-data/RacingWebGame/actions/workflows/ci.yml/badge.svg)](https://github.com/DiegoRodrigues-data/RacingWebGame/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-yellow.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-22%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)

![Página inicial do Roda Presa](docs/images/home.png)

Até **22 pilotos** disputam corridas agendadas pelo servidor. Cada jogador **desenha o traçado** sobre a pista
até o parque fechado e **acerta o carro**: pneus, paradas, calibragem, asa, motor, câmbio, terreno, aposta de clima
e o perfil do piloto (ataque, defesa e ritmo). Na hora marcada, o **servidor simula** classificação e corrida de
forma determinística e transmite tudo ao vivo por WebSocket. Os resultados alimentam rankings **local, regional,
nacional e mundial**.

## Como é o jogo

| Desenhe o traçado                                                                                                           | Acerte o carro                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ![Box: desenho do traçado com mapa de velocidade](docs/images/tracado.png)                                                  | ![Box: setup do carro](docs/images/setup.png)                                                                                                 |
| Arraste os pontos para abrir antes da curva e tocar o ápice; o mapa de velocidade mostra onde a linha ganha ou perde tempo. | Pneus, estratégia de boxes, calibragem, asa, câmbio, mapa do motor, piloto e aposta de clima, com um engenheiro de pista que avisa os riscos. |

| Largada                                                                      | Ao vivo                                                                                                         |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| ![Largada com o semáforo](docs/images/largada.png)                           | ![Corrida ao vivo](docs/images/ao-vivo.png)                                                                     |
| O grid sai da classificação, transmitida volta a volta sem revelar o futuro. | Câmera que segue o seu carro, mini mapa, velocímetro, desgaste de pneu e motor e a classificação em tempo real. |

| Resultado                                              | Editor de pistas (admin)                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| ![Resultado com pódio](docs/images/resultado.png)      | ![Editor de pistas](docs/images/editor.png)                                                       |
| Pódio, tempos, melhor volta, paradas, pontos e replay. | Pistas desenhadas à mão ou geradas por seed, com validação geométrica e trechos de terra e areia. |

## Destaques

- **Simulação determinística** (`packages/sim`): os mesmos insumos dão o mesmo resultado no servidor e no
  navegador. Toda aleatoriedade (safety car, óleo, rodadas, quebras, clima) vem de um PRNG com seed, então
  qualquer corrida pode ser reprocessada e auditada.
- **Pistas procedurais** (`packages/trackgen`): spline fechada com validação geométrica, gerada a partir de uma
  seed. Também há um editor de pistas e uma grade diária de pistas.
- **Motor de fases sem fila externa**: o servidor agenda inscrições, parque fechado, classificação e corrida com
  transições idempotentes no banco, retoma sozinho depois de uma queda e elege um líder quando há várias instâncias.
- **Tempo real**: WebSocket com retomada por sequência, relógio sincronizado com o servidor e frames a 4 Hz
  interpolados no cliente (PixiJS 8).
- **Para jogar com os amigos**: a Corrida Maluca cria grupos fechados com convite por link, e dá para correr só
  com um apelido, sem conta.
- **Pilotos simulados** completam o grid e cedem a vaga quando chega gente.
- **Painel de admin**: configurações do jogo sem deploy, corridas, categorias, temporadas, eventos, usuários
  (aprovação, bloqueio e exclusão), pilotos simulados e auditoria.
- **Roda sem Docker**: sem `DATABASE_URL` a API usa PGlite (Postgres em WASM) e, sem `REDIS_URL`, memória.

Arte: [Racing Pack da Kenney](https://kenney.nl) (CC0). Música e efeitos são sintetizados no navegador com
Web Audio. Ver [CREDITS.md](CREDITS.md).

## Como rodar localmente

Requisitos: **Node 22+** e **pnpm 9** (via `corepack`). Docker é opcional.

```bash
corepack enable            # ou use "corepack pnpm" no lugar de "pnpm"
pnpm install
cp .env.example apps/api/.env   # opcional: já liga dados de demonstração, bots e o relógio de dev
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

Antes do primeiro `pnpm test:e2e`: `pnpm --filter @tracado/e2e install-browsers`.

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

- **Fases** controladas pelo servidor: agendada → inscrições → parque fechado → classificação ao vivo → corrida → encerrada → arquivada (ou cancelada). O treino existe como fase, mas tem 0 min por padrão (ajustável no admin): a preparação vai da inscrição ao parque fechado.
- **Perfil do piloto**: ataque, defesa e ritmo (0–100) no perfil do jogador, ajustáveis por corrida no box; definem como ele ultrapassa, defende e arrisca, e as colisões nas disputas.
- **Inscrição**: até 22 confirmados; depois, fila de espera (tamanho configurável); com a fila cheia, `RACE_FULL`. Cancelar antes do treino promove o primeiro da fila. A disputa pela última vaga é serializada (lock de linha + mutex), então duas tentativas simultâneas resultam em uma confirmada e uma na fila.
- **Traçado**: lista de pontos `(s, d)` — `s` é a fração da volta (0–1) e `d` o deslocamento lateral (−1 a 1). O servidor recusa pontos fora da pista (`TRACE_OUT_OF_BOUNDS`), traçado incompleto, em sentido contrário ou com mudança lateral brusca (`TRACE_INVALID`), e envios depois do parque fechado (`TRACE_WINDOW_CLOSED`). O traçado pode ser salvo desde a inscrição e ajustado até o parque fechado (não há mais treino nem janela de traçado separados). Sem traçado válido o carro corre na linha central com penalidade de 1,5% de ritmo.
- **Grade automática**: o servidor mantém uma corrida a cada hora cheia nas próximas 24 h (`AUTO_RACES_PER_DAY=24`), amistosa e na Copa Novatos, com inscrições abertas para qualquer piloto. O intervalo (até uma a cada 15 min) e quantas pistas diferentes entram por dia se ajustam em **Admin → Configurações**. Corridas ranqueadas e competições são criadas pelo admin.
- **Corridas teste**: uma corrida teste de 10 voltas com bots fica sempre em ciclo, uma por vez: a próxima nasce na bandeirada da anterior e começa 2 minutos depois (ajustável em Admin → Configurações; `AUTO_TEST_RACES_GAP_MIN` só liga o ciclo), com inscrições abertas desde a bandeirada da anterior. É amistosa, aparece em "Acontecendo agora", fica fora do calendário e é apagada 3 h depois de terminar.
- **Setup**: editável até o parque fechado; limites por categoria. Sem setup, o servidor usa o padrão.
- **Simulação**: perfil de velocidade por volta a partir da curvatura da sua linha, aderência (pneu, desgaste, clima, terreno, pressão, asa, aposta de clima), motor e câmbio; ultrapassagens, pit stops, safety car, óleo, rodadas e falhas mecânicas semeados. Mesmos insumos ⇒ mesmo resultado (auditável por reprocessamento).
- **Pontos**: tabela da categoria (padrão 25-18-15-12-10-8-6-4-2-1, +1 pela volta mais rápida, × multiplicador). Desempate: vitórias → pódios → voltas mais rápidas → menos corridas → entrada mais antiga na temporada.

## Deploy (Docker Compose)

O `docker-compose.prod.yml` sobe web (Nginx), API, Postgres, Redis e backup diário. Funciona em qualquer host com
Docker atrás de um proxy com HTTPS; o projeto foi validado no [Dokploy](https://dokploy.com).

1. Crie um serviço **Compose** apontando para este repositório e o arquivo `docker-compose.prod.yml`.
2. Defina as variáveis: `POSTGRES_PASSWORD`, `JWT_SECRET` (longo e aleatório, ex.: `openssl rand -base64 48`),
   `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_WEB_URL` (ex.: `https://jogo.seudominio.com`) e, se quiser,
   `CONTACT_EMAIL` (contato exibido em Privacidade e Termos), `METRICS_TOKEN` e `SENTRY_DSN`. A API se recusa a
   subir em produção com o `JWT_SECRET` de desenvolvimento, com a senha padrão do admin ou com as rotas de dev.
   A grade automática, as corridas teste, os bots, os terrenos e o tempo das etapas se ajustam em
   **Admin → Configurações** (sem deploy); as variáveis `AUTO_RACES_*` e `DEMO_BOTS` só valem como padrão até a
   primeira vez que o admin salvar. O admin principal (Master) é `ADMIN_EMAIL`/`ADMIN_PASSWORD`, e as duas valem a
   cada boot: para trocar a senha do Master (ou recuperar o acesso), mude `ADMIN_PASSWORD` e faça um novo deploy;
   o bloqueio por tentativas é zerado e as sessões abertas caem. `ADMIN_EMAILS` (opcional, separados por vírgula)
   dá acesso de admin a outras contas, pela senha ou pelo Google. A regra de novos cadastros (liberados, com
   aprovação ou fechados, e domínios de e-mail aceitos), a aprovação, o bloqueio e a exclusão de contas ficam em
   **Admin → Usuários**.
   Login com Google (opcional): no Google Cloud Console, crie um "ID do cliente OAuth" do tipo **Aplicativo da Web**
   com o URI de redirecionamento `https://SEU_DOMINIO/api/auth/google/callback` e defina `GOOGLE_CLIENT_ID` e
   `GOOGLE_CLIENT_SECRET`. Sem as duas, o botão não aparece.
   A grade automática vem ligada: `AUTO_RACES_PER_DAY` (padrão 24; 0 desliga), `AUTO_RACES_CATEGORY` (slug, padrão
   `copa-novatos`) e `AUTO_RACES_RANKED` (padrão `false`). Os pilotos simulados da grade automática também vêm
   ligados (`SIMULATED_DRIVERS`, padrão `true`) e se ajustam em **Admin → Pilotos simulados**.
   Não ligue `SEED_DEMO` em produção: o seed cria contas de demonstração com senhas conhecidas.
3. Aponte o domínio para o serviço **web**, porta **80**, com HTTPS. No Dokploy, se aparecer `404 page not found`
   com o certificado `TRAEFIK DEFAULT CERT` e os containers saudáveis, o domínio foi criado depois do container:
   confira serviço/porta na aba **Domains** e faça um novo Deploy.
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

## Contribuindo

Issues e pull requests são bem-vindos. Leia o [CONTRIBUTING.md](CONTRIBUTING.md) antes de começar e, para relatar
uma falha de segurança, siga o [SECURITY.md](SECURITY.md) (nunca em issue pública).

## Licença

Código sob a [licença MIT](LICENSE). A arte do Racing Pack é CC0 (Kenney) e as fontes usam a SIL Open Font
License; detalhes em [CREDITS.md](CREDITS.md).
