import { Info } from 'lucide-react';
import { Link } from 'react-router';
import { useBatchesWithHash } from '@/data/imports';
import { formatDateBR } from '@/lib/dates';

/** Aviso quando o mesmo arquivo (mesmo SHA-256) já foi processado antes. */
export function AlreadyImportedNotice({ sha256 }: { sha256: string }) {
  const batches = useBatchesWithHash(sha256);
  const previous = batches.data ?? [];
  if (previous.length === 0) return null;
  const last = previous[0]!;
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        Este arquivo já foi importado em <strong>{formatDateBR(last.created_at.slice(0, 10))}</strong>
        {previous.length > 1 ? ` (e outras ${previous.length - 1} vezes)` : ''}. Linhas iguais serão marcadas como duplicadas — nada será
        duplicado.{' '}
        <Link to={`/importar/lotes/${last.id}`} className="font-medium underline-offset-2 hover:underline">
          Ver o lote anterior
        </Link>
      </p>
    </div>
  );
}
