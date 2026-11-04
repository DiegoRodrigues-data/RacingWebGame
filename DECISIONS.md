# Decisões, riscos e pendências

## Decisões de arquitetura (e desvios do roadmap inicial)

| Tema                                            | Roadmap previa        | Implementado                                                                                                                                                                                           | Motivo                                                                                                            |
| ----------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Agendador de fases                              | BullMQ sobre Redis    | Motor de fases próprio dirigido pelo banco (`apps/api/src/modules/engine/engine.ts`): tick a cada 500 ms, transições por `UPDATE … WHERE status = fase_atual`, líder eleito por chave com TTL no Store | Mais simples, idempotente por construção, recupera sozinho corridas atrasadas após queda e não exige Redis em dev |
| Lock das 22 vagas                               | Script Lua no Redis   | `SELECT … FOR UPDATE` na linha da corrida + mutex por corrida no processo                                                                                                                              | Uma fonte de verdade transacional; o teste com 50 inscrições paralelas confirma exatamente 22                     |
| Cache de rankings                               | Sorted sets no Redis  | Páginas em cache no Store (30 s, invalidadas por versão a cada resultado) sobre índice SQL                                                                                                             | Mesmo ganho de leitura com menos estado duplicado; `rebuild` recalcula tudo a partir de `race_results`            |
| Banco em dev                                    | Postgres em Docker    | PGlite (Postgres em WASM) quando não há `DATABASE_URL`                                                                                                                                                 | A máquina de desenvolvimento não tem Docker; PGlite é o motor real do Postgres                                    |
| Renderização da pista                           | Tiles do racing_pack  | Pista vetorial com as cores dos tiles + sprites do pack (carros, tribunas, pneus, árvores, tendas)                                                                                                     | O encaixe de tiles 128 px em curvas procedurais ficava serrilhado (risco previsto no roadmap)                     |
| `packages/ui`                                   | Pacote separado       | Componentes em `apps/web/src/components`                                                                                                                                                               | Só há um consumidor                                                                                               |
| Escolhas "tipo de terreno" e "clima" do jogador | Parâmetros da corrida | `terrainPrep` (preparo da suspensão) e `weatherBet` (aposta de clima) no setup                                                                                                                         | O requisito pede que o jogador configure terreno e clima; terreno e clima reais continuam definidos pelo servidor |
| Desempate "melhor volta acumulada"              | —                     | Número de voltas mais rápidas                                                                                                                                                                          | Métrica estável e fácil de explicar                                                                               |
| Treino                                          | Simulação no servidor | Simulação local no navegador (mesmo pacote `sim`) + tempos de referência do servidor                                                                                                                   | Treino não vale resultado; poupa servidor                                                                         |
| Teste de carga                                  | k6                    | `apps/api/scripts/loadtest.ts` (Node + ws)                                                                                                                                                             | Sem k6 instalado; mede o mesmo                                                                                    |
| E-mail                                          | Provedor real         | `LogMailer` (só registra no log)                                                                                                                                                                       | Provedor é decisão pendente                                                                                       |
| Sentry/OpenTelemetry                            | Instalados            | Inicialização opcional por variável de ambiente; pacotes não vêm instalados                                                                                                                            | Evita peso sem uso; `pnpm add @sentry/node` ou `@opentelemetry/sdk-node` ativa                                    |

## Modelo de simulação

Determinístico (PRNG sfc32 semeado; nenhuma fonte de aleatoriedade externa). Por volta, cada carro tem um perfil de velocidade
calculado sobre a **sua** linha (raio de curva → velocidade-limite pela aderência; passes de aceleração e frenagem).
Aderência combina terreno, composto e desgaste do pneu, umidade da pista, calibragem, asa, preparo de terreno e aposta de clima.
A corrida avança em passos de 0,25 s com ultrapassagens probabilísticas (diferença de velocidade, separação lateral, reta),
paradas planejadas e forçadas (furo), rodadas, falhas mecânicas, safety car e óleo, todos semeados.
O resultado, os frames (4 Hz) e as entradas exatas ficam em `race_replays`; `POST /admin/races/:id/reprocess` refaz a simulação e compara o hash.

Balanceamento (`pnpm balance`, 210 corridas, 7 cenários): estratégia de pneus mais vencedora com 22% das vitórias e maior
"lift" por característica de 1,72. A melhor combinação muda por cenário (seco rápido, seco travado, chuva, clima instável, terra, areia, misto).

## Riscos técnicos

- **Determinismo de ponto flutuante entre motores JS**: `Math.sin/cos/atan2` podem divergir no último bit entre V8, SpiderMonkey e JavaScriptCore. Mitigação: o servidor é a única autoridade sobre resultados; o cliente recebe a geometria pronta do servidor (não a regenera); hashes usam valores quantizados. Verificado: Chromium = Node (teste E2E). Firefox e Safari não foram testados.
- **Balanceamento** é iterativo: duas paradas quase nunca vencem em corridas curtas e asa baixa rende pouco nas pistas atuais.
- **Várias instâncias da API** exigem Redis (pub/sub do WebSocket e eleição do líder do motor). Sem Redis, rode uma instância.
- **Armazenamento de replays**: cerca de 0,3 a 1 MB por corrida (gzip). Defina retenção conforme o volume.
- **PGlite em produção** não é recomendado: use Postgres (o compose de produção já usa).

## O que não foi verificado nesta máquina

- Build das imagens Docker e subida do `docker-compose.prod.yml` (Docker indisponível). O bundle da API e a instalação mínima de runtime usados na imagem foram testados fora do Docker.
- Driver `node-postgres` contra um Postgres real e o `RedisStore` contra um Redis real (todos os testes usam PGlite e o Store em memória).
- Deploy na VPS com Dokploy (sem acesso ao servidor; depende do push para o repositório).
- Workflow do GitHub Actions (não executado; os mesmos comandos rodam localmente).

## Decisões pendentes

- Provedor de e-mail (verificação, recuperação de senha e lembretes).
- Política de apelidos (palavrões, nomes reservados).
- Idiomas além do pt-BR.
- Mínimo de corridas para aparecer no ranking (`RANKING_MIN_RACES`, hoje 1) e limiares de promoção/rebaixamento.
- Velocidade de transmissão por categoria (hoje 2× a 4×) versus duração real desejada das corridas.
- Uso de pilotos-bot em produção (hoje desligado por padrão: `DEMO_BOTS=0`).
