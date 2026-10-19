import { FileSpreadsheet, Upload } from 'lucide-react';
import { Link } from 'react-router';
import { type Column, DataTable } from '@/components/shared/data-table';
import { Freshness } from '@/components/shared/freshness';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useImportBatches } from '@/data/imports';
import { useProfiles } from '@/data/settings';
import type { ImportBatchRow } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { formatDateTimeBR } from '@/lib/dates';

export const LAYOUT_LABELS = { wide: 'Uma coluna por produto', long: 'Uma linha por item' } as const;

/** Histórico de importações (lotes). */
export function BatchesPage() {
  const { business, can } = useBusiness();
  const batches = useImportBatches();
  const profiles = useProfiles();
  const names = profiles.data ?? {};
  const author = (batch: ImportBatchRow) => (batch.created_by ? (names[batch.created_by] ?? 'Outro usuário') : '—');

  const columns: Column<ImportBatchRow>[] = [
    { key: 'file', header: 'Arquivo', cell: (b) => b.file_name, sortValue: (b) => b.file_name },
    {
      key: 'date',
      header: 'Data',
      cell: (b) => <span className="num whitespace-nowrap">{formatDateTimeBR(b.created_at, business.timezone)}</span>,
      sortValue: (b) => b.created_at,
    },
    { key: 'by', header: 'Por', cell: author, sortValue: author },
    { key: 'rows', header: 'Linhas', align: 'right', cell: (b) => <span className="num">{b.total_rows}</span>, sortValue: (b) => b.total_rows },
    { key: 'imported', header: 'Importadas', align: 'right', cell: (b) => <span className="num font-medium text-success">{b.imported_count}</span>, sortValue: (b) => b.imported_count },
    { key: 'dup', header: 'Duplicadas', align: 'right', cell: (b) => <span className="num">{b.duplicate_count}</span>, sortValue: (b) => b.duplicate_count },
    { key: 'ignored', header: 'Ignoradas', align: 'right', cell: (b) => <span className="num">{b.ignored_count}</span>, sortValue: (b) => b.ignored_count },
    {
      key: 'invalid',
      header: 'Inválidas',
      align: 'right',
      cell: (b) => <span className={b.invalid_count ? 'num font-medium text-danger' : 'num'}>{b.invalid_count}</span>,
      sortValue: (b) => b.invalid_count,
    },
    { key: 'customers', header: 'Clientes novos', align: 'right', cell: (b) => <span className="num">{b.created_customers_count}</span>, sortValue: (b) => b.created_customers_count },
  ];

  return (
    <Page>
      <PageHeader
        title="Importações anteriores"
        description="Cada processamento de planilha fica registrado com arquivo, responsável e resultado."
        back={
          <Link to="/importar" className="text-sm text-accent-ink hover:underline">
            ← Importar planilha
          </Link>
        }
        actions={
          can('import') ? (
            <Button asChild size="sm">
              <Link to="/importar">
                <Upload /> Nova importação
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-3">
        <Freshness query={batches} />
      </div>
      {batches.isPending ? <LoadingBlock rows={4} /> : null}
      {batches.isError && !batches.data ? <ErrorState error={batches.error} onRetry={() => void batches.refetch()} /> : null}
      {batches.data ? (
        <DataTable
          rows={batches.data}
          columns={columns}
          getRowId={(b) => b.id}
          rowHref={(b) => `/importar/lotes/${b.id}`}
          caption="Importações anteriores"
          searchText={(b) => `${b.file_name} ${b.sheet_name ?? ''} ${author(b)}`}
          searchPlaceholder="Pesquisar por arquivo…"
          initialSort={{ key: 'date', direction: 'desc' }}
          emptyTitle="Nenhuma importação ainda"
          emptyDescription="Quando você importar a planilha antiga, o relatório aparece aqui."
          mobileCard={(b) => (
            <div className="space-y-1">
              <p className="flex items-center gap-2 truncate text-sm font-medium">
                <FileSpreadsheet className="size-4 shrink-0 text-accent-ink" aria-hidden />
                {b.file_name}
              </p>
              <p className="text-xs text-muted">
                {formatDateTimeBR(b.created_at, business.timezone)} · {author(b)}
              </p>
              <div className="flex flex-wrap gap-1">
                <Badge tone="success">{b.imported_count} importadas</Badge>
                {b.duplicate_count ? <Badge tone="info">{b.duplicate_count} duplicadas</Badge> : null}
                {b.invalid_count ? <Badge tone="danger">{b.invalid_count} inválidas</Badge> : null}
                {b.ignored_count ? <Badge>{b.ignored_count} ignoradas</Badge> : null}
              </div>
            </div>
          )}
        />
      ) : null}
    </Page>
  );
}
