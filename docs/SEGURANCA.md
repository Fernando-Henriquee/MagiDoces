# Segurança e privacidade

## Modelo

A proteção dos dados está **no banco de dados**, não nas telas. Esconder um botão
não protege nada; quem decide o que cada pessoa pode ler ou gravar é a RLS
(Row Level Security) do PostgreSQL, avaliada em toda consulta.

| Camada | O que garante |
|---|---|
| **Supabase Auth** | Contas individuais, senha mínima de 8 caracteres com letras e números, sessão com token de curta duração (1 h) e refresh token rotativo. Sem cadastro público. |
| **business_members** | Associação explícita pessoa ↔ negócio, com papel: `owner` (tudo), `editor` (operação, sem configurações), `viewer` (somente leitura). |
| **RLS em todas as tabelas** | Cada linha pertence a um `business_id`; só membros daquele negócio a leem. Testado automaticamente (`tests/db/security.test.ts`). |
| **Escritas financeiras só por RPC** | Vendas, itens, recebimentos, compras, despesas, pagamentos e importações **não** têm permissão de INSERT/UPDATE/DELETE direta. As funções `SECURITY DEFINER` verificam o papel e calculam os totais. |
| **Privilégios por coluna** | Nos cadastros, `business_id`, `id` e campos de autoria não podem ser alterados pelo cliente. |
| **Chaves estrangeiras compostas** | `(business_id, id)`: é impossível referenciar cliente, produto ou venda de outro negócio, mesmo por engano. |
| **Invariantes no commit** | Recebido ≤ total, reembolso ≤ recebido, pagamentos ≤ total da compra: verificados por gatilhos adiados, valendo para qualquer caminho de gravação. |
| **Auditoria imutável** | `audit_logs` é gravada só por gatilhos/RPCs; usuários não podem inserir, alterar ou apagar. Nem o superusuário altera um registro (gatilho bloqueia UPDATE). |
| **Storage privado** | Fotos e comprovantes em buckets privados, em pastas por negócio, com políticas RLS; exibidos por URL assinada de 5 minutos. |
| **Frontend** | Só a chave pública (anon). O app se recusa a iniciar com chave secreta. CSP restritiva, sem scripts de terceiros. |

Os testes de banco também verificam o catálogo: toda tabela tem RLS, `anon` não
tem nenhum privilégio em tabelas ou views, `anon` executa **somente** as cinco
funções do link de compras (abaixo), toda view usa `security_invoker` e toda
função `SECURITY DEFINER` fixa o `search_path`.

## Link de compras (página pública)

A página `/compra/<token>` é a única parte do sistema aberta sem login. Ela foi
desenhada para não abrir nenhum caminho para os dados do negócio:

| Proteção | Como funciona |
|---|---|
| **Sem acesso a tabelas** | O visitante (`anon`) só executa `storefront`, `storefront_register_purchase`, `storefront_report_paid`, `storefront_create_code` e `storefront_statement`. Elas validam tudo e devolvem só o necessário (nunca custo, observações internas ou dados de outras clientes). |
| **Link com token aleatório** | 122 bits aleatórios (22 caracteres). Desligar ou **trocar o link** em Configurações invalida o antigo na hora (útil se o QR code for parar onde não devia). |
| **Preço vem do cadastro** | A cliente só informa produto e quantidade (1 a 50, até 20 produtos, até R$ 5.000 por compra). Preço, desconto e custo são sempre os do sistema. |
| **Revisão** | Toda compra anotada pela cliente entra com o selo “a revisar”; as sócias conferem, editam ou cancelam. “Já paguei” só sinaliza: o recebimento continua sendo registrado por uma sócia. |
| **Consulta com código** | “Quanto eu devo” exige celular + código de 4 números, guardado como hash com sal. Código errado e celular sem código respondem igual (não revela quem é cliente). **5 erros bloqueiam o celular por 15 minutos**; há também limites por origem (IP) e por negócio. |
| **Quem cria o código** | Celular novo: a própria cliente, logo após a primeira compra (usando os identificadores secretos daquela compra). Celular que **já era cliente**: só as sócias geram (ficha da cliente → “Gerar código”), para ninguém criar o código no lugar dela. |
| **Limites contra abuso** | Até 8 compras por celular por hora, 20 por origem e 120 por negócio. Os eventos guardam só hashes (nada de celular ou IP em texto) e são apagados após 2 dias. |
| **Sem sessão** | A página usa só a chave pública, nunca a sessão de quem estiver logado no aparelho, e não usa o cache offline do sistema. |

Tudo isso é coberto por `tests/db/storefront.test.ts` e `tests/e2e/storefront.spec.ts`.

## Dados no aparelho

- **Cache de leitura** para uso offline em IndexedDB, **separado por usuário**,
  com validade máxima de **72 horas**, revalidado sempre que há conexão e
  **apagado no logout**. Não contém senhas.
- **Sessão**: o Supabase guarda o token de acesso e o refresh token no
  armazenamento do navegador (modelo padrão de aplicações web). Mitigações: CSP sem
  scripts externos, token de acesso de 1 hora, refresh token rotativo, logout que
  revoga a sessão e opção "Sair de todos os aparelhos" no Perfil.
- O **service worker** guarda apenas os arquivos do app (HTML, JS, CSS, fontes,
  ícones). **Nenhuma resposta da API** com dados financeiros é guardada por ele.
- Não existe gravação offline: vendas, pagamentos e despesas exigem conexão
  confirmada com o servidor no momento de gravar (sem filas silenciosas).
- Em aparelho compartilhado: use **Sair**, ou Configurações → "Apagar dados salvos
  neste aparelho".

## Segredos

- `.env.example` lista as variáveis com valores fictícios. Arquivos `.env*` reais e
  `.env.provision` estão no `.gitignore`.
- A chave `service_role` só é usada pelo script de provisionamento, na sua máquina.
  Se ela vazar: Supabase → Project Settings → API → **gere novas chaves** e
  atualize onde for usada.
- Logs do app não registram dados financeiros nem tokens.

## Boas práticas de uso

- Cada pessoa com a **própria conta**: não compartilhe senha. A auditoria registra
  quem fez cada operação.
- Use papéis mínimos: ajudantes podem ser `viewer` (somente leitura).
- Ao desligar alguém, remova a associação (docs/SUPABASE.md, seção 4) e, se
  necessário, bloqueie a conta em Authentication → Users.
