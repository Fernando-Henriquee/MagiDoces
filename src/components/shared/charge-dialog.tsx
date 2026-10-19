import { Copy, ExternalLink, MessageCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { useBusiness } from '@/features/business/business-context';
import type { CustomerGroup } from '@/lib/receivables';
import { buildChargeMessage, whatsappLink } from '@/lib/whatsapp';

/** Resumo de cobrança copiável/enviável pelo WhatsApp (editável antes de enviar). */
export function ChargeButton({ group, size = 'sm', label = 'Cobrar' }: { group: CustomerGroup; size?: 'sm' | 'md'; label?: string }) {
  const { business } = useBusiness();
  const [open, setOpen] = useState(false);
  const initial = useMemo(
    () => buildChargeMessage(group, { businessName: business.name.replace(/\s*\(.*\)\s*$/, ''), pixKey: business.pix_key, footer: business.charge_message_footer }),
    [group, business],
  );
  const [text, setText] = useState(initial);
  const link = whatsappLink(group.customerPhone, text);

  return (
    <>
      <Button
        size={size}
        variant="outline"
        onClick={() => {
          setText(initial);
          setOpen(true);
        }}
      >
        <MessageCircle /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Cobrança — ${group.customerName}`}
          description="Revise o texto antes de enviar."
          footer={
            <>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text);
                    toast.success('Resumo copiado. Cole no WhatsApp.');
                  } catch {
                    toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
                  }
                }}
              >
                <Copy /> Copiar
              </Button>
              {link ? (
                <Button asChild>
                  <a href={link} target="_blank" rel="noopener noreferrer">
                    <ExternalLink /> Abrir no WhatsApp
                  </a>
                </Button>
              ) : null}
            </>
          }
        >
          <Textarea aria-label="Texto da cobrança" value={text} onChange={(e) => setText(e.target.value)} rows={14} className="font-mono text-xs leading-relaxed" />
          {!link ? <p className="mt-2 text-xs text-muted">Cliente sem telefone válido: copie o texto e envie manualmente.</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
