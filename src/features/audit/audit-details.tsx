import { ArrowRight } from 'lucide-react';
import { formatBRL, formatQuantity } from '@/lib/money';
import { describeChanges, describeRecord } from './audit-format';

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value.filter((item) => asObject(item)) as Json[]) : [];
}

function Fields({ record, timeZone, profiles }: { record: Json; timeZone: string; profiles: Record<string, string> }) {
  const fields = describeRecord(record, timeZone, profiles);
  if (fields.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.key} className="flex min-w-0 gap-2">
          <dt className="shrink-0 text-muted">{field.label}:</dt>
          <dd className="min-w-0 break-words text-ink">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SaleItems({ items }: { items: Json[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-5">
      {items.map((item, index) => (
        <li key={index} className="num">
          {formatQuantity(Number(item.quantidade ?? 0))}× {String(item.produto ?? '—')} — {formatBRL(Number(item.preco_unitario_cents ?? 0))}
          {Number(item.desconto_cents ?? 0) > 0 ? ` (desconto ${formatBRL(Number(item.desconto_cents))})` : ''}
        </li>
      ))}
    </ul>
  );
}

function PurchaseItems({ items }: { items: Json[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-5">
      {items.map((item, index) => (
        <li key={index} className="num">
          {formatQuantity(Number(item.quantity ?? 0))} {String(item.unit ?? '')} — {String(item.description ?? '—')} a{' '}
          {formatBRL(Number(item.unit_price_cents ?? 0))}
        </li>
      ))}
    </ul>
  );
}

function Snapshot({ value, timeZone, profiles }: { value: Json; timeZone: string; profiles: Record<string, string> }) {
  const purchase = asObject(value.compra);
  if (purchase) {
    return (
      <div>
        <Fields record={purchase} timeZone={timeZone} profiles={profiles} />
        <PurchaseItems items={asArray(value.itens)} />
      </div>
    );
  }
  const { itens, ...header } = value;
  return (
    <div>
      <Fields record={header} timeZone={timeZone} profiles={profiles} />
      <SaleItems items={asArray(itens)} />
    </div>
  );
}

/** Detalhes legíveis de um registro de auditoria. */
export function AuditDetails({ details, timeZone, profiles }: { details: Json; timeZone: string; profiles: Record<string, string> }) {
  const changes = describeChanges(details, timeZone, profiles);
  const before = asObject(details.antes);
  const after = asObject(details.depois);
  const sale = asObject(details.venda);
  const record = asObject(details.registro);

  return (
    <div className="space-y-3 text-xs">
      {changes.length > 0 ? (
        <table className="w-full text-left">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 pr-2 font-medium">Campo</th>
              <th scope="col" className="py-1 pr-2 font-medium">De</th>
              <th scope="col" className="py-1 font-medium">
                <span className="sr-only">Para</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.key} className="border-t border-line align-top">
                <td className="py-1 pr-2 text-muted">{change.label}</td>
                <td className="py-1 pr-2 text-ink-soft line-through decoration-danger/40">{change.from}</td>
                <td className="py-1 text-ink">
                  <span className="inline-flex items-start gap-1">
                    <ArrowRight className="mt-0.5 size-3 shrink-0 text-muted" aria-label="para" />
                    <span className="font-medium">{change.to}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {before && after ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-line p-2">
            <p className="mb-1 font-semibold text-muted">Antes</p>
            <Snapshot value={before} timeZone={timeZone} profiles={profiles} />
          </div>
          <div className="rounded-lg border border-line p-2">
            <p className="mb-1 font-semibold text-muted">Depois</p>
            <Snapshot value={after} timeZone={timeZone} profiles={profiles} />
          </div>
        </div>
      ) : null}
      {sale ? <Snapshot value={sale} timeZone={timeZone} profiles={profiles} /> : null}
      {asObject(details.compra) ? <Snapshot value={details} timeZone={timeZone} profiles={profiles} /> : null}
      {record ? <Fields record={record} timeZone={timeZone} profiles={profiles} /> : null}
      {!changes.length && !before && !sale && !record && !asObject(details.compra) ? <Fields record={details} timeZone={timeZone} profiles={profiles} /> : null}
    </div>
  );
}
