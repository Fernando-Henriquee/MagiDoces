import { Copy, ExternalLink, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { LoadingBlock } from '@/components/ui/states';
import { storefrontUrl, useAccessCodeInfo, useRemoveAccessCode, useSetAccessCode } from '@/data/storefront';
import type { Customer } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { formatDateBR } from '@/lib/dates';
import { whatsappLink } from '@/lib/whatsapp';

/** Código de 4 números para a cliente consultar o que deve no link de compras. */
export function AccessCodeCard({ customer }: { customer: Pick<Customer, 'id' | 'name' | 'phone'> }) {
  const { business, can } = useBusiness();
  const info = useAccessCodeInfo(customer.id);
  const generate = useSetAccessCode();
  const remove = useRemoveAccessCode();
  const [confirm, setConfirm] = useState<'replace' | 'remove' | null>(null);
  const [generated, setGenerated] = useState<{ code: string; message: string } | null>(null);
  const writable = can('write');
  const link = business.storefront_enabled && business.storefront_token ? `${storefrontUrl(business.storefront_token)}/consulta` : null;
  const shopName = business.name.replace(/\s*\(.*\)\s*$/, '');
  const firstName = customer.name.trim().split(/\s+/)[0] ?? customer.name;

  async function create() {
    const code = await generate.mutateAsync({ customerId: customer.id });
    const message = [
      `Olá, ${firstName}! Para consultar suas compras na ${shopName}${link ? `, acesse ${link}` : ''}`,
      `e use seu celular com o código ${code}.`,
      '',
      'Guarde este código: ele é pessoal.',
    ].join('\n');
    setGenerated({ code, message });
  }

  const data = info.data;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted" aria-hidden /> Consulta pelo link
          </span>
        }
        description="Com o celular e um código de 4 números, a cliente vê o que deve no link de compras."
        actions={data?.has_code ? <Badge tone="success">Código ativo</Badge> : data ? <Badge>Sem código</Badge> : null}
      />
      <div className="space-y-3 p-4 text-sm">
        {info.isPending ? <LoadingBlock rows={1} /> : null}
        {data && !data.phone_valid ? <p className="text-ink-soft">Cadastre o celular da cliente (com DDD) para ela poder consultar pelo link.</p> : null}
        {data?.phone_valid ? (
          <>
            <p className="text-ink-soft">
              {data.has_code
                ? `${data.set_by === 'customer' ? 'Criado pela cliente' : 'Gerado pela loja'}${data.updated_at ? ` em ${formatDateBR(data.updated_at.slice(0, 10))}` : ''}. O código não pode ser visto depois de criado; se ela esquecer, gere um novo.`
                : 'A cliente ainda não tem código. Gere um e envie pelo WhatsApp.'}
            </p>
            {data.locked ? (
              <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                Consulta bloqueada por tentativas erradas (libera sozinha em até 15 minutos). Gerar um código novo libera na hora.
              </p>
            ) : null}
            {!business.storefront_enabled ? <p className="text-xs text-muted">O link de compras está desligado: ligue em Configurações para a consulta funcionar.</p> : null}
            {writable ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={data.has_code ? 'outline' : 'primary'} loading={generate.isPending} onClick={() => (data.has_code ? setConfirm('replace') : void create().catch(() => undefined))}>
                  <KeyRound /> {data.has_code ? 'Gerar novo código' : 'Gerar código'}
                </Button>
                {data.has_code ? (
                  <Button size="sm" variant="ghost" onClick={() => setConfirm('remove')}>
                    Remover código
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'replace' ? 'Gerar um novo código?' : 'Remover o código de consulta?'}
        description={
          confirm === 'replace'
            ? 'O código atual deixa de funcionar na hora. Envie o novo para a cliente.'
            : 'A cliente não consegue mais consultar pelo link até receber um código novo.'
        }
        confirmLabel={confirm === 'replace' ? 'Gerar novo código' : 'Remover'}
        tone={confirm === 'replace' ? 'primary' : undefined}
        onConfirm={() => (confirm === 'replace' ? create() : remove.mutateAsync({ customerId: customer.id }))}
      />

      <Dialog open={generated !== null} onOpenChange={(open) => !open && setGenerated(null)}>
        <DialogContent
          title={`Código de ${firstName}`}
          description="Ele aparece só agora. Envie para a cliente; depois não dá para ver de novo."
          footer={
            generated ? (
              <>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(generated.message);
                      toast.success('Mensagem copiada.');
                    } catch {
                      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
                    }
                  }}
                >
                  <Copy /> Copiar mensagem
                </Button>
                {whatsappLink(customer.phone, generated.message) ? (
                  <Button asChild>
                    <a href={whatsappLink(customer.phone, generated.message)!} target="_blank" rel="noopener noreferrer">
                      <ExternalLink /> Enviar no WhatsApp
                    </a>
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          {generated ? (
            <div className="space-y-3">
              <p className="num text-center font-mono text-4xl font-semibold tracking-[0.4em]" aria-label={`Código ${generated.code.split('').join(' ')}`}>
                {generated.code}
              </p>
              <Textarea aria-label="Mensagem para a cliente" readOnly value={generated.message} rows={5} className="text-xs" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
