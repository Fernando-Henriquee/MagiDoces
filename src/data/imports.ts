import type { RpcImportRow } from '@/lib/import/build';
import { supabase } from '@/lib/supabase';
import { rpc, unwrap } from './api';
import { useBusinessQuery, useWrite } from './hooks';
import type { ImportBatchRow, ImportRowRecord } from './types';

/** Resultado devolvido pela RPC import_sales_batch. */
export interface ImportResult {
  batch_id: string;
  total_rows: number;
  imported: number;
  duplicates: number;
  ignored: number;
  invalid: number;
  created_customers: number;
  inferred: number;
}

export interface ImportBatchPayload {
  file_name: string;
  file_sha256: string;
  file_size_bytes: number;
  sheet_name: string;
  layout: 'long' | 'wide';
  mapping: unknown;
  rules: unknown;
}

/** Limite de linhas por importação (o mesmo validado pela RPC). */
export const IMPORT_ROW_LIMIT = 5000;
const FINGERPRINT_CHUNK = 500;

export function useImportBatches() {
  return useBusinessQuery(['imports', 'batches'], (businessId) =>
    unwrap<ImportBatchRow[]>(
      supabase.from('import_batches').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
    ),
  );
}

export function useImportBatch(batchId: string | undefined) {
  return useBusinessQuery(
    ['imports', 'batch', batchId],
    async () => {
      const [batch, rows] = await Promise.all([
        unwrap<ImportBatchRow>(supabase.from('import_batches').select('*').eq('id', batchId!).single()),
        unwrap<ImportRowRecord[]>(supabase.from('import_rows').select('*').eq('batch_id', batchId!).order('row_number')),
      ]);
      return { batch, rows };
    },
    { enabled: Boolean(batchId) },
  );
}

export type BatchSummary = Pick<ImportBatchRow, 'id' | 'created_at' | 'file_name' | 'imported_count'>;

/** Lotes já processados com o mesmo arquivo (mesmo SHA-256). */
export function useBatchesWithHash(sha256: string | null) {
  return useBusinessQuery(
    ['imports', 'by-hash', sha256],
    (businessId) =>
      unwrap<BatchSummary[]>(
        supabase
          .from('import_batches')
          .select('id,created_at,file_name,imported_count')
          .eq('business_id', businessId)
          .eq('file_sha256', sha256!)
          .order('created_at', { ascending: false }),
      ),
    { enabled: Boolean(sha256), meta: { persist: false } },
  );
}

/** Divide uma lista em lotes de tamanho fixo. */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/** Impressões digitais que já existem no banco (consultadas em lotes de 500). */
export async function fetchExistingFingerprints(businessId: string, fingerprints: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk([...new Set(fingerprints)], FINGERPRINT_CHUNK)) {
    const rows = await rpc<Array<{ fingerprint: string }> | null>('import_existing_fingerprints', {
      p_business_id: businessId,
      p_fingerprints: part,
    });
    for (const row of rows ?? []) found.add(row.fingerprint);
  }
  return found;
}

export function useExistingFingerprints(fingerprints: string[], key: string, enabled: boolean) {
  return useBusinessQuery(['imports', 'existing', key], (businessId) => fetchExistingFingerprints(businessId, fingerprints), {
    enabled: enabled && fingerprints.length > 0,
    meta: { persist: false },
    staleTime: 0,
  });
}

/** Importação transacional: qualquer erro desfaz o lote inteiro. */
export function useRunImport() {
  return useWrite<{ batch: ImportBatchPayload; rows: RpcImportRow[] }, ImportResult>({
    mutationFn: ({ batch, rows }, businessId) =>
      rpc<ImportResult>('import_sales_batch', { p_business_id: businessId, p_batch: batch, p_rows: rows }),
    success: (result) => `Importação concluída: ${result.imported} ${result.imported === 1 ? 'venda importada' : 'vendas importadas'}.`,
  });
}
