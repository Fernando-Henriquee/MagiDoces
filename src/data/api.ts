import { supabase } from '@/lib/supabase';

/** Lança o erro do Supabase (PostgrestError) ou devolve os dados. */
export async function unwrap<T>(request: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw error;
  return data as T;
}

/** Chamada de RPC tipada. */
export function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return unwrap<T>(supabase.rpc(fn, args) as unknown as PromiseLike<{ data: T | null; error: unknown }>);
}

/** Converte números que podem chegar como string (numeric) em number. */
export function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value !== '') return Number(value);
  return 0;
}

/** Chaves de cache: tudo de um negócio fica sob ['b', businessId]. */
export const keys = {
  business: (businessId: string) => ['b', businessId] as const,
  list: (businessId: string, entity: string, params?: unknown) => ['b', businessId, entity, 'list', params ?? null] as const,
  detail: (businessId: string, entity: string, id: string) => ['b', businessId, entity, 'detail', id] as const,
  custom: (businessId: string, ...parts: unknown[]) => ['b', businessId, ...parts] as const,
};

/** Identificador de requisição para idempotência (gerado ao abrir o formulário). */
export function newRequestId(): string {
  return crypto.randomUUID();
}
