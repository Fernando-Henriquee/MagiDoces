import { ArrowLeft, Pencil, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type Column, DataTable } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/input';
import { ErrorState, Spinner } from '@/components/ui/states';
import { IMPORT_ROW_LIMIT } from '@/data/imports';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import { summarize } from '@/lib/import/build';
import type { CellValue, ColumnMapping, PreviewRow, RowStatus } from '@/lib/import/types';
import { formatBRL, formatQuantity } from '@/lib/money';
import { canIgnore, importableCount, INFERRED_LABELS, rowDisplayStatus, rowSearchText, STATUS_LABELS, STATUS_TONES } from './import-helpers';
import { RowFixDialog } from './row-fix-dialog';

type Filter = 'all' | RowStatus | 'ignored';

interface PreviewStepProps {
  preview: PreviewRow[];
  cellsByRow: Map<number, CellValue[]>;
  columns: ColumnMapping[];
  ignored: Set<number>;
  overrides: Record<number, Record<number, string>>;
  checking: boolean;
  checkError: unknown;
  onRetryCheck: () => void;
  onToggleIgnored: (rowNumber: number, ignore: boolean) => void;
  onOverride: (rowNumber: number, values: Record<number, string>) => void;
  onBack: () => void;
  onConfirm: () => Promise<unknown>;
  confirming: boolean;
  importError: unknown;
}

function paymentText(row: PreviewRow): string {
  const payment = row.sale?.payment;
  if (!payment) return '—';
  switch (payment.status) {
    case 'paid':
      return `Paga${payment.paidOn ? ` em ${formatDateBR(payment.paidOn)}` : ''}`;
    case 'partial':
      return `Parcial: ${formatBRL(payment.amountCents ?? 0)}${payment.paidOn ? ` em ${formatDateBR(payment.paidOn)}` : ''}`;
    case 'unpaid':
      return 'Em aberto';
    default:
      return 'A confirmar';
  }
}

function itemsText(row: PreviewRow): string {
  return row.sale?.items.map((item) => `${formatQuantity(item.quantity)}× ${item.productName}`).join(', ') ?? '';
}

function Messages({ row }: { row: PreviewRow }) {
  if (row.errors.length === 0 && row.warnings.length === 0 && row.inferredFields.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {row.errors.map((message) => (
        <p key={message} className="text-danger">
          {message}
        </p>
      ))}
      {row.warnings.map((message) => (
        <p key={message} className="text-warning">
          {message}
        </p>
      ))}
      {row.inferredFields.length > 0 ? (
        <p className="flex flex-wrap gap-1">
          {row.inferredFields.map((field) => (
            <Badge key={field} tone="accent">
              inferido: {INFERRED_LABELS[field] ?? field}
            </Badge>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function CountTile({ label, value, tone }: { label: string; value: number | string; tone?: 'danger' | 'warning' | 'success' | 'info' }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-panel px-2.5 py-2 sm:px-3">
      <p className="truncate text-xs text-muted">{label}</p>
      <p
        className={cn(
          'num truncate text-base font-semibold sm:text-lg',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'success' && 'text-success',
          tone === 'info' && 'text-info',
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Etapa 4: prévia de todas as linhas, com validação, duplicidades e confirmação. */
export function PreviewStep(props: PreviewStepProps) {
  const { preview, ignored } = props;
  const [filter, setFilter] = useState<Filter>('all');
  const [fixRow, setFixRow] = useState<PreviewRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const summary = useMemo(() => summarize(preview, ignored), [preview, ignored]);
  const toImport = importableCount(preview, ignored);
  const overLimit = preview.length > IMPORT_ROW_LIMIT;
  const ignoredCount = preview.filter((row) => rowDisplayStatus(row, ignored) === 'ignored').length;

  const filtered = filter === 'all' ? preview : preview.filter((row) => rowDisplayStatus(row, ignored) === filter);

  const filters: Array<{ value: Filter; label: string; count: number }> = [
    { value: 'all', label: 'Todas', count: preview.length },
    { value: 'ok', label: 'Prontas', count: summary.ok - preview.filter((r) => r.status === 'ok' && ignored.has(r.rowNumber)).length },
    { value: 'warning', label: 'Com aviso', count: summary.warning - preview.filter((r) => r.status === 'warning' && ignored.has(r.rowNumber)).length },
    { value: 'error', label: 'Com erro', count: summary.error },
    { value: 'duplicate', label: 'Já importadas', count: summary.duplicate - preview.filter((r) => r.status === 'duplicate' && ignored.has(r.rowNumber)).length },
    { value: 'empty', label: 'Vazias', count: summary.empty },
    { value: 'ignored', label: 'Ignoradas', count: ignoredCount },
  ];

  const columns: Column<PreviewRow>[] = [
    { key: 'row', header: 'Linha', cell: (row) => <span className="num text-muted">{row.rowNumber}</span>, sortValue: (row) => row.rowNumber, className: 'w-14' },
    {
      key: 'date',
      header: 'Data',
      cell: (row) => <span className="num whitespace-nowrap">{row.sale ? formatDateBR(row.sale.saleDate) : '—'}</span>,
      sortValue: (row) => row.sale?.saleDate ?? '',
    },
    {
      key: 'customer',
      header: 'Cliente',
      cell: (row) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          {row.sale?.customerName ?? <span className="text-muted">—</span>}
          {row.sale?.isNewCustomer ? <Badge tone="info">novo</Badge> : null}
        </span>
      ),
      sortValue: (row) => row.sale?.customerName ?? '',
    },
    { key: 'items', header: 'Itens', cell: (row) => <span className="text-xs">{itemsText(row) || '—'}</span> },
    { key: 'total', header: 'Total', align: 'right', cell: (row) => (row.sale ? <Money cents={row.sale.totalCents} /> : '—'), sortValue: (row) => row.sale?.totalCents ?? -1 },
    { key: 'payment', header: 'Pagamento', cell: (row) => <span className="text-xs">{paymentText(row)}</span> },
    {
      key: 'status',
      header: 'Situação',
      cell: (row) => {
        const status = rowDisplayStatus(row, ignored);
        return (
          <div className="min-w-48">
            <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
            <Messages row={row} />
          </div>
        );
      },
      sortValue: (row) => rowDisplayStatus(row, ignored),
    },
    {
      key: 'actions',
      header: 'Ações',
      align: 'right',
      cell: (row) => renderActions(row),
    },
  ];

  function renderActions(row: PreviewRow) {
    return (
      <div className="flex items-center justify-end gap-2">
        {canIgnore(row) ? (
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <Checkbox checked={!ignored.has(row.rowNumber)} onChange={(event) => props.onToggleIgnored(row.rowNumber, !event.target.checked)} />
            Incluir
          </label>
        ) : null}
        {row.status !== 'empty' ? (
          <Button variant="ghost" size="sm" onClick={() => setFixRow(row)} aria-label={`Corrigir linha ${row.rowNumber}`}>
            <Pencil /> Corrigir
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <CountTile label="Linhas" value={summary.total} />
        <CountTile label="Prontas" value={summary.ok} tone="success" />
        <CountTile label="Com aviso" value={summary.warning} tone={summary.warning ? 'warning' : undefined} />
        <CountTile label="Com erro" value={summary.error} tone={summary.error ? 'danger' : undefined} />
        <CountTile label="Vazias" value={summary.empty} />
        <CountTile label="Já importadas" value={summary.duplicate} tone={summary.duplicate ? 'info' : undefined} />
        <CountTile label="Com inferência" value={summary.inferred} />
        <CountTile label="Valor a importar" value={formatBRL(summary.totalCents)} />
      </div>

      {summary.newCustomers.length > 0 ? (
        <details className="rounded-lg border border-line bg-panel px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">
            {summary.newCustomers.length} {summary.newCustomers.length === 1 ? 'cliente novo será cadastrado' : 'clientes novos serão cadastrados'}
          </summary>
          <p className="mt-2 text-xs text-ink-soft">{summary.newCustomers.join(', ')}</p>
        </details>
      ) : null}

      {props.checking ? <Spinner label="Verificando linhas já importadas…" /> : null}
      {props.checkError ? <ErrorState error={props.checkError} onRetry={props.onRetryCheck} /> : null}
      {overLimit ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />A planilha tem {preview.length.toLocaleString('pt-BR')} linhas. O limite por
          importação é de {IMPORT_ROW_LIMIT.toLocaleString('pt-BR')}. Divida o arquivo e importe em partes.
        </p>
      ) : null}

      <div role="radiogroup" aria-label="Filtrar linhas" className="flex flex-wrap gap-1.5">
        {filters.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium',
              filter === option.value ? 'border-brand bg-brand text-brand-fg' : 'border-line-strong bg-panel text-ink-soft hover:bg-subtle',
            )}
          >
            {option.label} <span className="num opacity-80">({option.count})</span>
          </button>
        ))}
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        getRowId={(row) => String(row.rowNumber)}
        caption="Prévia da importação"
        searchText={rowSearchText}
        searchPlaceholder="Pesquisar nas linhas…"
        pageSize={100}
        emptyTitle="Nenhuma linha neste filtro"
        rowClassName={(row) => (rowDisplayStatus(row, ignored) === 'ignored' ? 'opacity-60' : undefined)}
        mobileCard={(row) => {
          const status = rowDisplayStatus(row, ignored);
          return (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Linha {row.rowNumber}</span>
                <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
              </div>
              {row.sale ? (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.sale.customerName ?? 'Sem cliente'}</p>
                    <p className="text-xs text-muted">
                      {formatDateBR(row.sale.saleDate)} · {itemsText(row)}
                    </p>
                    <p className="text-xs text-ink-soft">{paymentText(row)}</p>
                  </div>
                  <Money cents={row.sale.totalCents} className="text-sm font-semibold" />
                </div>
              ) : null}
              <Messages row={row} />
              {renderActions(row)}
            </div>
          );
        }}
      />

      {props.importError ? <ErrorState error={props.importError} /> : null}

      <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-line bg-panel/95 p-3 shadow-[var(--shadow-pop)] backdrop-blur lg:bottom-4">
        <Button variant="outline" onClick={props.onBack} disabled={props.confirming}>
          <ArrowLeft /> Ajustar mapeamento
        </Button>
        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={toImport === 0 || overLimit || props.checking || Boolean(props.checkError) || props.confirming}
          loading={props.confirming}
        >
          <ShieldCheck /> Importar {toImport} {toImport === 1 ? 'venda' : 'vendas'}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="primary"
        title={`Importar ${toImport} ${toImport === 1 ? 'venda' : 'vendas'}?`}
        description={
          <>
            Total de {formatBRL(summary.totalCents)}
            {summary.newCustomers.length ? `, com ${summary.newCustomers.length} ${summary.newCustomers.length === 1 ? 'cliente novo' : 'clientes novos'}` : ''}. As
            linhas com erro, vazias, ignoradas e já importadas ficam registradas no relatório do lote, sem gerar vendas. A importação é feita de
            uma vez: se algo falhar, nada é gravado.
          </>
        }
        confirmLabel="Importar agora"
        onConfirm={async () => {
          await props.onConfirm().catch(() => undefined);
        }}
      />

      {fixRow ? (
        <RowFixDialog
          key={fixRow.rowNumber}
          row={fixRow}
          cells={props.cellsByRow.get(fixRow.rowNumber) ?? []}
          columns={props.columns}
          overrides={props.overrides[fixRow.rowNumber]}
          onOpenChange={(open) => !open && setFixRow(null)}
          onSave={(values) => props.onOverride(fixRow.rowNumber, values)}
        />
      ) : null}
    </div>
  );
}
