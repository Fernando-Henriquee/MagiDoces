import { useMutation } from '@tanstack/react-query';
import { KeyRound, LogOut, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useParams } from 'react-router';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { fetchStatement, type StatementResult, type Storefront, useStorefront } from '@/data/storefront';
import { formatDateBR } from '@/lib/dates';
import { formatPhoneBR, normalizePhoneBR } from '@/lib/whatsapp';
import { PixPayment } from './pix-payment';
import { StorefrontLayout, StorefrontUnavailable } from './storefront-layout';

type Ok = Extract<StatementResult, { status: 'ok' }>;

export function StatementPage() {
  const { token = '' } = useParams();
  const storefront = useStorefront(token);
  const [result, setResult] = useState<Ok | null>(null);

  if (storefront.isPending) {
    return (
      <StorefrontLayout>
        <LoadingBlock rows={3} />
      </StorefrontLayout>
    );
  }
  if (storefront.isError) {
    return (
      <StorefrontLayout>
        <ErrorState error={storefront.error} onRetry={() => void storefront.refetch()} />
      </StorefrontLayout>
    );
  }
  if (!storefront.data) return <StorefrontUnavailable />;

  return (
    <StorefrontLayout businessName={storefront.data.business_name}>
      {result ? (
        <StatementView storefront={storefront.data} result={result} onExit={() => setResult(null)} />
      ) : (
        <LookupForm token={token} storefront={storefront.data} onFound={setResult} />
      )}
    </StorefrontLayout>
  );
}

function LookupForm({ token, storefront, onFound }: { token: string; storefront: Storefront; onFound: (result: Ok) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const lookup = useMutation({
    mutationFn: () => fetchStatement(token, phone, code),
    onSuccess: (result) => {
      if (result.status === 'ok') {
        onFound(result);
        return;
      }
      setCode('');
      if (result.status === 'invalid') {
        setMessage(
          result.attempts_left > 0
            ? `Celular ou código incorretos. ${result.attempts_left === 1 ? 'Resta 1 tentativa' : `Restam ${result.attempts_left} tentativas`} antes de um bloqueio de 15 minutos.`
            : 'Celular ou código incorretos. A consulta deste celular ficou bloqueada por 15 minutos.',
        );
      } else if (result.status === 'locked') {
        setMessage(`Muitas tentativas. Tente de novo em ${result.retry_minutes} minutos ou peça um novo código à ${storefront.business_name}.`);
      } else if (result.status === 'unavailable') {
        setMessage('Este link de compras não está mais disponível. Peça o link atualizado à loja.');
      } else {
        setMessage('Confira o celular (com DDD) e o código de 4 números.');
      }
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!normalizePhoneBR(phone) || !/^\d{4}$/.test(code)) {
      setMessage('Confira o celular (com DDD) e o código de 4 números.');
      return;
    }
    setMessage(null);
    lookup.mutate();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Quanto eu devo?</h1>
        <p className="mt-1 text-sm text-muted">Informe o celular usado nas compras e seu código de consulta de 4 números.</p>
      </div>
      <Card>
        <form onSubmit={onSubmit} noValidate className="space-y-4 p-4">
          <Field label="Seu celular (WhatsApp)" required>
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(11) 98765-4321"
              maxLength={20}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setPhone((value) => (normalizePhoneBR(value) ? formatPhoneBR(value) : value))}
            />
          </Field>
          <Field label="Código de consulta" required hint="Os 4 números que você criou na primeira compra ou recebeu da loja.">
            <Input
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="••••"
              className="num text-center text-lg tracking-[0.5em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </Field>
          {message ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {message}
            </p>
          ) : null}
          {lookup.isError ? <ErrorState error={lookup.error} /> : null}
          <Button type="submit" size="lg" className="w-full" loading={lookup.isPending}>
            <Search /> Consultar
          </Button>
        </form>
      </Card>
      <p className="flex items-start gap-2 text-sm text-muted">
        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        Não tem ou esqueceu o código? Peça um novo à {storefront.business_name} pelo WhatsApp.
      </p>
    </div>
  );
}

function StatementView({ storefront, result, onExit }: { storefront: Storefront; result: Ok; onExit: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Olá{result.customer_first_name ? `, ${result.customer_first_name}` : ''}!</h1>
          <p className="mt-1 text-sm text-muted">Suas compras em aberto na {storefront.business_name}.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onExit}>
          <LogOut /> Sair
        </Button>
      </div>

      <Card className="p-4">
        <p className="text-sm text-muted">Total em aberto</p>
        <Money cents={result.balance_cents} className="block text-3xl font-semibold" />
        {result.overdue_cents > 0 ? (
          <p className="mt-1 text-sm font-medium text-danger">
            <Money cents={result.overdue_cents} /> já venceram.
          </p>
        ) : null}
      </Card>

      {result.sales.length === 0 ? (
        <p className="rounded-lg bg-success-soft px-3 py-3 text-center text-sm text-success">Você não tem compras em aberto. Obrigada!</p>
      ) : (
        <Card>
          <CardHeader title="Compras em aberto" />
          <ul className="divide-y divide-line">
            {result.sales.map((sale, index) => (
              <li key={`${sale.sale_date}-${index}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{formatDateBR(sale.sale_date)}</p>
                    <p className="text-xs text-muted">{sale.items_summary}</p>
                  </div>
                  <Money cents={sale.balance_cents} className="font-semibold" />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {sale.due_date ? (
                    sale.is_overdue ? <Badge tone="danger">venceu em {formatDateBR(sale.due_date)}</Badge> : <span>vence em {formatDateBR(sale.due_date)}</span>
                  ) : null}
                  {sale.paid_cents > 0 ? (
                    <span>
                      de <Money cents={sale.total_cents} />, já pago <Money cents={sale.paid_cents} />
                    </span>
                  ) : null}
                  {sale.reported_paid ? <Badge tone="info">você avisou que pagou</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {result.pix && result.balance_cents > 0 ? <PixPayment pix={result.pix} amountCents={result.balance_cents} /> : null}
      {result.balance_cents > 0 ? (
        <p className="text-xs text-muted">Depois de pagar, a loja confere e dá baixa. Pagamentos podem levar um tempo para aparecer aqui.</p>
      ) : null}
    </div>
  );
}
