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

### Corridas teste com bots

As corridas teste rodam em ciclo (`ensureAutoTestRaces`): uma de cada vez, 10 voltas (abaixo do mínimo de 30 das
corridas normais, de propósito), amistosas, com bots completando o grid. Quando uma começa a correr, o fim dela já é
conhecido e a próxima é criada para largar 10 minutos depois da bandeirada (`AUTO_TEST_RACES_GAP_MIN`), com inscrições
abertas desde então; antes da largada há 2 min de treino, a janela fixa de 2 min de traçado, 10 s de parque fechado e 60 s de classificação ao vivo.
Ficam marcadas com `flags.autoTest`, aparecem só em "Acontecendo agora" (a em andamento e a próxima aberta) e ficam
fora do calendário, das próximas largadas e dos resultados recentes (`GET /races?test=true|all` para vê-las). São
apagadas com replay, resultados e pista 3 h depois de encerradas (`AUTO_TEST_RACES_KEEP_HOURS`).

### Fases mais curtas e classificação ao vivo

- **Durações:** treino padrão de 2 min (`DEFAULT_PRACTICE_MINUTES`) e janela de traçado fixa de 2 min (`TRACE_WINDOW_MS`;
  era 5). Quem assiste esperava minutos sem ver nada. A migração `0005_treino_e_tracado_2min` reajusta as corridas
  automáticas que ainda não começaram, mantendo o horário do treino.
- **Classificação ao vivo:** o resultado continua calculado na transição (`simulateQualifying`), mas é transmitido como
  uma sessão (`qualifyingSession`): cada carro sai do box a cada 4 s simulados, em ordem sorteada pela seed (não revela o
  resultado), e faz uma volta lançada na própria linha, escalada para fechar exatamente no tempo oficial. A velocidade
  da transmissão é escolhida para a sessão caber na fase. `GET /races/:id/qualifying/live?from=N` entrega só os frames,
  parciais e voltas que já aconteceram; durante a fase, `GET /races/:id/qualifying` traz só as voltas fechadas e o
  `gridSlot` dos inscritos fica oculto. O evento `race.qualifying` e o aviso `qualifying_ready` saem na largada.
- **Espectador antes da classificação:** a lista de pilotos mostra quem já enviou traçado e salvou setup (`hasTrace`,
  `hasSetup`, nunca o conteúdo), atualizada pelo WebSocket no primeiro envio de cada um, e o mapa mostra a fase atual
  com contagem regressiva.

### Inscrição tardia

Quem chega com a corrida já no treino ou na janela de traçado pode entrar se houver vaga no grid, até o parque fechado
(`LATE_ENTRY_PHASES`); nessa hora não há fila de espera (grid cheio responde `RACE_FULL`). Antes, a página da corrida em
"Acontecendo agora" mostrava só a pista para quem não estava inscrito. Sem inscrição, o box vira treino livre: setup,
traçado e corrida contra fantasmas rodam no aparelho e nada é enviado ao servidor.

### Corrida Maluca (grupos fechados de amigos)

- **Grupo:** um usuário com conta cria uma corrida avulsa ou um campeonato de até 10 corridas (`crazy_groups`). Todas
  as corridas são criadas na hora, uma a cada `intervalMinutes` (mínimo 15), com as fases normais (treino e traçado de
  2 min), na categoria de `AUTO_RACES_CATEGORY`, não ranqueadas e com `crazy_group_id` e `crazy_round`. Ficam fora das
  listas públicas (`listRaces` só as traz com `crazy: true`) e do lobby; quem não é membro não se inscreve.
- **Convite e convidado:** o link `/corrida-maluca/convite/:code` aceita quem tem conta ou quem digita só apelido e cor.
  O convidado é um usuário com `is_guest`, e-mail fictício `@convidado.invalid` (só para a coluna única) e senha
  aleatória inutilizável; a sessão é o cookie de refresh normal (30 dias). Para outro aparelho, gera um link pessoal de
  volta (token `guest_login`, só o hash no banco, 1 ano, um por vez) ou vira conta normal com e-mail e senha. Convidado
  não cria grupo. Apelido continua único no jogo todo (sugestão automática se repetir).
- **Jogar sem cadastro:** o mesmo convidado nasce também fora da Corrida Maluca, pela página `/jogar` (`POST /auth/guest`
  sem `inviteCode`), e corre nas corridas abertas como qualquer jogador, inclusive as ranqueadas. A exceção é
  `REQUIRE_VERIFIED_EMAIL_FOR_RANKED`: ligado, o convidado (sem e-mail) fica fora das ranqueadas até criar a conta. O
  limite de 40 convidados por IP em 24 h vale para os dois caminhos. O link de volta passou para `/voltar/:key` (o
  antigo `/corrida-maluca/voltar/:key` continua funcionando).
- **Membro entra em tudo:** ao entrar no grupo, o membro é inscrito direto em todas as corridas que ainda não chegaram ao
  parque fechado; quem chega no meio do campeonato entra só nas próximas.
- **Bots:** nunca por padrão (o `DEMO_BOTS` não vale para grupos). Só se quem criou ligar `botFill`: na abertura da
  janela de traçado o grid é completado com bots até esse número. Bots não pontuam nem levam troféu.
- **Modo caos** (`flags.chaos`, ligado por padrão): óleo, safety car e quebras ligados na simulação, qualquer que seja a
  categoria (vai para o `simInput`, então o reprocessamento confere).
- **Pontos e troféus:** a tabela usa a posição entre os humanos (10, 8, 6, 5, 4, 3, 2 e 1 para todos), sem ranking, XP
  só de amistosa. Os troféus (Foguete, Lanterninha, Volta do Busão, Motor de Fusca, Borrachudo, Estrategista, Piloto de
  Sofá, Rei do Box) são calculados sob demanda do resultado, da classificação e dos frames do replay (desgaste de pneu e
  motor), com frase sorteada pela seed, e ficam em cache em memória. Com o campeonato encerrado, quem mais levou cada
  troféu recebe o título de honra.

- **Pular o preparo:** nas corridas do grupo, treino e janela de traçado são só tempo de preparo (traçado e setup já
  ficam salvos desde a inscrição). Cada piloto marca "Estou pronto" (`entries.ready_at`); com todos os humanos
  confirmados prontos, a corrida antecipa os horários: parque fechado já, classificação 10 s depois e a largada depois
  da sessão de classificação ao vivo, que nunca é pulada. O organizador pode mandar largar com pelo menos metade da turma
  pronta. A antecipação é um UPDATE condicional na fase; as próximas etapas mantêm o horário. Sem os avisos de janela
  (`flags.prepSkipped`, `flags.traceWarned`).
- **Miniatura da pista:** o card do grupo e cada etapa do calendário mostram o mini mapa da pista (com os carros quando a
  etapa está no ar), no mesmo padrão dos cards de corrida.

### Configurações do jogo no admin

- **Onde ficam:** uma linha `game_settings` (JSON validado por `gameSettingsSchema`), com efeito na hora e registro
  na auditoria. Sem ela, valem os padrões montados das variáveis antigas (`AUTO_RACES_*`, `DEMO_BOTS`), então nada
  muda no deploy até o admin salvar. Cada instância relê a cada 5 s.
- **O que controlam:** tempo das etapas (treino, janela de traçado, parque fechado, classificação) da grade, das
  corridas teste e da Corrida Maluca, e padrão do formulário de corrida do admin; grade automática (ligada, por dia,
  antecedência, ranqueada, voltas, rodízio de categorias, bots); corridas teste; bots das corridas do admin; pistas
  (pesos por terreno, comprimento, complexidade, largura, prefixo de seed, rodízio de pistas salvas e chance de usar
  uma); limites e padrões da Corrida Maluca. Valem para corridas criadas daqui em diante.
- **Por que só aparecia asfalto:** toda corrida automática usava uma categoria só (Copa Novatos), que só tinha
  asfalto. Agora o terreno das corridas automáticas sai dos pesos das configurações, não da categoria; a categoria
  segue dando clima, limites de setup, pontuação e velocidade da transmissão.
- **Janela de traçado configurável:** `buildTimeline` aceita `traceWindowMs`; a corrida guarda os horários, então as
  telas leem a duração da própria corrida (não mais da constante).
- **Sem janela de traçado:** o treino (2 min por padrão, ajustável no admin) vai direto ao parque fechado. O traçado
  e o setup são salvos e editados da inscrição até lá, então a janela só fazia todo mundo esperar. O motor ainda
  aceita janela (corridas antigas a têm guardada nos horários; passa pela fase sem aviso quando a duração é zero, e
  bots e grid da Corrida Maluca continuam sendo preparados nessa passagem). A migração 0009 tira a janela das corridas
  ainda não começadas, antecipando classificação e largada.
- **Gerador de pistas:** roda no navegador (o gerador é determinístico e igual ao do servidor) e salva a pista de uma
  seed como pista oficial (`kind: special`, não é apagada com as corridas teste), opcionalmente já no rodízio.
- **Fora por enquanto:** coeficientes da física (`COEF`). Mudá-los muda resultados e precisa valer igual no servidor e
  no treino do navegador; exigiria versionar a simulação por corrida.

### Corridas teste: uma por vez e eventos visíveis

- **Corrida teste sem fila:** só existe uma corrida teste ativa por vez. A próxima nasce na bandeirada da atual e o
  treino dela começa `testRaces.gapMin` minutos depois (padrão 2), já com inscrições abertas. Antes, a próxima era
  criada quando a atual largava e as duas apareciam juntas.
- **Terrenos em rodízio nas corridas teste:** cada corrida teste usa o próximo terreno da lista
  `testRaces.terrains` (padrão asfalto, terra, areia, misto), a partir do terreno da anterior; ignora os pesos de
  terreno e o rodízio de pistas salvas. As configurações e o status ficam na página **Admin → Corridas teste**.
- **Eventos:** os eventos publicados aparecem no início (em andamento ou por vir) e têm página própria
  (`/eventos/:id`) com as corridas ligadas a eles; o formulário de corrida do admin escolhe o evento (e a categoria
  dele). Antes não havia nenhuma tela de eventos para o jogador nem como ligar corridas a um evento pelo admin.

### Cenários em volta da pista

- **Três cenários com a arte do Racing Pack** (sem arte nova): Autódromo (grama, árvores), Deserto (areia, pedras) e
  Cânion (terra, pedras e barris). O fundo usa as cores das peças `land_*` do pacote, com pintas fixas pela pista; as
  árvores do gerador viram pedras e barris na hora de desenhar, então a geometria e o hash da pista não mudam.
- **O cenário é da corrida** (`races.biome`, padrão Autódromo), não da pista: a mesma pista pode aparecer em cenários
  diferentes. As corridas automáticas sorteiam pelos pesos das configurações; o admin escolhe nas corridas que cria.
- **Legibilidade:** pista de areia nunca vai para o Deserto e pista de terra nunca vai para o Cânion
  (`biomeFits`); além disso toda pista ganhou um contorno escuro fino nas bordas.

### Trilha sonora e efeitos

- **Tudo sintetizado no navegador** (Web Audio, `game/audio.ts`), sem arquivos de áudio: canais de pulso (melodia
  com eco e vibrato, arpejo), baixo serrilhado filtrado e bateria de ruído, no estilo dos chips de 16 bits. As
  músicas ("Reta Final" na corrida, "Volta Lançada" na classificação) são composições originais escritas em notas
  MIDI no próprio código; nada copiado de jogos existentes.
- **Efeitos:** motor do carro em foco (tom, volume e brilho pela velocidade medida entre quadros, com "trocas de
  marcha"), bipes do semáforo, parafusadeira do box e vinheta da bandeirada.
- **Volume:** botão no topo com som ligado/desligado e volumes de música e efeitos, guardados neste aparelho
  (`localStorage`). O som só começa depois do primeiro toque ou clique (regra dos navegadores) e pausa com a aba
  escondida.

### Pilotos simulados (grade automática)

- **Personas fixas** (`bot_personas`, módulo `modules/bots`): cada piloto simulado é um usuário `is_bot` com
  habilidade, agressividade, risco de parada, horário em que joga e vontade de correr. Assim o resultado é
  coerente de uma corrida para outra e o ranking faz sentido: numa amostra de 11 corridas, os de habilidade 0,9
  chegaram em média na posição relativa 0,30 e os de 0,1 na 0,75. A habilidade muda o traçado (quanto segue a
  linha ideal e quanto ondula) e o setup (pneu, motor, asa, pressões); a simulação não muda (`SIM_VERSION` igual).
- **Camuflados, por escolha do dono do jogo**: para o jogador são pilotos comuns. A lista do grid não traz a marca
  `bot` para eles (só para os bots de demonstração das corridas teste e da Corrida Maluca), têm apelido, cidade,
  nível e histórico de carreira, e somam na contagem de online quando estão no horário deles
  (`botPool.countOnline`). O ranking é misto; `botPool.inRanking` desligado mostra só gente. Com prêmios de valor
  no ranking, desligue `inRanking` ou exclua-os na apuração.
- **Inscrição aos poucos**: na abertura das inscrições de uma corrida automática, o motor planeja quem entra e
  quando (`bot_plans`, entre 3 h antes do treino e a metade do treino, mais denso perto da largada); o tick
  inscreve quem chegou a hora, com o mesmo mutex e `FOR UPDATE` da inscrição de gente. Traçado e setup são gravados
  já na inscrição, para o piloto aparecer "pronto" como alguém que já preparou.
- **Nunca tiram vaga de gente**: deixam `reserveSeats` vagas livres e, com o grid cheio, o último piloto simulado
  que entrou cede a vaga na hora (`yieldBotSeat` em `races/entries.ts`).
- **Rodízio diário**: entre `activeMin` e `activeMax` personas ficam ativas por dia (sorteio estável pela data de
  Brasília). São criadas `activeMax + 10`, para variar quem aparece. Os bots de demonstração (`DEMO_BOTS`, seed)
  não entram nesse rodízio, e as personas não entram nas corridas teste nem na Corrida Maluca.
- **Sem bots de demonstração na grade automática**: com o recurso ligado, os bots de `DEMO_BOTS` (marcados) não
  entram nas corridas automáticas, e os que já estavam em corridas abertas saem na checagem por minuto do motor.
- **Ligados por padrão** (`SIMULATED_DRIVERS=true`), como a grade automática. Os testes da API e o E2E
  desligam, para não mudar as contagens dos outros testes.
- **Desligar**: um piloto desligado pelo admin sai das corridas ainda abertas (como uma desistência) e perde os
  planos pendentes. Desligar o recurso inteiro só para as inscrições novas; quem já entrou corre.

### Gestão de usuários (adotada do Gerador_Prompt)

- **Master pelo ambiente.** `ADMIN_EMAIL`/`ADMIN_PASSWORD` valem a cada boot (antes a senha só era gravada na criação e
  `ADMIN_RESET_PASSWORD` recuperava o acesso). O Master é achado pela marca `users.is_master`, então trocar o e-mail na
  variável muda o e-mail da mesma conta. Ele não é editado, bloqueado nem excluído pelo painel.
- **`ADMIN_EMAILS` sem papel gravado.** O papel de admin é somado na emissão do token (`effectiveRoles`); tirar o e-mail
  da variável tira o acesso na próxima renovação (até 15 min). Como toda conta admin, essas não correm (`assertPlayer`).
- **Regra de cadastros nas três portas.** No Gerador_Prompt ela vale só para o Google, porque lá não há cadastro
  próprio. Aqui vale para e-mail, Google e convidado, com padrão "liberado" para o jogo público não mudar até o admin
  decidir. Sob aprovação o convidado é recusado: sem e-mail nem senha, ele não teria como voltar depois de aprovado.
- **Bloqueio imediato sem consultar o banco a cada requisição.** O access token é um JWT de 15 min. Em vez do
  `session_version` do Gerador_Prompt, o bloqueio revoga os refresh tokens e grava uma marca no `Store` com o tempo de
  vida de um access token; o hook de auth lê a marca.
- **Excluir = apagar ou anonimizar.** O Gerador_Prompt passa os prompts do excluído para o Master. Aqui inscrições,
  resultados e rankings não têm cascata e mudariam corridas passadas, então quem já correu é anonimizado.

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

### Desgaste com variação e motor (simulação v2)

- **Pneus:** cada jogo de pneus de cada carro sorteia um fator de desgaste uniforme em ±8% (seco, temperatura amena) até
  ±20% (chuva provável ou temperatura extrema), mais ±3% por volta (`wearSpread` em `model.ts`). Continua determinístico
  pela seed. O setup mostra quantas voltas cada composto rende em média com aquele carro e clima, e a faixa
  (`tyreLife`), e a barra de stints marca listrado onde o pneu pode passar do limite com azar.
- **Motor:** acumula desgaste por volta (econômico 45%, equilibrado 70%, potência 100% numa corrida inteira; marcha curta
  até +10%). A chance de quebra por volta do mapa passa a ser multiplicada por `0,4 + 1,2 × desgaste`: no total fica
  perto da anterior, mas concentrada no fim da corrida.
- **Frames:** levam o desgaste do pneu e do motor (8 números por carro). O cliente lê 6 ou 8 conforme o tamanho do frame,
  então replays antigos continuam abrindo, só sem o painel de desgaste. O replay cresce cerca de um terço (dois inteiros
  pequenos a mais por carro em cada frame). `SIM_VERSION` = 2; reprocessar uma corrida da v1
  avisa que a versão é outra em vez de acusar divergência.
- Balanceamento depois da mudança: maior lift 1,69 (aero alta), estratégia mais vencedora com 20,5% das vitórias.

Balanceamento (`pnpm balance`, 210 corridas, 7 cenários): estratégia de pneus mais vencedora com 22% das vitórias e maior
"lift" por característica de 1,72. A melhor combinação muda por cenário (seco rápido, seco travado, chuva, clima instável, terra, areia, misto).

### Perfil do piloto, colisões e pista mais larga (simulação v3)

Pedido de 07/11/2026: perfil do piloto por usuário, colisões, pista mais larga e controle no admin.

- **Perfil do piloto** (`packages/shared/src/driver.ts`): Ataque, Defesa e Ritmo, de 0 a 100. Fica em `profiles.driver`;
  sem escolha salva, vale um perfil sorteado de forma estável pelo id (`driverProfileFor`), então o piloto é o mesmo em
  todas as corridas desde o primeiro dia. No box, o perfil pode ser ajustado só para a corrida (`setup.driver`). A
  simulação usa `setup.driver ?? profiles.driver ?? sorteado`.
- **Sem orçamento de pontos**: cada característica tem custo próprio, no mesmo espírito do setup.
  - Ataque: tenta ultrapassar mais vezes, passa mais e gasta pneu nas tentativas, mas bate muito mais; quem ataca
    pouco espera a reta.
  - Defesa: segura a posição, mas perde velocidade a cada ataque segurado e leva mais toques.
  - Ritmo: até 0,35% de velocidade e erro mais frequente na volta de classificação; com ritmo alto, +25% de desgaste
    de pneu, +30% de desgaste de motor e mais rodadas.
- **Colisões**: o toque só acontece numa tentativa de ultrapassagem. A chance cresce com o ataque de quem tenta e a
  defesa de quem é atacado, é maior na curva e na chuva. Os dois perdem tempo, e com a chance de avaria (padrão 30%) um
  deles (quem ataca, em 65% das vezes) abandona (35%) ou vai aos boxes no fim da volta com +6 s e ritmo pior até lá.
  Incidentes novos: `collision` (com o outro carro em `detail`) e `damage` (`pit` ou `dnf`); abandono com `dnfReason`
  `collision`.
- **Lado a lado**: nos frames, quem chega por trás sai da linha do carro da frente para o lado com mais espaço. É só
  desenho: ordem e tempos já foram decididos.
- **Pista de 14 m** (`DEFAULT_TRACK_WIDTH`, antes 12 m) para caber dois carros; a migração 0012 sobe a largura salva nas
  configurações. Pistas já geradas não mudam.
- **Admin**: as regras ficam em `GameSettings.drivers` (liga as colisões, frequência, chance de avaria e o peso de
  cada característica) e são gravadas na entrada de cada corrida (`simInput.rules`), então o reprocessamento usa as
  mesmas. O botão "Simular com estas regras" roda 14 corridas no servidor (`runBalance`) antes de salvar.
- `SIM_VERSION` = 3. Balanceamento: com setups e perfis sorteados, nenhuma faixa de perfil fica mais de 1,5 posição à
  frente da outra (ritmo baixo × alto: 10,9 × 12,4, porque stints longos punem o ritmo alto); com setups iguais, ritmo
  alto fica um pouco à frente. Ataque alto passa quase o dobro de carros e causa oito vezes mais toques que ataque baixo.
  Cerca de 4,5 toques, 0,7 ida aos boxes por avaria e 0,6 abandono por toque em corridas de 22 carros. O `pnpm balance`
  passou a checar perfil e colisões.

### Grid alvo dos pilotos simulados

As corridas da grade largavam com 3 a 5 carros em produção: o planejamento só escolhia quem estava "online" nas 3 h
antes da corrida e queria correr, até `perRaceMax`. Agora cada corrida sorteia um grid alvo entre `gridMin` e `gridMax`
(padrão de 10 a 16; gente + simulados). Se faltar gente online, entram outros ativos do dia e depois os demais. Nos 10 min
antes do parque fechado, a checagem por minuto completa o grid até o mínimo (gente que cancelou, inscrição que falhou).
O admin edita cada persona (habilidade, estilo, horário, vontade de correr e perfil do piloto) e cria mais personas.

### Sem etapa de treino

Pedido de 07/11/2026. O treino passa a ter 0 min por padrão (configurações e corridas do admin), como já tinha sido feito
com a janela de traçado. A preparação (traçado, setup e perfil do piloto) vai da inscrição ao parque fechado, e o motor
passa por `practice` e `trace_window` no mesmo tick. A fase continua existindo, então corridas antigas e quem quiser treino
pelo admin seguem funcionando. A migração 0012 zera o treino salvo nas configurações; corridas já criadas mantêm os
horários. Outros ajustes:

- O aviso de 1 minuto para o parque fechado também sai com as inscrições abertas.
- Na Corrida Maluca, "Estou pronto" e "Largar agora" valem com as inscrições abertas, só para a próxima etapa do grupo.
- A aba "Treino" do box virou "Teste": o teste de volta e de corrida contra fantasmas, que roda no aparelho, continua lá.

### Física das disputas e carros sem sobreposição (simulação v4)

Pedido de 07/11/2026 ("ainda vejo um carro passando por cima de outro"). Medido com corridas de 22 carros, quadro a quadro:

- **Distância para o carro da frente**: a regra de seguir somava de novo o deslocamento do carro da frente, que já tinha
  andado naquele passo. Quem vinha atrás terminava de 0 a 4 m do outro (centro a centro, carros de 5 m) e, em alta
  velocidade, até passava à frente sem ultrapassagem registrada. Corrigido: o carro preso fica a 6 m (96% dos bloqueios
  terminavam sobrepostos; agora 4%, nos encontros em curva).
- **Ultrapassagem como manobra**: antes, a tentativa bem-sucedida liberava o carro por um passo (0,25 s) e ele atravessava
  o outro. Agora a manobra dura até `passMaxTime` (6 s), lado a lado, com `passSpeed` (2 m/s) de vácuo. Só tenta quem
  tem ritmo de volta melhor (`attackLapEdge`), velocidade a mais naquele ponto (`attackSpeedEdge`) ou, sem vantagem, o
  agressivo na reta. A chance de completar vem da vantagem (`passLapAdv`, `passSpeedAdv`), da reta e do perfil.
- **Desenho** (não muda o resultado): cada carro tem um afastamento lateral persistente. Dois carros que vão ficar a
  menos de um carro de distância (olhando 0,8 s à frente) se afastam até 3,4 m entre centros, cada um para o lado em que
  já está, e o afastamento muda no máximo 8 m/s, então ninguém troca de lado de um quadro para o outro. Retardatários e
  líderes intercalados (safety car) ficam em filas, uma de cada lado.
- **Boxes**: cada carro tem a sua vaga na via dos boxes (antes todos eram desenhados no mesmo ponto).
- **Abandono**: o carro encosta fora da pista, do lado em que estava.
- **Bandeirada**: na volta de desaceleração, o carro segue quem está à frente em vez de atravessá-lo.
- **Resultado**: sobreposições entre carros correndo caíram de ~8.500 para ~70 pares em 6 corridas (o que sobra é
  encosto leve na interpolação em linha reta entre quadros nas curvas). Rebalanceado com `pnpm balance`:
  ~4,7 toques por corrida, diferença de 1,1 posição entre faixas do perfil. As ultrapassagens contadas subiram (antes
  boa parte das trocas de posição acontecia "por dentro" do outro carro, sem registro).

### Desgaste dos pneus por distância (simulação v5)

Pedido de 08/11/2026: numa pista de 6 km, uma troca bastava, como numa de 1,5 km. O desgaste era uma fração fixa da
corrida (o macio gastava 120% da vida numa corrida inteira, fosse ela de 30 ou de 120 km), e o máximo de paradas vinha
só da categoria (a Copa Novatos permite 1).

- **Desgaste por km**: `COEF.tyreWear` é o desgaste a cada `wearRefKm` (30 km, a corrida típica da grade: 20 voltas de
  1,5 km). Até perder rendimento (75%): macio ~19 km, médio ~23 km, duro ~37 km, chuva ~32 km, ajustados pelo carro,
  pelo clima e pelo ritmo do piloto. As voltas que cada um rende saem do tamanho da pista: na de 6 km, o macio dura 3
  voltas e o duro 6; na de 1,5 km, 12 e 24. O box mostra voltas e km.
- **Paradas pela distância**: o máximo de paradas é o da categoria ou, em corridas longas, uma a cada 20 km
  (`maxPitStopsFor`, teto 8). Numa corrida de 120 km, até 6.
- **Estratégias automáticas**: o setup padrão (quem não configurou) e os pilotos simulados planejam as paradas pela vida
  do composto (`stopsNeeded`), em vez de sempre 1 ou 2.
- **Motor**: continua com desgaste por corrida (não por km), para uma corrida longa não virar quebra certa.
- Conferido: na pista de 6 km com 20 voltas, quem faz 1 parada perde ~1,5 min para quem faz 2 ou 3. Os cenários do
  `pnpm balance` passaram a ter ~30 km (antes alguns tinham 15 km, curtos demais para o desgaste por distância) e as
  estratégias sorteadas cumprem a parada obrigatória; o balanceamento segue OK.

### Pistas do dia

Pedido de 07/11/2026: saber que pista entra em cada horário do dia e ajustar. A página `/admin/pistas-do-dia` mostra o
dia no horário de Brasília (ontem até 6 dias à frente):

- **Cada horário da grade**, já criado ou não, e as corridas avulsas do admin, com miniatura, terreno, comprimento,
  cenário e a origem da pista: gerada, sorteada do rodízio de especiais ou escolhida pelo admin.
- **Corrida já criada**: troca por uma especial publicada ou por outra gerada, até 1 minuto antes do parque fechado. O
  cenário é sorteado de novo (compatível com o terreno), os traçados salvos são apagados (eram da outra pista), a
  procedural antiga sai do banco e os jogadores inscritos recebem `track_changed`, que também recarrega o box. O
  rascunho local do traçado agora é por pista (`raceId:versionId`).
- **Horário ainda sem corrida** (além da janela de criação): reserva de uma especial em `track_plans`. Ao criar a
  corrida daquele horário, a grade usa a reserva, marca `flags.trackPicked` e apaga a reserva. Sem reserva, vale a
  geração automática (com a chance do rodízio).
- **Especiais**: as publicadas, com quantas vezes entram no dia e um botão para pôr ou tirar do rodízio (a chance do
  rodízio continua nas configurações).

**Pista descontinuada sai de circulação** (`retireUnpublishedTracks`): na hora em que o admin descontinua e, por
garantia, na checagem por minuto do motor. Sai do rodízio, as reservas são apagadas e as corridas ainda abertas que a
usavam passam para uma pista gerada (com o aviso aos inscritos). Corridas em andamento ou encerradas mantêm a pista
(histórico e replay). Na lista de pistas do admin, as descontinuadas ficam numa aba própria.

Corridas da Corrida Maluca e corridas teste ficam de fora. A categoria de cada horário segue o rodízio da grade
(`slotCategory`, o mesmo cálculo da criação).

### Corridas de 30 em 30 minutos e pistas que se repetem no dia

Pedido de 08/11/2026: uma corrida a cada 30 min e reaproveitar as pistas geradas no dia.

- **Duração medida** (simulação de 16 carros, tempo real com a transmissão acelerada da categoria): Copa Novatos de
  10 a 13 min, as de 40 a 50 voltas de 12 a 20 min, a de 60 voltas em 5 km cerca de 25 min. Com a classificação, tudo
  cabe em 30 min; basta `autoRaces.perDay = 48` (configuração do admin, sem deploy).
- **Conflito de horário pela bandeirada prevista**: antes, a corrida ocupava o horário até 30 min depois da largada
  (a bandeirada real só existe depois da simulação), e quem estava numa corrida não conseguia entrar na seguinte.
  Agora a previsão usa voltas × comprimento a 32 m/s no tempo da simulação (as corridas medidas ficam entre 32 e
  45 m/s, então erra para mais), dividido pelo ritmo de transmissão da categoria, e a folga depois da bandeirada
  caiu para 2 min (`overlappingRaces` em `races/entries.ts`). Uma corrida longa ainda bloqueia a seguinte.
- **Pilotos simulados**: o plano e o complemento do grid deixam de fora quem já está inscrito, ou tem inscrição
  planejada, numa corrida que se sobrepõe (`busyInSlot`). Antes, o plano escolhia o piloto e a inscrição falhava
  em silêncio na hora.
- **Pistas do dia** (`autoRaces.tracksPerDay`, padrão 12; 0 = pista nova em todo horário): o horário na posição `k`
  do dia de Brasília repete a pista e o cenário do primeiro horário do mesmo dia e da mesma categoria com a mesma
  posição `k % tracksPerDay` (`dayPoolTrack`). Com 48 corridas e 12 pistas, cada pista volta a cada 6 h, nunca em
  horários seguidos, e o dia seguinte começa com pistas novas. Quem correu de manhã reencontra a pista com o que
  aprendeu, e o banco guarda 12 procedurais por dia em vez de 48. Não há coluna nova: a posição sai do horário.
  Reservas do admin têm prioridade e corridas com pista escolhida (`trackPicked`) ou descontinuada não servem de
  referência. Trocar a pista de uma corrida pelas pistas do dia muda a referência dos horários ainda não criados.

### Velocímetro

Na corrida ao vivo, no replay e no teste do box, canto superior direito da pista. Mostra o carro em foco (o seguido, o
seu ou o líder), o mesmo do som do motor. A velocidade sai da distância entre as posições desenhadas em tempo simulado
(`game/speed.ts`), suavizada porque os frames chegam a 4 Hz, e o número é escrito direto no DOM ~10 vezes por segundo.
Nos boxes mostra "box"; depois do abandono, "fora".

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
- Uso de pilotos-bot de demonstração em produção (hoje desligado por padrão: `DEMO_BOTS=0`). Os pilotos simulados
  da grade automática são ligados no admin (Pilotos simulados).
