# Magi Doces — Plano de Implementação

Documento vivo. Registra arquitetura, decisões técnicas, progresso e próxima etapa,
para que o desenvolvimento possa continuar sem perda de contexto.

## 1. Ambiente analisado (19/10/2026)

| Item | Situação | Consequência |
|---|---|---|
| Diretório | Vazio, sem planilha antiga | Projeto criado do zero. Importador genérico até o arquivo real chegar. |
| Node / npm | 20.20.2 / 10.8.2 | Vitest 5 exige Node 22 → usar Vitest 4.1. |
| Docker, Postgres, Supabase CLI | Ausentes | Supabase local indisponível → testes de banco com **PGlite** (PostgreSQL 18 em WASM). |
| GitHub CLI | Instalado, sem login | Repositório git local; push depende de `gh auth login`. |
| Vercel CLI | Ausente | Configuração (`vercel.json`) e documentação; publicação manual. |

## 2. Stack escolhida

- React 19 + TypeScript 5.9 (strict) + Vite 7.3
- Tailwind CSS 4 + componentes próprios no padrão shadcn/ui sobre primitivas **Radix UI** (acessíveis)
- React Router 7, TanStack Query 5 (cache + persistência offline controlada), React Hook Form + Zod
- Supabase Auth + PostgreSQL + RLS + Storage
- vite-plugin-pwa 2 (Workbox, `registerType: prompt`)
- SheetJS 0.20.3 (tarball oficial do CDN — a versão do npm está desatualizada e vulnerável)
- Vitest 4.1 + Testing Library; PGlite para testes de banco; Playwright para E2E
- Fontes auto-hospedadas (Fontsource): Fraunces (títulos) e Inter (dados, números tabulares)

## 3. Arquitetura

```
Navegador (PWA)
 ├─ React + TanStack Query ── supabase-js (chave pública/anon + JWT do usuário)
 │    └─ cache persistido em IndexedDB (somente leitura, TTL, limpo no logout)
 └─ Service Worker (precache do app shell; NÃO armazena respostas da API)
        │
Supabase
 ├─ Auth (sem cadastro público; usuários convidados/provisionados)
 ├─ PostgREST → tabelas (somente SELECT nas financeiras) + views security_invoker
 ├─ RPCs SECURITY DEFINER (escritas financeiras validadas, transacionais, idempotentes)
 ├─ RLS em todas as tabelas (isolamento por business_id + papel do membro)
 └─ Storage privado (fotos de produtos, comprovantes) com políticas por pasta do negócio
```

Princípios:

1. **O banco é a fonte da verdade financeira.** Totais, custos históricos, saldos e
   indicadores são calculados em SQL. O navegador envia apenas intenção
   (produto, quantidade, preço unitário escolhido, desconto); o banco calcula.
2. **Escritas financeiras só por RPC.** `sales`, `sale_items`, `payments`, `purchases`,
   `purchase_items`, `expenses`, `bill_payments`, `import_*` não têm privilégio de
   INSERT/UPDATE/DELETE para `authenticated`. As RPCs verificam o papel do usuário.
3. **Cadastros (clientes, produtos, ingredientes, receitas, fornecedores)** usam CRUD
   direto com RLS por papel.
4. **Saldo nunca é armazenado**: é derivado de total da venda − pagamentos válidos.
   Totais da venda são armazenados, mas mantidos exclusivamente por trigger a partir
   dos itens (mecanismo transacional), com `CHECK` de consistência.
5. **Integridade entre negócios por chave estrangeira composta** `(business_id, id)`:
   é impossível referenciar cliente/produto de outro negócio.
6. **Auditoria por trigger** (SECURITY DEFINER) em tabelas financeiras; tabela
   `audit_logs` sem privilégios de escrita para usuários.

## 4. Modelo de dados (resumo)

- `businesses` (nome, fuso horário, dia padrão de vencimento = 10, chave PIX opcional)
- `business_members` (business_id, user_id, role: `owner` | `editor` | `viewer`)
- `profiles` (nome de exibição; criado por trigger em `auth.users`)
- `customers`, `suppliers`
- `products` (preço e custo manual opcionais, `cost_mode` manual|recipe, ativo)
- `product_price_history` (trigger em alterações de preço/custo)
- `ingredients` (unidade, quantidade adquirida, custo de aquisição, rendimento %)
- `recipes` (1 por produto, rendimento), `recipe_items`, `recipe_extra_costs`
- `sales` (data, vencimento, desconto, totais mantidos por trigger, cancelamento,
  `client_request_id` para idempotência, `import_fingerprint`)
- `sale_items` (snapshot de nome, preço e **custo unitário histórico**; totais de linha
  em colunas geradas)
- `payments` (`receipt` | `refund`, anulação/estorno com histórico, idempotência)
- `purchases` + `purchase_items` (compras de insumos), `expenses` (despesas operacionais)
- `bill_payments` (parcelas/pagamentos de compras e despesas; previstas e pagas)
- `import_batches`, `import_rows` (rastreabilidade e idempotência da importação)
- `audit_logs`

## 5. Regras financeiras

- Dinheiro em **centavos inteiros** (`integer`/`bigint`). Quantidades em `numeric(12,3)`.
- Arredondamento: **meio para longe do zero** (`round()` do PostgreSQL), aplicado
  uma vez por linha (`quantidade × preço unitário`) e no custo unitário de receita.
- Total da venda = Σ(linha − desconto da linha) − desconto da venda (≥ 0).
- Recebido líquido = Σ recebimentos válidos − Σ reembolsos válidos.
- Saldo = total − recebido líquido. 0 ≤ recebido líquido ≤ total (validado com lock).
- Situação: cancelada | paga | parcial | pendente; `vencida` quando saldo > 0 e
  vencimento < hoje (fuso do negócio). Vencimento passado **nunca** quita a venda.
- Importação sem dados de pagamento → "pendente de confirmação".
- Estorno (anulação) remove o lançamento de todos os totais mantendo histórico;
  reembolso é saída de caixa datada.
- Compras: compromisso (total) separado de pagamentos/parcelas; o total não é
  recontado a cada parcela.
- Indicadores (detalhe em `docs/FINANCEIRO.md`):
  - Faturamento = Σ total das vendas ativas com data no período
  - Recebido = recebimentos − reembolsos com data de pagamento no período
  - CMV estimado = Σ quantidade × custo unitário histórico (itens sem custo sinalizados)
  - Lucro estimado = Faturamento − CMV estimado − despesas operacionais do período
  - Fluxo de caixa = Recebido − pagamentos de compras − pagamentos de despesas
  - Compras de estoque **não** entram no lucro (entram via CMV)

## 6. Configurações externas necessárias (sem segredos no código)

| Configuração | Onde | Variável |
|---|---|---|
| Projeto Supabase | supabase.com | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (públicas) |
| Desativar cadastro público | Supabase → Auth → Providers | — |
| URLs de redirecionamento (recuperação de senha) | Supabase → Auth → URL Configuration | — |
| Provisionamento dos 2 usuários | Script local / SQL editor | `SUPABASE_SERVICE_ROLE_KEY` **somente local**, nunca `VITE_` |
| Projeto Vercel | vercel.com | as variáveis `VITE_*` por ambiente |

## 7. Estratégia de testes

- **Unitários (Vitest)**: dinheiro, datas/fuso, totais e descontos, saldo e situação,
  agrupamento por cliente, vencimentos do dia 10, custo de receitas e conversão de
  unidades, parser/mapeamento/validação/duplicidades da importação, mensagem de
  cobrança, exportação CSV, atualização da PWA.
- **Banco (Vitest + PGlite)**: migrations aplicadas sobre stubs de `auth`/`storage`;
  RLS e isolamento entre negócios; papéis; RPCs de venda/pagamento/estorno/
  cancelamento/compras/importação; idempotência; auditoria imutável; indicadores
  (fluxo de caixa × lucro); verificação de catálogo (RLS em todas as tabelas,
  `anon` sem privilégios).
- **E2E (Playwright)**: build de produção + **servidor local que emula a API do
  Supabase** (auth/REST/RPC/storage) sobre PGlite com as mesmas migrations. Os 9
  fluxos obrigatórios. O emulador também serve como ambiente local de
  desenvolvimento, claramente identificado, separado de dados reais.
- Limitação: o emulador não substitui um teste contra um projeto Supabase real;
  há um checklist de verificação pós-configuração no README.

## 8. Etapas

| # | Etapa | Status |
|---|---|---|
| 0 | Análise do ambiente e plano | ✅ |
| 1 | Scaffold (Vite/React/TS/Tailwind/ESLint/Vitest), git | ✅ |
| 2 | Migrations: schema, RLS, triggers, RPCs, views, relatórios | ✅ |
| 3 | Testes de banco com PGlite | ✅ (93 testes) |
| 4 | Bibliotecas de domínio (dinheiro, datas, receitas, recebíveis) + testes | ⬜ |
| 5 | Emulador local da API Supabase + seed local | ⬜ |
| 6 | UI base: tema, componentes, layout, auth, PWA, cache offline | ⬜ |
| 7 | Clientes, Produtos (histórico de preços, foto), Ingredientes/Receitas | ⬜ |
| 8 | Vendas (nova/editar/cancelar), Pagamentos, Contas a receber, WhatsApp | ⬜ |
| 9 | Compras, Despesas, Pagamentos parcelados | ⬜ |
| 10 | Dashboard, Financeiro/fluxo de caixa, Relatórios, Exportação | ⬜ |
| 11 | Importação de planilhas | ⬜ |
| 12 | Auditoria, Configurações, Perfil | ⬜ |
| 13 | E2E Playwright (9 fluxos) | ⬜ |
| 14 | Documentação (README, Supabase, Vercel, backup, rollback) | ⬜ |

## 9. Registro de progresso

- 19/10/2026 — Etapa 0 concluída. PGlite validado: RLS, `SET ROLE`, views
  `security_invoker` e funções `SECURITY DEFINER` funcionam.
- 19/10/2026 — Etapas 1–3: 7 migrations (fundação, cadastros, vendas, contas a
  pagar, importação, views/relatórios, storage/seed) e 93 testes de banco
  passando. Bugs encontrados pelos testes e corrigidos: acesso a record não
  atribuído em itens de compra; concatenação `text[] || literal`; stub de
  `auth.uid()` com setting vazio.

## 10. Próxima etapa

Etapa 4 — bibliotecas de domínio no frontend (dinheiro, datas, cálculo de venda,
recebíveis, receitas) com testes unitários.
