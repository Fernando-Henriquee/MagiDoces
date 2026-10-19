import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useImportBatch } from '@/data/imports';
import { useProfiles } from '@/data/settings';
import type { ImportRowRecord } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { formatDateTimeBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { LAYOUT_LABELS } from './batches-page';
import { INFERRED_LABELS } from './import-helpers';

const ROW_STATUS: Record<ImportRowRecord['status'], { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' }> = {
  imported: { label: 'Importada', tone: 'success' },
  duplicate: { label: 'Duplicada', tone: 'info' },
  ignored: { label: 'Ignorada', tone: 'neutral' },
  invalid: { label: 'Inválida', tone: 'danger' },
};

function rawSummary(raw: Record<string, string>): string {
  return Object.entries(raw)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ');
}

const EXPORT_COLUMNS: ExportColumn<ImportRowRecord>[] = [
  { header: 'Linha', value: (r) => r.row_number, kind: 'number' },
  { header: 'Situação', value: (r) => ROW_STATUS[r.status].label },
  { header: 'Mensagens', value: (r) => r.messages.join(' | ') },
  { header: 'Valores inferidos', value: (r) => r.inferred_fields.map((f) => INFERRED_LABELS[f] ?? f).join(', ') },
  { header: 'Venda', value: (r) => r.sale_id ?? '' },
  { header: 'Conteúdo original', value: (r) => rawSummary(r.raw) },
];

/** Relatório de um lote de importação, linha a linha. */
export function BatchDetailPage() {
  const { id } = useParams();
  const { business } = useBusiness();
  const query = useImportBatch(id);
  const profiles = useProfiles();
  const [status, setStatus] = useState<'' | ImportRowRecord['status']>('');

  if (query.isPending) {
    return (
      <Page>
        <LoadingBlock rows={6} />
      </Page>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Page>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Page>
    );
  }

  const { batch, rows } = query.data;
  const visible = status ? rows.filter((row) => row.status === status) : rows;
  const author = batch.created_by ? (profiles.data?.[batch.created_by] ?? 'Outro usuário') : '—';

  const columns: Column<ImportRowRecord>[] = [
    { key: 'row', header: 'Linha', cell: (r) => <span className="num">{r.row_number}</span>, sortValue: (r) => r.row_number, className: 'w-16' },
    { key: 'status', header: 'Situação', cell: (r) => <Badge tone={ROW_STATUS[r.status].tone}>{ROW_STATUS[r.status].label}</Badge>, sortValue: (r) => r.status },
    {
      key: 'messages',
      header: 'Mensagens',
      cell: (r) => (
        <div className="space-y-0.5 text-xs">
          {r.messages.length ? r.messages.map((message) => <p key={message}>{message}</p>) : <span className="text-muted">—</span>}
          {r.inferred_fields.length ? (
            <p className="flex flex-wrap gap-1">
              {r.inferred_fields.map((field) => (
                <Badge key={field} tone="accent">
                  inferido: {INFERRED_LABELS[field] ?? field}
                </Badge>
              ))}
            </p>
          ) : null}
        </div>
      ),
    },
    { key: 'raw', header: 'Conteúdo original', cell: (r) => <span className="block max-w-md truncate text-xs text-muted">{rawSummary(r.raw)}</span> },
    {
      key: 'sale',
      header: 'Venda',
      align: 'right',
      cell: (r) =>
        r.sale_id ? (
          <Link to={`/vendas/${r.sale_id}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline">
            Abrir <ExternalLink className="size-3" aria-hidden />
          </Link>
        ) : (
          <span className="text-xs text-muted">—</span>
        ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Relatório da importação"
        description={batch.file_name}
        back={
          <Link to="/importar/lotes" className="text-sm text-accent-ink hover:underline">
            ← Importações anteriores
          </Link>
        }
        actions={<ExportMenu rows={visible} columns={EXPORT_COLUMNS} fileName={`importacao-${batch.created_at.slice(0, 10)}`} />}
      />
      <Card className="mb-4">
        <CardHeader title="Lote" description={`${formatDateTimeBR(batch.created_at, business.timezone)} · por ${author}`} />
        <dl className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">Aba</dt>
            <dd className="font-medium">{batch.sheet_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Formato</dt>
            <dd className="font-medium">{LAYOUT_LABELS[batch.layout]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Linhas</dt>
            <dd className="num font-medium">{batch.total_rows}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Importadas</dt>
            <dd className="num font-medium text-success">{batch.imported_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Duplicadas</dt>
            <dd className="num font-medium">{batch.duplicate_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Ignoradas</dt>
            <dd className="num font-medium">{batch.ignored_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Inválidas</dt>
            <dd className="num font-medium text-danger">{batch.invalid_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Clientes criados</dt>
            <dd className="num font-medium">{batch.created_customers_count}</dd>
          </div>
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-muted">Impressão digital do arquivo (SHA-256)</dt>
            <dd className="num break-all text-xs text-ink-soft">{batch.file_sha256}</dd>
          </div>
        </dl>
      </Card>
      <DataTable
        rows={visible}
        columns={columns}
        getRowId={(r) => String(r.id)}
        caption="Linhas do lote"
        searchText={(r) => `${r.row_number} ${r.messages.join(' ')} ${rawSummary(r.raw)}`}
        searchPlaceholder="Pesquisar nas linhas…"
        pageSize={100}
        toolbar={
          <Select aria-label="Filtrar por situação" className="sm:w-48" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="">Todas as situações</option>
            {Object.entries(ROW_STATUS).map(([value, info]) => (
              <option key={value} value={value}>
                {info.label}
              </option>
            ))}
          </Select>
        }
        emptyTitle="Nenhuma linha nesta situação"
        mobileCard={(r) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">Linha {r.row_number}</span>
              <Badge tone={ROW_STATUS[r.status].tone}>{ROW_STATUS[r.status].label}</Badge>
            </div>
            {r.messages.map((message) => (
              <p key={message} className="text-xs text-ink-soft">
                {message}
              </p>
            ))}
            <p className="truncate text-xs text-muted">{rawSummary(r.raw)}</p>
            {r.sale_id ? (
              <Link to={`/vendas/${r.sale_id}`} className="text-xs font-medium text-accent-ink">
                Abrir venda
              </Link>
            ) : null}
          </div>
        )}
      />
    </Page>
  );
}
