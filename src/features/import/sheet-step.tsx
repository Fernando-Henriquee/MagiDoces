import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { cellText } from '@/lib/import/normalize';
import type { SheetData, WorkbookData } from '@/lib/import/types';
import { sheetDataRows, sheetHeaders } from '@/lib/import/workbook';
import { AlreadyImportedNotice } from './already-imported';

interface SheetStepProps {
  workbook: WorkbookData;
  sheetIndex: number;
  headerRow: number;
  onSheetChange: (index: number) => void;
  onHeaderRowChange: (row: number) => void;
  onBack: () => void;
  onNext: () => void;
}

function rowPreview(sheet: SheetData, index: number): string {
  const text = (sheet.allRows[index] ?? []).map((cell) => cellText(cell)).filter(Boolean).join(' · ');
  return text.length > 70 ? `${text.slice(0, 70)}…` : text || '(linha vazia)';
}

/** Etapa 2: aba e linha de cabeçalho, com amostra das primeiras linhas. */
export function SheetStep({ workbook, sheetIndex, headerRow, onSheetChange, onHeaderRowChange, onBack, onNext }: SheetStepProps) {
  const base = workbook.sheets[sheetIndex]!;
  const sheet: SheetData = { ...base, headerRowIndex: headerRow };
  const headers = sheetHeaders(sheet);
  const rows = sheetDataRows(sheet);
  const sample = rows.slice(0, 8);
  const headerOptions = Array.from({ length: Math.min(20, sheet.allRows.length) }, (_, index) => index);

  return (
    <div className="space-y-4">
      <AlreadyImportedNotice sha256={workbook.sha256} />
      <Card>
        <CardHeader title={workbook.fileName} description={`${workbook.sheets.length} ${workbook.sheets.length === 1 ? 'aba' : 'abas'} · ${rows.length} linhas de dados`} />
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <Field label="Aba da planilha">
            <Select value={sheetIndex} onChange={(event) => onSheetChange(Number(event.target.value))}>
              {workbook.sheets.map((s, index) => (
                <option key={s.name} value={index}>
                  {s.name} ({s.allRows.length} linhas)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Linha do cabeçalho" hint="Detectada automaticamente; altere se os nomes das colunas estiverem em outra linha.">
            <Select value={headerRow} onChange={(event) => onHeaderRowChange(Number(event.target.value))}>
              {headerOptions.map((index) => (
                <option key={index} value={index}>
                  Linha {index + 1}: {rowPreview(sheet, index)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Primeiras linhas" description="Confira se os nomes das colunas estão corretos." />
        <div className="overflow-x-auto p-2">
          {sample.length === 0 ? (
            <p className="p-4 text-sm text-muted">Nenhuma linha de dados abaixo do cabeçalho escolhido.</p>
          ) : (
            <table className="w-full min-w-max text-xs">
              <caption className="sr-only">Amostra da aba {sheet.name}</caption>
              <thead className="bg-subtle/70 text-left text-muted">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-semibold">Linha</th>
                  {headers.map((header) => (
                    <th key={header} scope="col" className="px-2 py-1.5 font-semibold">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sample.map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="num px-2 py-1.5 text-muted">{row.rowNumber}</td>
                    {headers.map((header, index) => (
                      <td key={header} className="max-w-48 truncate px-2 py-1.5">
                        {cellText(row.cells[index] ?? null)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft /> Outro arquivo
        </Button>
        <Button onClick={onNext} disabled={rows.length === 0}>
          Mapear colunas <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
