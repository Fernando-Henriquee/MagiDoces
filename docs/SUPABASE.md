# Supabase — configuração do banco, autenticação e usuárias

Este guia leva do zero até as duas sócias entrando no sistema com dados reais.
Leva cerca de 30 minutos. Nada aqui exige expor segredos no código.

> **Ambientes.** Use **dois projetos Supabase**: um de **teste/preview** e um de
> **produção**. Aplique e teste cada migration primeiro no de teste. Dados reais só
> no projeto de produção.

---

## 1. Criar o projeto

1. Acesse <https://supabase.com/dashboard> → **New project**.
2. Nome: `magi-doces` (ou `magi-doces-teste` para o de teste).
3. Região: **South America (São Paulo)**.
4. Senha do banco: gere uma senha forte e guarde num gerenciador de senhas.
   Ela só é usada para backup/restauração (docs/BACKUP.md).
5. Plano: o gratuito funciona para começar. Para dados financeiros reais, o plano
   **Pro** é recomendado por ter **backups diários automáticos** (veja docs/BACKUP.md).

Anote, em **Project Settings → API**:

| Valor | Onde vai | Sensível? |
|---|---|---|
| **Project URL** (`https://xxxx.supabase.co`) | `VITE_SUPABASE_URL` (frontend/Vercel) | Não |
| **anon / publishable key** | `VITE_SUPABASE_ANON_KEY` (frontend/Vercel) | Não (protegida pela RLS) |
| **service_role / secret key** | **somente** no seu terminal, para o provisionamento | **SIM — nunca no frontend, na Vercel ou no git** |

O app se recusa a iniciar se detectar uma chave secreta em `VITE_SUPABASE_ANON_KEY`.

---

## 2. Aplicar as migrations

As migrations em `supabase/migrations/` criam **tudo**: tabelas, restrições,
RLS, funções (RPCs), views, gatilhos de auditoria, buckets privados do Storage e
políticas. Não é necessário criar nada manualmente no painel.

### Opção A — SQL Editor (sem instalar nada)

1. Painel → **SQL Editor** → **New query**.
2. Abra cada arquivo de `supabase/migrations/`, **na ordem do nome**, cole e
   clique **Run**:
   1. `20261019000100_foundation.sql`
   2. `20261019000200_catalog.sql`
   3. `20261019000300_sales.sql`
   4. `20261019000400_payables.sql`
   5. `20261019000500_import.sql`
   6. `20261019000600_views_reports.sql`
   7. `20261019000700_storage_seed.sql`
   8. `20261019000800_fixes.sql`
3. Cada execução deve terminar com "Success". Se uma falhar, **pare** e corrija
   antes de seguir (não pule arquivos).

Registre num lugar seguro quais arquivos já foram aplicados em cada projeto.

### Opção B — Supabase CLI (recomendado para atualizações futuras)

```bash
npx supabase login
npx supabase link --project-ref <ref-do-projeto>   # o "ref" está na URL do painel
npx supabase db push                                # aplica só as migrations pendentes
```

A CLI guarda o histórico de migrations aplicadas no próprio banco e evita aplicar
duas vezes. Use primeiro no projeto de teste.

### Conferir

No SQL Editor:

```sql
-- Todas as tabelas devem ter RLS ligada (resultado esperado: nenhuma linha)
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- Buckets privados criados (resultado: product-photos e receipts, public = false)
select id, public from storage.buckets;
```

---

## 3. Autenticação

Painel → **Authentication**:

1. **Sign In / Providers → Email**
   - **Allow new users to sign up: DESLIGADO** (sem cadastro público).
   - Confirm email: ligado.
   - Minimum password length: 8; Password requirements: *letters and digits*.
2. **URL Configuration**
   - **Site URL**: o endereço de produção (ex.: `https://magi-doces.vercel.app`).
   - **Redirect URLs**: adicione
     - `https://magi-doces.vercel.app/redefinir-senha`
     - `https://<seu-dominio>/redefinir-senha` (se usar domínio próprio)
     - para o projeto de teste: `https://*-<seu-usuario>.vercel.app/redefinir-senha`
       (previews da Vercel) e `http://localhost:5173/redefinir-senha`.
3. **Sessions / Refresh tokens**: manter *refresh token rotation* ligado (padrão).
4. **Emails** (opcional, recomendado): traduza os modelos de **Invite user** e
   **Reset password** para português. O link precisa continuar usando
   `{{ .ConfirmationURL }}`.

> O envio de e-mails do Supabase gratuito tem limite baixo por hora. Para uso
> contínuo, configure um SMTP próprio em **Authentication → SMTP Settings**.

---

## 4. Criar as duas usuárias e o negócio

Não existe cadastro público. As contas são **convidadas** e depois **associadas
explicitamente** ao negócio (tabela `business_members`). Sem essa associação, a
pessoa entra mas não vê nenhum dado (é bloqueada pela RLS).

### Opção A — script de provisionamento (recomendado)

Na sua máquina, na pasta do projeto, crie o arquivo `.env.provision` (está no
`.gitignore`; **não** use o prefixo `VITE_`):

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=cole-aqui-a-chave-service_role
APP_URL=https://magi-doces.vercel.app
```

Simule primeiro, depois execute:

```bash
npm run provision -- --dry-run --business "Magi Doces" \
  --owner "socia1@exemplo.com:Nome da Sócia 1" --owner "socia2@exemplo.com:Nome da Sócia 2"

npm run provision -- --business "Magi Doces" \
  --owner "socia1@exemplo.com:Nome da Sócia 1" --owner "socia2@exemplo.com:Nome da Sócia 2"
```

O script:

1. convida cada e-mail pelo Supabase Auth (cada pessoa recebe um link para
   **definir a própria senha** em `/redefinir-senha`);
2. cria o negócio "Magi Doces" com os 4 produtos iniciais (preços **a definir**);
3. associa as duas contas como **owner** (sócia/administradora).

Ele é idempotente: rodar de novo não duplica nada. **Apague o arquivo
`.env.provision` ao terminar.**

### Opção B — pelo painel + SQL Editor

1. **Authentication → Users → Invite user**: convide os dois e-mails.
2. No **SQL Editor**:

```sql
select private.provision_business('Magi Doces', array['socia1@exemplo.com', 'socia2@exemplo.com']);
```

Para adicionar alguém depois (ex.: uma ajudante só de leitura):

```sql
-- papéis: 'owner' (tudo), 'editor' (operação, sem configurações), 'viewer' (somente leitura)
select private.add_member('<id-do-negócio>', 'ajudante@exemplo.com', 'viewer');
-- id do negócio:
select id, name from public.businesses;
```

Para remover o acesso:

```sql
delete from public.business_members
where business_id = '<id-do-negócio>' and user_id = (select id from auth.users where email = 'pessoa@exemplo.com');
```

Essas funções ficam no schema `private`: só rodam pelo SQL Editor (ou com a
chave secreta), nunca pelo app.

---

## 5. Checklist depois de configurar

Faça com o app publicado (ou rodando localmente com as variáveis do projeto):

- [ ] As duas sócias recebem o convite, definem a senha e entram.
- [ ] As duas veem os mesmos dados (cadastre um cliente com uma e veja com a outra).
- [ ] "Esqueci minha senha" envia e-mail e o link abre `/redefinir-senha`.
- [ ] Uma conta convidada mas **não associada** vê a tela "Conta sem acesso a um negócio".
- [ ] Registrar uma venda, um recebimento parcial e uma despesa funciona.
- [ ] Enviar a foto de um produto e um comprovante funciona.
- [ ] Em **Configurações**, salvar a chave PIX funciona.
- [ ] Em **Auditoria**, aparecem os eventos acima com o nome de quem fez.

---

## 6. Atualizações futuras do banco

- Toda mudança estrutural vira **um novo arquivo** em `supabase/migrations/`
  (nunca edite um arquivo já aplicado).
- Fluxo: rodar `npm run test:db` → aplicar no projeto de **teste** → testar o app
  de preview → **fazer backup** da produção → aplicar na produção.
- Se uma migration der errado em produção, a correção é uma nova migration
  ("forward fix"); em último caso, restaure o backup (docs/BACKUP.md).

## 7. Limites conhecidos

- A API retorna no máximo 1.000 linhas por consulta (padrão do Supabase,
  `supabase/config.toml`). As telas e relatórios filtram por período; o
  dashboard e os relatórios agregados são calculados no banco e não sofrem esse
  limite. Se uma lista mostrar exatamente 1.000 registros, reduza o período.
- O emulador local (`npm run dev:local`) reproduz o essencial do Supabase, mas
  não substitui o checklist da seção 5 num projeto real.
