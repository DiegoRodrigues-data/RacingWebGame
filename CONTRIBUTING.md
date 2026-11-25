# Como contribuir

Obrigado pelo interesse no **Roda Presa**! Issues e pull requests são bem-vindos.
O projeto é escrito em português: código, comentários, mensagens de erro, commits e documentação.

## Preparando o ambiente

Requisitos: Node 22+ e pnpm 9 (via `corepack enable`). Docker é opcional.

```bash
pnpm install
cp .env.example apps/api/.env   # opcional
pnpm dev                        # API em :3001 e web em :5173
```

Sem `DATABASE_URL` a API usa PGlite (Postgres em WASM) e, sem `REDIS_URL`, memória. Para zerar o banco local,
apague `apps/api/.data/pglite`. O admin de desenvolvimento é `admin@tracado.local` / `admin12345`.

## Antes de abrir o pull request

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @tracado/e2e install-browsers   # só na primeira vez
pnpm test:e2e                                 # se mexeu em fluxo de tela
```

O hook de pre-commit (Husky + lint-staged) roda `eslint --fix` e `prettier` nos arquivos alterados.
A CI do GitHub roda lint, typecheck, testes e build em cada pull request.

## Regras que valem para todo o código

- **Determinismo da simulação.** `packages/sim` e `packages/trackgen` rodam no servidor e no navegador e precisam
  dar o mesmo resultado nos dois: nada de `Math.random` nem `Date.now`; toda aleatoriedade vem do PRNG com seed.
- **Mudou o resultado da simulação?** Incremente `SIM_VERSION` e rode `pnpm balance` depois de mexer em `COEF`.
- **Mudou o gerador de pistas?** Incremente `GENERATOR_VERSION` (o snapshot do hash golden acusa a mudança).
- **Mudou um DTO?** Ajuste primeiro `packages/shared`, que é o contrato entre front e back.
- **Banco:** altere `apps/api/src/db/schema.ts` e rode `pnpm db:generate`. Confira se o `when` da migração nova em
  `drizzle/meta/_journal.json` é maior que o da anterior. Evite recursos que o PGlite não suporta.
- **API:** regra de negócio em `service.ts`; `routes.ts` só valida e chama o serviço.
- **Tailwind 4:** classes de componente se declaram com `@utility` em `styles.css`.

Mais contexto: [DECISIONS.md](DECISIONS.md) explica por que cada escolha foi feita, [docs/API.md](docs/API.md)
descreve as rotas e os eventos WebSocket e [CLAUDE.md](CLAUDE.md) resume a arquitetura.

## Issues

- **Bug:** diga o que fez, o que esperava e o que aconteceu, com navegador e passos para reproduzir.
- **Ideia:** descreva o problema que ela resolve antes da solução.
- **Falha de segurança:** não abra issue; siga o [SECURITY.md](SECURITY.md).

## Licença

Ao contribuir, você concorda que sua contribuição seja licenciada sob a [licença MIT](LICENSE) do projeto.
