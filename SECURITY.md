# Segurança

## Como relatar uma vulnerabilidade

**Não abra uma issue pública.** Use o relato privado do GitHub:
aba **Security → Report a vulnerability** deste repositório.

Conte o que encontrou, como reproduzir e qual o impacto. A resposta inicial vem em até 7 dias.
Corrigido o problema, o crédito vai para quem relatou, se quiser.

## Escopo

- O código deste repositório (API, web, simulação e infraestrutura de exemplo).
- Não há instância oficial em produção: quem hospeda o jogo responde pelo próprio servidor.

## Antes de publicar uma instância

A API recusa subir em `NODE_ENV=production` com o `JWT_SECRET` de desenvolvimento, com a senha padrão do admin
(`admin12345`) ou com `ENABLE_DEV_ROUTES`. Além disso:

- Defina `JWT_SECRET` longo e aleatório (`openssl rand -base64 48`), `ADMIN_PASSWORD` forte e `POSTGRES_PASSWORD`.
- Não ligue `SEED_DEMO` em produção: o seed cria contas de demonstração com senhas conhecidas
  (`editor@tracado.local` / `editor12345`).
- Sirva por HTTPS (`COOKIE_SECURE=true` já vem no `docker-compose.prod.yml`).
- Se usar `METRICS_TOKEN`, guarde-o como segredo; sem ele, `/api/metrics` fica aberto.
- Segredos ficam só nas variáveis de ambiente do servidor, nunca em arquivos versionados.
