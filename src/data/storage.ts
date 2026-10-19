import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Arquivos em buckets PRIVADOS do Supabase Storage, sob "<business_id>/...".
 * A RLS de storage.objects garante que só membros do negócio leem/gravam.
 */

export type Bucket = 'product-photos' | 'receipts';

export const BUCKET_RULES: Record<Bucket, { maxBytes: number; types: string[]; label: string }> = {
  'product-photos': { maxBytes: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'], label: 'JPG, PNG ou WebP até 5 MB' },
  receipts: { maxBytes: 10 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], label: 'PDF, JPG, PNG ou WebP até 10 MB' },
};

export function validateFile(bucket: Bucket, file: File): string | null {
  const rule = BUCKET_RULES[bucket];
  if (!rule.types.includes(file.type)) return `Formato não aceito. Use ${rule.label}.`;
  if (file.size > rule.maxBytes) return `Arquivo grande demais. Use ${rule.label}.`;
  return null;
}

function extension(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1] ?? 'bin';
}

/** Envia o arquivo e devolve o caminho salvo (para gravar no registro). */
export async function uploadFile(bucket: Bucket, businessId: string, file: File): Promise<string> {
  const problem = validateFile(bucket, file);
  if (problem) throw new Error(problem);
  const path = `${businessId}/${crypto.randomUUID()}.${extension(file)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

export async function removeFile(bucket: Bucket, path: string): Promise<void> {
  await supabase.storage.from(bucket).remove([path]);
}

/** URL assinada de curta duração (o bucket é privado). */
export function useSignedUrl(bucket: Bucket, path: string | null | undefined) {
  return useQuery({
    queryKey: ['signed-url', bucket, path],
    enabled: Boolean(path),
    staleTime: 4 * 60 * 1000,
    meta: { persist: false },
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path!, 300);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
