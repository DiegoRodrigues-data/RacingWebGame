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

### Interface do box (traçado, setup e treino)

- **Traçado por pontos de controle.** O desenho à mão livre era difícil no celular e gerava linhas tortas. Agora a linha
  começa no centro da pista e o jogador arrasta pontos colocados a cada ~60 m (16 a 64 pontos, `traceHandleIndices`);
  uma spline Catmull-Rom fechada passa por todos (`handlesToOffsets`) e `enforceLateralRate` garante que a linha valide.
  Arrastar fora de um ponto move a câmera. Um traçado antigo (feito à mão) é lido normalmente; ao mexer no primeiro
  ponto, ele vira a spline que passa pelos pontos amostrados.
- **Escolha do carro.** Cor e modelo são só visuais (todos os carros têm o mesmo desempenho) e únicos entre os
  confirmados da corrida. A troca vale até o parque fechado; quem está na fila recebe um carro livre ao ser promovido.
- **Ficha técnica do setup.** As barras saem do próprio modelo: velocidade final e velocidade nas curvas normalizadas
  entre os setups extremos possíveis naquela pista, pneus pelo desgaste máximo previsto na estratégia, confiabilidade
  pela chance de quebra do mapa de motor em N voltas e chuva pela volta no molhado. A "nota" é uma média ponderada
  (chuva pesa conforme a chance de chuva); serve para comparar ajustes, não prevê a posição.
- **Mini mapa ao vivo nos cards.** O card pede só a cauda do replay (`GET /races/:id/replay?tail=8`) e depois segue os
  `race.tick` da sala da corrida, guardando 24 frames. A geometria só é baixada quando o card entra na tela.

### Grade automática de corridas

O motor de fases cria uma corrida por hora cheia (UTC) e mantém as próximas 24 h preenchidas (`ensureAutoRaces`, checado
uma vez por minuto pelo líder). Cada horário recebe `flags.auto` e nunca é recriado, nem quando o admin o cancela. São
amistosas, na Copa Novatos (aberta a qualquer nível), com inscrições abertas desde a criação; corridas ranqueadas e
competições continuam com o admin. Uma corrida de 30 voltas a 2× dura cerca de 30 minutos do treino à bandeirada, então
cabem numa hora sem conflito de horário para quem quiser correr todas.
A migração `0002_zera_corridas` apagou as corridas anteriores (com inscrições, replays e resultados), os rankings,
os avisos que apontavam para elas e as pistas procedurais; usuários, categorias e pistas especiais ficaram.

Risco: com bots ligados (`DEMO_BOTS`), as 24 corridas por dia são simuladas mesmo sem jogadores, e cada replay ocupa
de 0,5 a 1 MB em gzip (cerca de 20 MB por dia no Postgres). Falta uma rotina que apague replays antigos.

### Nome, login com Google e compartilhamento

- **Nome do jogo: Roda Presa.** Só a marca mudou (título, cabeçalho, e-mails, prévia). O código continua com o nome
  interno Traçado (pacotes `@tracado/*`, cookies `tracado_*`); "traçado" segue sendo o nome da linha do jogador.
- **Google.** OAuth com código de autorização + PKCE feito no servidor; o perfil vem do endpoint userinfo do Google.
  O state fica no Store (10 min, uso único) e preso ao navegador por um cookie SameSite=Lax. Conta nova recebe
  apelido a partir do nome no Google e região/cidade "A definir" até o jogador completar (o vínculo regional da
  temporada só é congelado na primeira corrida ranqueada). E-mail já cadastrado e verificado pelo Google é vinculado.
- **Compartilhar.** O site é SPA, então as redes não veriam o título da corrida. O link `/s/corridas/:id` é servido pela
  API com tags Open Graph (imagem `og.png`) e redireciona para a corrida; o texto muda para convite, "ao vivo" ou resultado.

## Modelo de simulação

Determinístico (PRNG sfc32 semeado; nenhuma fonte de aleatoriedade externa). Por volta, cada carro tem um perfil de velocidade
calculado sobre a **sua** linha (raio de curva → velocidade-limite pela aderência; passes de aceleração e frenagem).
Aderência combina terreno, composto e desgaste do pneu, umidade da pista, calibragem, asa, preparo de terreno e aposta de clima.
A corrida avança em passos de 0,25 s com ultrapassagens probabilísticas (diferença de velocidade, separação lateral, reta),
paradas planejadas e forçadas (furo), rodadas, falhas mecânicas, safety car e óleo, todos semeados.
O resultado, os frames (4 Hz) e as entradas exatas ficam em `race_replays`; `POST /admin/races/:id/reprocess` refaz a simulação e compara o hash.

### Corridas longas e parada obrigatória

Corridas têm de 30 a 60 voltas (`RACE_LAPS_MIN`/`RACE_LAPS_MAX`) e todo setup precisa de ao menos uma parada nos boxes
(`MIN_PIT_STOPS`); `checkSetupLimits` recusa o setup sem parada e o setup padrão de quem não configurou o carro já vem com uma.
Seed: Novatos 30, Rali 35, Amadora 40, Pro 50, Elite 60 voltas; a velocidade de transmissão subiu (2, 3, 3, 4, 5×) para a
corrida ao vivo durar de 12 a 22 minutos. Medido com 22 carros: a simulação de 60 voltas leva cerca de 0,2 s de CPU;
o replay de 60 voltas numa pista de 4 km tem 13 MB de JSON e 3,8 MB em gzip, por isso o cache de replays em memória caiu de 31 para 6.
A migração `0001_corridas_longas` atualiza categorias, corridas que ainda aceitam setup e setups salvos sem parada.

Balanceamento (`pnpm balance`, 210 corridas, 7 cenários): estratégia de pneus mais vencedora com 22% das vitórias e maior
"lift" por característica de 1,72. A melhor combinação muda por cenário (seco rápido, seco travado, chuva, clima instável, terra, areia, misto).

## Riscos técnicos

- **Determinismo de ponto flutuante entre motores JS**: `Math.sin/cos/atan2` podem divergir no último bit entre V8, SpiderMonkey e JavaScriptCore. Mitigação: o servidor é a única autoridade sobre resultados; o cliente recebe a geometria pronta do servidor (não a regenera); hashes usam valores quantizados. Verificado: Chromium = Node (teste E2E). Firefox e Safari não foram testados.
- **Balanceamento** é iterativo: duas paradas quase nunca vencem em corridas curtas e asa baixa rende pouco nas pistas atuais.
- **Várias instâncias da API** exigem Redis (pub/sub do WebSocket e eleição do líder do motor). Sem Redis, rode uma instância.
- **Armazenamento de replays**: de 1 a 4 MB por corrida (gzip) com 30 a 60 voltas. Defina retenção conforme o volume.
- **Eventos por volta**: safety car, óleo, rodadas e falhas mecânicas são sorteados por volta, então crescem com a distância (em 60 voltas: cerca de 2,5 safety cars, 3,5 manchas de óleo e 5 abandonos por corrida). Se ficar excessivo, normalize as chances pela distância (mexe no `SIM_VERSION`).
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
