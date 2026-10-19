# Publicação na Vercel, ambientes e rollback

O frontend é um site estático (Vite) com service worker. A Vercel serve os
arquivos com HTTPS e os cabeçalhos de segurança definidos em `vercel.json`.

## 1. Repositório no GitHub

```bash
gh auth login                      # uma vez
gh repo create magi-doces --private --source . --push
```

O repositório deve ser **privado**. Nunca versione arquivos `.env*` (exceto
`.env.example`), `.env.provision`, dumps de banco ou planilhas com dados reais.

## 2. Projeto na Vercel

1. <https://vercel.com/new> → importe o repositório `magi-doces`.
2. Framework: **Vite** (já definido em `vercel.json`). Build: `npm run build`.
   Saída: `dist`. Node.js: **22.x** (Project Settings → General).
3. **Environment Variables** — separe por ambiente:

| Variável | Production | Preview | Development |
|---|---|---|---|
| `VITE_SUPABASE_URL` | URL do projeto **de produção** | URL do projeto **de teste** | URL do projeto de teste |
| `VITE_SUPABASE_ANON_KEY` | anon key de produção | anon key de teste | anon key de teste |
| `VITE_APP_ENV` | `production` | `preview` | `development` |

   **Não** cadastre `SUPABASE_SERVICE_ROLE_KEY` na Vercel.

4. **Deploy**. Ao final, anote o domínio (ex.: `https://magi-doces.vercel.app`) e
   configure-o no Supabase (docs/SUPABASE.md, seção 3: Site URL e Redirect URLs).
5. Domínio próprio (opcional): Project → Settings → Domains. A Vercel emite o
   certificado HTTPS automaticamente. Adicione o domínio também nas Redirect URLs.

Com isso, cada *pull request* gera um **preview** apontando para o banco de
teste, e só a branch `main` publica em produção.

## 3. O que o `vercel.json` garante

- **Rotas da SPA**: qualquer caminho sem extensão serve `index.html`
  (ex.: abrir `/vendas/123` direto funciona).
- **Content-Security-Policy** restritiva: scripts só do próprio domínio; conexões só
  com o próprio domínio e `*.supabase.co`; sem iframes de terceiros
  (`frame-ancestors 'none'`).
- `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `HSTS`,
  `X-Frame-Options`, `noindex` (o app não aparece em buscadores).
- **Cache**: arquivos de `/assets` (com hash no nome) por 1 ano; `sw.js`,
  `index.html` e o manifest **sem cache**, para que novas versões sejam detectadas.

## 4. Atualização do app instalado (PWA)

Quando uma nova versão é publicada, o app instalado mostra **"Nova versão
disponível"** com o botão **Atualizar**. Nada recarrega sozinho, para não perder
um formulário em preenchimento. O app também verifica novas versões a cada hora.

## 5. Reverter uma publicação (rollback)

**Frontend** (instantâneo, sem rebuild):

1. Vercel → Project → **Deployments**.
2. Encontre a última versão boa → menu `⋯` → **Instant Rollback** (ou *Promote to
   Production*).
3. Os aparelhos com o app instalado recebem o aviso de nova versão (a versão
   revertida) e atualizam quando a pessoa tocar em **Atualizar**.

Depois, corrija o problema numa branch, valide no preview e publique de novo.

**Banco de dados**: migrations não são revertidas pelo rollback da Vercel.

- Se a versão revertida do frontend não depende da migration nova, basta o
  rollback do frontend.
- Se depende, aplique uma migration de correção (*forward fix*) ou, em último
  caso, restaure o backup feito antes da migration (docs/BACKUP.md).
- Por isso: **backup antes de toda migration em produção**.

## 6. Checklist de publicação

- [ ] `npm run check` passa (tipos, lint, testes unitários e de banco, build).
- [ ] `npm run test:e2e` passa.
- [ ] Migrations novas aplicadas e testadas no projeto **de teste**.
- [ ] Preview da Vercel testado com o checklist de docs/SUPABASE.md.
- [ ] Backup da produção feito (se houver migration).
- [ ] Migrations aplicadas na produção → merge na `main`.
