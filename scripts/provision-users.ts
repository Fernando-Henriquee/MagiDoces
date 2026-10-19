import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/**
 * PROVISIONAMENTO ADMINISTRATIVO (executar somente na sua máquina).
 *
 * Convida as usuárias pelo Supabase Auth (cada uma recebe um e-mail para definir a
 * senha), cria o negócio se ainda não existir e as associa como owner.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   APP_URL=https://magi-doces.vercel.app \
 *   npm run provision -- --business "Magi Doces" \
 *     --owner "socia1@exemplo.com:Nome 1" --owner "socia2@exemplo.com:Nome 2"
 *
 * Também lê as variáveis de um arquivo .env.provision (fora do git), se existir.
 * A chave service_role IGNORA a RLS: nunca a coloque no frontend, na Vercel ou no git.
 */

function loadEnvFile(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
    }
  } catch {
    // arquivo opcional
  }
}

loadEnvFile('.env.provision');

const { values } = parseArgs({
  options: {
    business: { type: 'string', default: 'Magi Doces' },
    owner: { type: 'string', multiple: true, default: [] },
    timezone: { type: 'string', default: 'America/Sao_Paulo' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const appUrl = (process.env.APP_URL ?? '').replace(/\/+$/, '');

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url.startsWith('https://')) fail('Defina SUPABASE_URL (https://<projeto>.supabase.co).');
if (!serviceKey) fail('Defina SUPABASE_SERVICE_ROLE_KEY (somente no terminal ou em .env.provision).');
if (process.env.VITE_SUPABASE_SERVICE_ROLE_KEY) fail('Nunca use o prefixo VITE_ para a chave service_role: ela seria embutida no app.');
if (!appUrl.startsWith('https://') && !appUrl.startsWith('http://localhost')) fail('Defina APP_URL com o endereço publicado (para o link do convite).');
const owners = values.owner.map((entry) => {
  const [email, ...name] = entry.split(':');
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(`E-mail inválido em --owner "${entry}".`);
  return { email: email.trim().toLowerCase(), name: name.join(':').trim() };
});
if (owners.length === 0) fail('Informe ao menos um --owner "email:Nome".');

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };

async function api<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${url}${path}`, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) fail(`${method} ${path.split('?')[0]} → ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface AuthUser {
  id: string;
  email: string;
}

async function findUser(email: string): Promise<AuthUser | null> {
  for (let page = 1; page <= 50; page += 1) {
    const result = await api<{ users: AuthUser[] }>('GET', `/auth/v1/admin/users?page=${page}&per_page=200`);
    const found = result.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;
    if (result.users.length < 200) return null;
  }
  return null;
}

const dryRun = values['dry-run'];
console.log(`Projeto: ${url}${dryRun ? '  (simulação: nada será alterado)' : ''}`);

const userIds: Array<{ email: string; id: string }> = [];
for (const owner of owners) {
  const existing = await findUser(owner.email);
  if (existing) {
    console.log(`• ${owner.email}: já existe no Auth.`);
    userIds.push({ email: owner.email, id: existing.id });
    continue;
  }
  if (dryRun) {
    console.log(`• ${owner.email}: seria convidada.`);
    continue;
  }
  const invited = await api<AuthUser>('POST', `/auth/v1/invite?redirect_to=${encodeURIComponent(`${appUrl}/redefinir-senha`)}`, {
    email: owner.email,
    data: owner.name ? { display_name: owner.name } : {},
  });
  console.log(`• ${owner.email}: convite enviado (o e-mail traz o link para definir a senha).`);
  userIds.push({ email: owner.email, id: invited.id });
}

const rest = (path: string) => `/rest/v1/${path}`;
let businesses = await api<Array<{ id: string; name: string }>>('GET', rest(`businesses?select=id,name&name=eq.${encodeURIComponent(values.business)}`));
let businessId = businesses[0]?.id;
if (!businessId) {
  if (dryRun) {
    console.log(`• Negócio "${values.business}": seria criado com os produtos iniciais.`);
  } else {
    businesses = await api('POST', rest('businesses'), { name: values.business, timezone: values.timezone }, { Prefer: 'return=representation' });
    businessId = businesses[0]!.id;
    await api('POST', rest('products'), ['Bolo de pote', 'Torta de limão', 'Morango cravejado', 'Surpresa de uva'].map((name) => ({
      business_id: businessId,
      name,
      category: 'Doces',
      unit: 'un',
      price_cents: null,
    })));
    console.log(`• Negócio "${values.business}" criado com os 4 produtos iniciais (preços a definir).`);
  }
} else {
  console.log(`• Negócio "${values.business}" já existe (${businessId}).`);
}

if (businessId && !dryRun) {
  for (const user of userIds) {
    await api('POST', rest('business_members?on_conflict=business_id,user_id'), { business_id: businessId, user_id: user.id, role: 'owner' }, {
      Prefer: 'resolution=merge-duplicates',
    });
    console.log(`• ${user.email}: associada ao negócio como owner.`);
  }
}

console.log('\nPronto. Cada pessoa deve abrir o e-mail de convite e definir a senha.');
console.log('Lembrete: apague a chave service_role do terminal/arquivo local quando terminar.');
