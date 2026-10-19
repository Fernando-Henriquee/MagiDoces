import { type QueryKey, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useBusiness } from '@/features/business/business-context';
import { ensureOnline } from '@/lib/connectivity';
import { describeError } from '@/lib/errors';

export function useBusinessId(): string {
  return useBusiness().business.id;
}

/** Consulta escopada ao negócio atual (chave começa com ['b', businessId]). */
export function useBusinessQuery<T>(
  key: unknown[],
  queryFn: (businessId: string) => Promise<T>,
  options?: Omit<UseQueryOptions<T, Error, T, QueryKey>, 'queryKey' | 'queryFn'>,
) {
  const businessId = useBusinessId();
  return useQuery<T, Error, T, QueryKey>({ queryKey: ['b', businessId, ...key], queryFn: () => queryFn(businessId), ...options });
}

interface WriteOptions<TVars, TResult> {
  mutationFn: (vars: TVars, businessId: string) => Promise<TResult>;
  success?: string | ((result: TResult, vars: TVars) => string);
  onSuccess?: (result: TResult, vars: TVars) => void;
  /** Mostra toast de erro automaticamente (padrão: true). */
  toastError?: boolean;
}

/**
 * Escrita confirmada: verifica a conexão com o servidor ANTES de gravar, nunca
 * enfileira para depois, invalida os dados do negócio e mostra o resultado.
 */
export function useWrite<TVars = void, TResult = unknown>({ mutationFn, success, onSuccess, toastError = true }: WriteOptions<TVars, TResult>) {
  const queryClient = useQueryClient();
  const businessId = useBusinessId();
  return useMutation<TResult, Error, TVars>({
    mutationFn: async (vars) => {
      await ensureOnline();
      return mutationFn(vars, businessId);
    },
    onSuccess: async (result, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['b', businessId] });
      if (success) toast.success(typeof success === 'function' ? success(result, vars) : success);
      onSuccess?.(result, vars);
    },
    onError: (error) => {
      if (toastError) toast.error(describeError(error));
    },
  });
}
