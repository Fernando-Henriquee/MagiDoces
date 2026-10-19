# Magi Doces — sistema de gestão (PWA)

Sistema de gestão da **Magi Doces**, confeitaria de doces artesanais. Substitui a
planilha de vendas e clientes e centraliza clientes, produtos, receitas, vendas,
recebimentos, contas a receber, compras, despesas, fluxo de caixa, relatórios e
importação da planilha antiga.

- Duas sócias, cada uma com a própria conta, vendo os mesmos dados.
- Funciona no celular, tablet e computador, e pode ser **instalado como app**.
- Telas já abertas podem ser consultadas **sem internet**; gravações exigem conexão.
- Os cálculos financeiros são feitos e validados **no banco de dados**.

## Sumário

- [Como rodar agora (ambiente local)](#como-rodar-agora-ambiente-local)
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Testes](#testes)
- [Publicação (Supabase + Vercel)](#publicação-supabase--vercel)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Comandos](#comandos)
- [Concluído e pendente](#concluído-e-pendente)

Documentação detalhada:

| Documento | Conteúdo |
|---|---|
| [docs/SUPABASE.md](docs/SUPABASE.md) | Criar o projeto, aplicar migrations, configurar login, **criar as duas usuárias** |
| [docs/VERCEL.md](docs/VERCEL.md) | Publicar, ambientes (dev/preview/produção), **rollback** |
| [docs/FINANCEIRO.md](docs/FINANCEIRO.md) | **Fórmulas** dos indicadores e regras de dinheiro, saldo, parcelas e receitas |
| [docs/SEGURANCA.md](docs/SEGURANCA.md) | Modelo de segurança (RLS, papéis, auditoria, dados no aparelho) |
| [docs/BACKUP.md](docs/BACKUP.md) | **Backup e restauração** |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Decisões técnicas e histórico do desenvolvimento |

## Como rodar agora (ambiente local)

Não precisa de conta no Supabase para experimentar: o projeto traz um **emulador
local da API do Supabase** que roda o mesmo banco PostgreSQL (via PGlite) com as
mesmas migrations de produção. Os dados locais são fictícios e ficam só na sua
máquina, em `.local-backend/`.

Requisitos: Node.js **22** (recomendado; funciona a partir do 20.19) e npm.

```bash
npm install
npm run dev:local -- --demo     # --demo inclui vendas e compras de exemplo
```

Abra <http://localhost:5173> e entre com:

| E-mail | Senha | Perfil |
|---|---|---|
| `ana@local.test` | `senha-local-123` | sócia (acesso total) |
| `bia@local.test` | `senha-local-123` | sócia (mesmos dados da Ana) |
| `leitura@local.test` | `senha-local-123` | somente leitura |
| `outro@local.test` | `senha-local-123` | outro negócio (não vê nada da Magi Doces) |

Criar a sua própria conta local (com o ambiente rodando, em outro terminal):

```bash
npm run local:add-user -- voce@exemplo.com "sua-senha-8+" "Seu Nome"
```

Para recomeçar do zero, pare o ambiente e apague a pasta `.local-backend/`.
A faixa azul no topo indica o ambiente local.

## Funcionalidades

| Módulo | Destaques |
|---|---|
| **Início** | Faturamento, recebido, CMV e lucro estimados, contas a receber, vencidos, previsto para o dia 10, contas a pagar, compras, despesas, fluxo de caixa. Filtro por dia, semana, mês ou período. |
| **Vendas** | Registro rápido (produtos por toque), cliente existente ou cadastrado na hora, vários itens, preço e desconto por item e na venda, pago/parcial/a receber, vencimento no dia 10 em um toque. Edição, cancelamento rastreável, estorno e reembolso. Preço e custo históricos gravados em cada item. |
| **A receber** | Por cliente e por vencimento, filtro do dia 10 (próximo ou todo dia 10), parciais, a confirmar, período; histórico de movimentações; exportação; **resumo para WhatsApp**. |
| **Clientes** | Cadastro, histórico de compras e pagamentos, saldo e vencidos. Clientes com histórico não podem ser excluídos (são desativados). |
| **Produtos** | Preço (pode ficar "a definir"), custo manual ou por receita, foto, histórico de preços, margem estimada. Os 4 produtos iniciais vêm como configuração, sem preço presumido. |
| **Ingredientes e receitas** | Custo de aquisição, quantidade, aproveitamento; receitas com rendimento e custos adicionais; conversão kg↔g, l↔ml, dúzia↔unidade (incompatíveis são recusadas). Receitas são opcionais. |
| **Compras e despesas** | Itens, fornecedor, categoria, frete e desconto, comprovante; pagas, a pagar ou **parceladas**; pagamento de parcelas, estorno, cancelamento. |
| **Fluxo de caixa** | Realizado × previsto por dia, saldo acumulado, contas a pagar, pagamentos. |
| **Relatórios** | Vendas e recebimentos por período, a receber, compras e despesas, resultado estimado, produtos mais vendidos e margem, clientes, consumo de ingredientes. CSV e Excel. |
| **Importar planilha** | XLSX, XLS e CSV; detecção de colunas e de produtos pelos cabeçalhos; mapeamento manual; regras de migração explícitas; prévia com validação, correção e duplicidades; importação transacional e **idempotente**; relatório e histórico de lotes. |
| **Auditoria** | Quem fez o quê e quando: vendas, recebimentos, estornos, cancelamentos, vencimentos, compras, importações, configurações e membros. Somente leitura. |
| **Configurações e perfil** | Dados do negócio (fuso, dia de vencimento, chave PIX, rodapé da cobrança), pessoas com acesso, instalação do app, dados salvos no aparelho, troca de senha, sair de todos os aparelhos. |

## Arquitetura

```
Navegador (PWA: React + TypeScript + Tailwind)
 ├─ TanStack Query ─ supabase-js (chave pública + JWT do usuário)
 │    └─ cache de leitura no IndexedDB (por usuário, 72 h, apagado no logout)
 └─ Service worker: só o app (HTML/JS/CSS/fontes/ícones), nunca dados da API
                │
Supabase
 ├─ Auth (convites, sem cadastro público)
 ├─ PostgreSQL + RLS em todas as tabelas (isolamento por negócio e por papel)
 ├─ RPCs transacionais e idempotentes para toda gravação financeira
 ├─ Views com saldo e situação derivados; indicadores calculados no banco
 └─ Storage privado (fotos e comprovantes) com URLs assinadas
```

Princípios: o banco é a fonte da verdade; dinheiro em centavos inteiros; saldo
nunca armazenado (sempre derivado); escritas financeiras só por funções que
validam e recalculam; nenhuma gravação offline silenciosa. Detalhes em
[docs/SEGURANCA.md](docs/SEGURANCA.md) e [docs/FINANCEIRO.md](docs/FINANCEIRO.md).

**Stack:** React 19, TypeScript 5.9 (strict), Vite 7, Tailwind CSS 4, Radix UI,
React Router 7, TanStack Query 5, React Hook Form + Zod, Supabase (Auth,
PostgreSQL, RLS, Storage), vite-plugin-pwa (Workbox), SheetJS, Vitest,
Playwright, PGlite.

## Testes

```bash
npm run test         # unitários + banco de dados (Vitest)
npm run test:e2e     # ponta a ponta (Playwright) — na 1ª vez: npx playwright install chromium
npm run check        # tipos + lint + testes + build de produção
```

| Suíte | O que cobre |
|---|---|
| **Unitários** (`src/**/*.test.ts`) | dinheiro e arredondamento, datas e fuso, dia 10, totais e descontos, recebíveis e agrupamentos, custo de receitas e unidades, parcelas, WhatsApp, exportação CSV, importação (leitura, detecção, validação, duplicidades), auditoria, atualização da PWA |
| **Banco** (`tests/db`) | migrations reais num PostgreSQL (PGlite): RLS e isolamento entre negócios, papéis, privilégios, imutabilidade da auditoria, Storage, vendas, pagamentos parciais, estornos, reembolsos, cancelamentos, idempotência, receitas, compras e parcelas, indicadores (fluxo de caixa × lucro), relatórios, importação, **backup e restauração** |
| **E2E** (`tests/e2e`) | contra o build de produção com os cabeçalhos da Vercel (CSP) e o emulador: login, recuperação de senha, cliente, produto, venda, pagamento parcial, cancelamento, contas a receber e WhatsApp, compra e despesa, importação, dashboard, isolamento, somente leitura, PWA e uso **offline**, configurações — no celular e no desktop |

## Publicação (Supabase + Vercel)

1. **Supabase**: crie o projeto, aplique as migrations, desligue o cadastro
   público e provisione as duas usuárias → [docs/SUPABASE.md](docs/SUPABASE.md).
2. **Vercel**: importe o repositório e configure `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` e `VITE_APP_ENV` por ambiente →
   [docs/VERCEL.md](docs/VERCEL.md).
3. **Backup**: defina a rotina → [docs/BACKUP.md](docs/BACKUP.md).

Variáveis (veja `.env.example`):

| Variável | Uso |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase (pública) |
| `VITE_SUPABASE_ANON_KEY` | chave pública anon/publishable (protegida pela RLS) |
| `VITE_APP_ENV` | `local`, `development`, `preview` ou `production` |
| `SUPABASE_SERVICE_ROLE_KEY` | **somente** para o script de provisionamento, na sua máquina — nunca na Vercel ou no frontend |

## Estrutura do projeto

```
supabase/migrations/   migrations SQL versionadas (schema, RLS, RPCs, views, relatórios, storage)
supabase/config.toml   configuração da Supabase CLI (auth sem cadastro público etc.)
src/app/               composição do app, rotas, telas de estado (sem acesso, offline…)
src/components/        componentes de interface (ui/), layout e componentes de domínio (shared/)
src/data/              acesso a dados (consultas e mutações via supabase-js)
src/features/          telas por módulo (vendas, a receber, clientes, produtos, compras…)
src/lib/               regras puras e testadas (dinheiro, datas, recebíveis, receitas, importação…)
tests/db/              testes do banco com PGlite
tests/e2e/             testes ponta a ponta com Playwright
tools/local-backend/   emulador local da API do Supabase (desenvolvimento e E2E)
scripts/               provisionamento, backup, ambiente local, servidor do build
docs/                  documentação
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev:local` | app + emulador local (dados fictícios em `.local-backend/`) |
| `npm run dev` | app apontando para o Supabase configurado em `.env.local` |
| `npm run build` / `npm run preview` | build de produção / servir o build |
| `npm run test`, `test:unit`, `test:db`, `test:e2e` | testes |
| `npm run check` | tipos + lint + testes + build |
| `npm run local:add-user` | cria conta no ambiente local |
| `npm run provision` | convida e associa as usuárias no Supabase real (administrativo) |
| `npm run backup:db` | backup dos dados (requer `pg_dump`) |
| `npm run icons` | regenera os ícones da PWA a partir de `public/icon.svg` |

## Concluído e pendente

**Concluído**: todos os módulos descritos acima, com persistência real; segurança
no banco (RLS, papéis, auditoria imutável); PWA instalável com uso offline das
telas já abertas e atualização controlada; importação com prévia e validação;
testes unitários, de banco e E2E; documentação de configuração, publicação,
backup e rollback.

**Depende de você (configuração externa)**:

- Criar os projetos Supabase (teste e produção) e aplicar as migrations.
- Provisionar as duas contas reais (e-mails das sócias).
- Criar o repositório no GitHub (`gh auth login`) e o projeto na Vercel.
- Opcional: domínio próprio e SMTP próprio para os e-mails de convite e senha.

**Pendente / limitações conhecidas**:

- **Testes com a planilha real**: assim que o arquivo antigo estiver disponível,
  adicionar um caso de teste com o formato exato dele (`src/lib/import/import.test.ts`)
  e conferir o mapeamento sugerido.
- **Validação num projeto Supabase real**: tudo foi testado no PostgreSQL 18
  (PGlite) e no emulador local; o checklist de [docs/SUPABASE.md](docs/SUPABASE.md)
  (seção 5) deve ser feito no primeiro deploy.
- Não há controle de estoque físico (o consumo de ingredientes é estimado pelas
  receitas) nem emissão de nota fiscal.
- A API retorna até 1.000 linhas por lista; telas e relatórios usam filtros de
  período (indicadores agregados são calculados no banco, sem esse limite).
- Sem gravação offline (decisão de projeto: vendas e pagamentos exigem conexão).
