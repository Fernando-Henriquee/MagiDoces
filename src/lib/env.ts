/**
 * Configuração do frontend. Somente valores PÚBLICOS: a URL do projeto e a chave
 * anon/publishable (protegida pela RLS). Chaves secretas são recusadas.
 */

export type AppEnv = 'local' | 'development' | 'preview' | 'production';

export interface EnvStatus {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appEnv: AppEnv;
  problems: string[];
}

function decodeJwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

export function readEnv(raw: ImportMetaEnv = import.meta.env): EnvStatus {
  const supabaseUrl = (raw.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = (raw.VITE_SUPABASE_ANON_KEY ?? '').trim();
  const appEnv = (raw.VITE_APP_ENV ?? 'development') as AppEnv;
  const problems: string[] = [];
  if (!supabaseUrl) problems.push('VITE_SUPABASE_URL não definida.');
  else if (!/^https?:\/\//.test(supabaseUrl)) problems.push('VITE_SUPABASE_URL deve começar com https://.');
  else if (appEnv === 'production' && !supabaseUrl.startsWith('https://')) problems.push('Em produção a URL do Supabase deve usar HTTPS.');
  if (!supabaseAnonKey) problems.push('VITE_SUPABASE_ANON_KEY não definida.');
  if (supabaseAnonKey.startsWith('sb_secret_') || decodeJwtRole(supabaseAnonKey) === 'service_role') {
    problems.push('A chave configurada é SECRETA (service_role). Remova-a do frontend imediatamente e gere uma nova no Supabase.');
  }
  return { supabaseUrl, supabaseAnonKey, appEnv, problems };
}

export const env = readEnv();
export const isLocalEnv = env.appEnv === 'local';
