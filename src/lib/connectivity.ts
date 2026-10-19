import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { env } from './env';
import { OfflineError } from './errors';

/** Estado de conexão do navegador (sinal rápido, não é confirmação). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (callback) => onlineManager.subscribe(callback),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/**
 * Confirma que o servidor está acessível ANTES de gravar dados financeiros.
 * Não existe escrita offline: sem confirmação, a operação é recusada.
 */
export async function ensureOnline(timeoutMs = 5000): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError();
  try {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: env.supabaseAnonKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok && response.status >= 500) throw new OfflineError('O servidor não respondeu. Nada foi gravado — tente novamente em instantes.');
  } catch (error) {
    if (error instanceof OfflineError) throw error;
    throw new OfflineError();
  }
}
