import { ExternalLink, History, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { type Column, DataTable } from '@/components/shared/data-table';
import { Freshness } from '@/components/shared/freshness';
import { PeriodPicker, usePeriod } from '@/components/shared/period-picker';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useAuditLogs } from '@/data/audit';
import { useProfiles } from '@/data/settings';
import type { AuditRow } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { formatDateTimeBR } from '@/lib/dates';
import { AuditDetails } from './audit-details';
import { ACTION_OPTIONS, actionTone, describeAction, ENTITY_OPTIONS, entityLink, summarizeAudit, zonedRange } from './audit-format';

export function AuditPage() {
  const { business, can } = useBusiness();
  const [period, setPeriod] = usePeriod('month');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const range = zonedRange(period.from, period.to, business.timezone);
  const audit = useAuditLogs({ ...range, entity: entity || undefined, action: action || undefined });
  const profiles = useProfiles();
  const names = profiles.data ?? {};

  if (!can('audit')) {
    return (
      <Page>
        <PageHeader title="Auditoria" />
        <EmptyState icon={<Lock />} title="Sem acesso à auditoria" description="Seu perfil não permite consultar o histórico de auditoria." />
      </Page>
    );
  }

  const author = (row: AuditRow) => (row.actor_id ? (names[row.actor_id] ?? 'Outro usuário') : 'Administração do sistema');
  const links = audit.data?.links ?? { payments: {}, billPayments: {} };

  const columns: Column<AuditRow>[] = [
    {
      key: 'when',
      header: 'Data e hora',
      cell: (row) => <span className="num whitespace-nowrap">{formatDateTimeBR(row.occurred_at, business.timezone)}</span>,
      sortValue: (row) => row.occurred_at,
      className: 'w-40',
    },
    {
      key: 'action',
      header: 'Operação',
      cell: (row) => {
        const summary = summarizeAudit(row);
        return (
          <div className="min-w-0">
            <Badge tone={actionTone(row.action)}>{describeAction(row)}</Badge>
            {summary ? <p className="mt-1 max-w-md truncate text-xs text-ink-soft">{summary}</p> : null}
          </div>
        );
      },
      sortValue: (row) => describeAction(row),
    },
    { key: 'actor', header: 'Responsável', cell: (row) => author(row), sortValue: (row) => author(row) },
    {
      key: 'details',
      header: 'Detalhes',
      cell: (row) => (
        <details className="group">
          <summary className="cursor-pointer select-none text-xs font-medium text-accent-ink hover:underline">Ver detalhes</summary>
          <div className="mt-2 max-w-xl">
            <AuditDetails details={row.details} timeZone={business.timezone} profiles={names} />
          </div>
        </details>
      ),
    },
    {
      key: 'link',
      header: 'Registro',
      align: 'right',
      cell: (row) => {
        const href = entityLink(row, links);
        return href ? (
          <Link to={href} className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline">
            Abrir <ExternalLink className="size-3" aria-hidden />
          </Link>
        ) : (
          <span className="text-xs text-muted">—</span>
        );
      },
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Auditoria"
        description="Histórico das operações financeiras importantes. É somente leitura: não pode ser alterado nem apagado pela aplicação."
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <PeriodPicker period={period} onChange={setPeriod} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:w-[28rem]">
          <Field label="Tipo de registro">
            <Select value={entity} onChange={(event) => setEntity(event.target.value)}>
              <option value="">Todos</option>
              {ENTITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Operação">
            <Select value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="">Todas</option>
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      <div className="mb-3">
        <Freshness query={audit} />
      </div>
      {audit.isPending ? <LoadingBlock rows={6} /> : null}
      {audit.isError && !audit.data ? <ErrorState error={audit.error} onRetry={() => void audit.refetch()} /> : null}
      {audit.data ? (
        <>
          {audit.data.truncated ? (
            <p className="mb-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
              Mostrando os 1.000 registros mais recentes do período. Reduza o período para ver os demais.
            </p>
          ) : null}
          <DataTable
            rows={audit.data.rows}
            columns={columns}
            getRowId={(row) => String(row.id)}
            caption="Histórico de auditoria"
            searchText={(row) => `${describeAction(row)} ${summarizeAudit(row) ?? ''} ${author(row)} ${JSON.stringify(row.details)}`}
            searchPlaceholder="Pesquisar no histórico…"
            initialSort={{ key: 'when', direction: 'desc' }}
            emptyTitle="Nenhuma operação no período"
            emptyDescription="Altere o período ou os filtros."
            mobileCard={(row) => {
              const href = entityLink(row, links);
              return (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={actionTone(row.action)}>{describeAction(row)}</Badge>
                    <span className="num text-xs text-muted">{formatDateTimeBR(row.occurred_at, business.timezone)}</span>
                  </div>
                  {summarizeAudit(row) ? <p className="text-sm text-ink">{summarizeAudit(row)}</p> : null}
                  <p className="text-xs text-muted">
                    <History className="mr-1 inline size-3" aria-hidden />
                    {author(row)}
                  </p>
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <details className="min-w-0 flex-1">
                      <summary className="cursor-pointer text-xs font-medium text-accent-ink">Ver detalhes</summary>
                      <div className="mt-2">
                        <AuditDetails details={row.details} timeZone={business.timezone} profiles={names} />
                      </div>
                    </details>
                    {href ? (
                      <Link to={href} className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink">
                        Abrir registro <ExternalLink className="size-3" aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            }}
          />
        </>
      ) : null}
    </Page>
  );
}
