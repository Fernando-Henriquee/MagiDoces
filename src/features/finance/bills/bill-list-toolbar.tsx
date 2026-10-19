import { useSearchParams } from 'react-router';
import { PeriodPicker } from '@/components/shared/period-picker';
import { Select } from '@/components/ui/input';
import { type BillStatusFilter, statusIgnoresPeriod } from '@/data/payables';
import type { Period } from '@/lib/dates';
import { BILL_STATUS_OPTIONS } from './constants';

/** Filtro de situação guardado na URL (?situacao=…). */
export function useBillStatus(): [BillStatusFilter, (status: BillStatusFilter) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('situacao');
  const status = (BILL_STATUS_OPTIONS.some((o) => o.value === raw) ? raw : 'all') as BillStatusFilter;
  return [
    status,
    (next) => {
      const updated = new URLSearchParams(params);
      if (next === 'all') updated.delete('situacao');
      else updated.set('situacao', next);
      setParams(updated, { replace: true });
    },
  ];
}

export function BillListToolbar({
  status,
  onStatusChange,
  period,
  onPeriodChange,
}: {
  status: BillStatusFilter;
  onStatusChange: (status: BillStatusFilter) => void;
  period: Period;
  onPeriodChange: (period: Period) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Select aria-label="Situação" className="sm:w-44" value={status} onChange={(e) => onStatusChange(e.target.value as BillStatusFilter)}>
        {BILL_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {statusIgnoresPeriod(status) ? (
        <p className="text-sm text-muted">Mostrando todas as datas (posição atual).</p>
      ) : (
        <PeriodPicker period={period} onChange={onPeriodChange} />
      )}
    </div>
  );
}
