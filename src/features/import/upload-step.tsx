import { FileSpreadsheet, Upload } from 'lucide-react';
import { type DragEvent, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import type { WorkbookData } from '@/lib/import/types';
import { ACCEPTED_EXTENSIONS, readWorkbook } from '@/lib/import/workbook';

/** Etapa 1: escolha do arquivo (arrastar e soltar ou seletor). */
export function UploadStep({ onLoaded }: { onLoaded: (workbook: WorkbookData) => void }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      onLoaded(await readWorkbook(file));
    } catch (problem) {
      const known = problem instanceof Error && /^(Formato não suportado|Arquivo maior|A planilha está vazia)/.test(problem.message);
      setError(
        known
          ? describeError(problem)
          : 'Não foi possível ler a planilha. Confira se o arquivo não está corrompido ou protegido por senha e tente salvá-lo novamente como .xlsx ou .csv.',
      );
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void handle(event.dataTransfer.files[0]);
  };

  return (
    <Card className="p-4 sm:p-6">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-brand bg-accent-soft' : 'border-line-strong bg-subtle/60 hover:bg-subtle',
        )}
      >
        <FileSpreadsheet className="size-10 text-accent-ink" aria-hidden />
        <span className="font-display text-lg text-ink">Arraste a planilha aqui</span>
        <span className="text-sm text-muted">ou clique para escolher um arquivo .xlsx, .xls ou .csv (até 10 MB)</span>
        <span className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg">
          <Upload className="size-4" aria-hidden /> Escolher arquivo
        </span>
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={[...ACCEPTED_EXTENSIONS, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'].join(',')}
        className="sr-only"
        aria-label="Arquivo da planilha"
        onChange={(event) => void handle(event.target.files?.[0])}
        disabled={loading}
      />
      {loading ? <Spinner className="mt-4" label="Lendo a planilha…" /> : null}
      {error ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
          <Button size="sm" variant="danger-outline" onClick={() => inputRef.current?.click()}>
            Escolher outro arquivo
          </Button>
        </div>
      ) : null}
      <ul className="mt-5 space-y-1 text-xs text-ink-soft">
        <li>• O arquivo é lido somente neste aparelho até você confirmar a importação.</li>
        <li>• Você poderá conferir o mapeamento das colunas e uma prévia de todas as linhas antes de gravar.</li>
        <li>• Reimportar o mesmo arquivo não duplica vendas: linhas já importadas são reconhecidas.</li>
      </ul>
    </Card>
  );
}
