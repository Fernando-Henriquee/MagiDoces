-- =============================================================================
-- Magi Doces — 0900 Privilégios explícitos para a service_role
--
-- Recomendação de segurança do Supabase: criar o projeto com "Automatically
-- expose new tables" DESLIGADO. Nesse modo nenhuma tabela recebe privilégios
-- automáticos. As migrations anteriores já concedem explicitamente o necessário
-- a `authenticated` (e nada a `anon`); aqui garantimos também a `service_role`
-- (chave administrativa, usada só pelo script de provisionamento — ela ignora a
-- RLS por definição do Supabase). Funciona com a opção ligada ou desligada.
-- =============================================================================

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Objetos criados por migrations futuras (executadas como postgres) também.
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
