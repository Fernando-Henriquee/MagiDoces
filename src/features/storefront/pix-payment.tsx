import { Check, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { QrCode } from '@/components/shared/qr-code';
import { Button } from '@/components/ui/button';
import type { StorefrontPix } from '@/data/storefront';
import { formatBRL } from '@/lib/money';
import { buildPixPayload } from '@/lib/pix';

/** PIX com valor: "copia e cola" (principal no celular), QR code e a chave. */
export function PixPayment({ pix, amountCents }: { pix: StorefrontPix; amountCents: number }) {
  // Chave fora do padrão (ex.: longa demais) não derruba a página: sobra a chave para copiar.
  const payload = useMemo(() => {
    try {
      return buildPixPayload({ key: pix.key, name: pix.name, city: pix.city, amountCents });
    } catch {
      return null;
    }
  }, [pix, amountCents]);
  const [copied, setCopied] = useState<'code' | 'key' | null>(null);

  async function copy(text: string, what: 'code' | 'key') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      toast.success(what === 'code' ? 'Código PIX copiado. Cole no app do seu banco.' : 'Chave PIX copiada.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  }

  return (
    <section aria-labelledby="pix-title" className="rounded-[var(--radius-card)] border border-line bg-panel p-4 shadow-[var(--shadow-card)]">
      <h2 id="pix-title" className="font-sans text-base font-semibold">
        Pagar com PIX
      </h2>
      <p className="mt-1 text-sm text-muted">
        Valor: <span className="num text-lg font-semibold text-ink">{formatBRL(amountCents)}</span>
      </p>
      {payload ? (
        <>
          <Button className="mt-3 w-full" size="lg" onClick={() => void copy(payload, 'code')}>
            {copied === 'code' ? <Check /> : <Copy />} Copiar código PIX (copia e cola)
          </Button>
          <p className="mt-2 text-xs text-muted">No app do seu banco, escolha Pix → “Pix copia e cola” e cole o código. O valor já vem preenchido.</p>

          <div className="mt-4 flex flex-col items-center gap-2 border-t border-line pt-4">
            <QrCode value={payload} label={`QR code PIX de ${formatBRL(amountCents)}`} className="size-52 rounded-lg" />
            <p className="text-xs text-muted">Ou leia o QR code com o app do banco em outro aparelho.</p>
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">Copie a chave abaixo e faça o PIX no app do seu banco com o valor acima.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-subtle px-3 py-2 text-sm">
        <span className="min-w-0">
          Chave PIX: <strong className="break-all">{pix.key}</strong>
        </span>
        <Button variant="ghost" size="sm" onClick={() => void copy(pix.key, 'key')}>
          {copied === 'key' ? <Check /> : <Copy />} Copiar chave
        </Button>
      </div>
      {payload ? (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer select-none py-1">Ver o código PIX</summary>
          <p className="mt-1 break-all rounded-md bg-subtle p-2 font-mono">{payload}</p>
        </details>
      ) : null}
    </section>
  );
}
