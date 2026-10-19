# Backup e restauração

Dados financeiros precisam de cópia de segurança fora do próprio sistema.
Recomendamos **duas camadas**.

## Camada 1 — Backups do Supabase (recomendado para produção)

- No plano **Pro**, o Supabase faz **backup diário automático** (retenção de 7
  dias) e permite restaurar pelo painel: Project → **Database → Backups**.
- Com o complemento **Point-in-Time Recovery (PITR)**, é possível voltar a qualquer
  minuto dentro da janela contratada.
- No plano gratuito **não há backups disponíveis para download/restauração** —
  use a Camada 2 com frequência.

## Camada 2 — Dump próprio (qualquer plano)

Requer o `pg_dump` (cliente do PostgreSQL) na sua máquina:

```bash
brew install libpq && brew link --force libpq   # macOS
```

A conexão está em Supabase → **Project Settings → Database → Connection string**
(modo *Session pooler*). Use a senha do banco definida na criação do projeto.

```bash
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<SENHA>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
npm run backup:db
```

O script `scripts/backup-db.sh` gera `backups/magi-doces-AAAA-MM-DD_HHMM.sql.gz`
com **todos os dados do schema `public`** (vendas, itens, recebimentos, clientes,
produtos, receitas, compras, despesas, pagamentos, importações e auditoria). A
estrutura (tabelas, funções, RLS) não vai no arquivo: ela vem das migrations
versionadas. Ficam de fora, por dependerem das contas do Auth, as tabelas de
**membros** e **perfis**, que são recriadas no provisionamento. A pasta `backups/`
está no `.gitignore`. **Nunca** coloque dumps no GitHub ou em pastas
compartilhadas sem criptografia.

Esses parâmetros e a restauração abaixo são validados automaticamente em
`tests/db/backup.test.ts`: os totais, saldos e o histórico restaurados saem
idênticos, e o sistema continua operando depois.

Rotina sugerida: semanal e **sempre antes de aplicar uma migration** em produção.
Guarde as cópias criptografadas (ex.: imagem de disco criptografada, gerenciador
de arquivos com criptografia) e mantenha pelo menos as 4 últimas.

### Arquivos (fotos e comprovantes)

Os arquivos do Storage (e seus metadados) não entram no dump. Para copiá-los: Supabase → **Storage**
→ bucket → selecione e baixe, ou use a CLI (`npx supabase storage cp -r
ss:///receipts ./backups/receipts --experimental`). Comprovantes são opcionais no
sistema; perdê-los não afeta os valores financeiros.

### Exportações do próprio app

Toda lista e relatório tem **Exportar → CSV/Excel**. É um complemento útil (ex.:
fechamento mensal para a contabilidade), mas **não substitui** o backup do banco,
porque não restaura vínculos e histórico.

## Restauração

> Restaure primeiro num **projeto de teste** para conferir, nunca direto por cima
> da produção sem necessidade.

1. Crie um projeto Supabase novo (ou use o de teste) e **aplique as migrations até
   a mesma versão** do backup (docs/SUPABASE.md, seção 2).
2. Restaure os dados (o arquivo já começa com `SET session_replication_role =
   replica;`, que suspende os gatilhos durante a carga para os totais e a
   auditoria entrarem exatamente como estavam):

```bash
export TARGET_DB_URL='postgresql://postgres.<ref-novo>:<SENHA>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
gunzip -c backups/magi-doces-AAAA-MM-DD_HHMM.sql.gz | psql "$TARGET_DB_URL" --single-transaction -v ON_ERROR_STOP=1
```

   Use um projeto vazio (só com as migrations). Se o banco recusar o
   `session_replication_role` por falta de permissão, use a restauração do painel
   do Supabase (Camada 1).
3. Convide as usuárias no projeto restaurado e rode o provisionamento com o
   **mesmo nome de negócio** (docs/SUPABASE.md, seção 4): o script encontra o
   negócio restaurado e apenas cria as associações. Os registros antigos mantêm o
   autor original nas colunas de autoria; como as contas são novas, os nomes
   antigos aparecem como "Outro usuário" na auditoria. A restauração do próprio
   Supabase (Camada 1) preserva também as contas.
4. Copie de volta fotos e comprovantes, se tiver feito a cópia do Storage, mantendo
   os mesmos caminhos.
5. Aponte o app para o projeto restaurado (variáveis na Vercel) se ele for virar a
   produção, e refaça o checklist de docs/SUPABASE.md, seção 5.
