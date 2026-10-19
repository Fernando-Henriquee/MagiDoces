import { CakeSlice } from 'lucide-react';
import { useState } from 'react';
import { useSignedUrl } from '@/data/storage';
import { cn } from '@/lib/cn';

/** Miniatura da foto do produto (bucket privado, URL assinada); ícone quando não há foto ou sem conexão. */
export function ProductThumb({ path, className }: { path: string | null | undefined; className?: string }) {
  const url = useSignedUrl('product-photos', path);
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn('grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent-soft text-accent-ink', className)} aria-hidden>
      {url.data && !failed ? (
        <img src={url.data} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <CakeSlice className="size-[55%]" />
      )}
    </span>
  );
}
