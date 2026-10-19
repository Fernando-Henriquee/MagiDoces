import { History, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useCustomers, useProducts } from '@/data/catalog';
import { type ImportResult, useExistingFingerprints, useRunImport } from '@/data/imports';
import { useBusiness } from '@/features/business/business-context';
import { applyExistingFingerprints, buildPreview, toRpcRows } from '@/lib/import/build';
import { suggestMapping } from '@/lib/import/detect';
import { sha256Text } from '@/lib/import/sha256';
import {
  type CellValue,
  type ColumnMapping,
  type CustomerRef,
  DEFAULT_RULES,
  type Layout,
  type MigrationRules,
  type ProductRef,
  type SheetData,
  type WorkbookData,
} from '@/lib/import/types';
import { sheetDataRows, sheetHeaders } from '@/lib/import/workbook';
import { MappingStep } from './mapping-step';
import { PreviewStep } from './preview-step';
import { ResultStep } from './result-step';
import { SheetStep } from './sheet-step';
import { type StepInfo, Stepper } from './stepper';
import { UploadStep } from './upload-step';

type Step = 'upload' | 'sheet' | 'mapping' | 'preview' | 'done';

const STEPS: StepInfo[] = [
  { id: 'upload', label: 'Arquivo' },
  { id: 'sheet', label: 'Aba' },
  { id: 'mapping', label: 'Colunas e regras' },
  { id: 'preview', label: 'Prévia' },
  { id: 'done', label: 'Relatório' },
];

interface MappingState {
  key: string;
  columns: ColumnMapping[];
  layout: Layout;
}

function firstSheetWithData(workbook: WorkbookData): number {
  const index = workbook.sheets.findIndex((sheet) => sheet.allRows.length > 1);
  return index < 0 ? 0 : index;
}

export function ImportPage() {
  const { can, today } = useBusiness();
  const products = useProducts();
  const customers = useCustomers();
  const runImport = useRunImport();

  const [step, setStep] = useState<Step>('upload');
  const [workbook, setWorkbook] = useState<WorkbookData | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<MappingState | null>(null);
  const [rules, setRules] = useState<MigrationRules>(DEFAULT_RULES);
  const [aliases, setAliases] = useState<Record<string, string | null>>({});
  const [overrides, setOverrides] = useState<Record<number, Record<number, string>>>({});
  const [ignored, setIgnored] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);

  const productRefs = useMemo<ProductRef[]>(
    () => (products.data ?? []).map((p) => ({ id: p.id, name: p.name, price_cents: p.price_cents, active: p.active })),
    [products.data],
  );
  const customerRefs = useMemo<CustomerRef[]>(() => (customers.data ?? []).map((c) => ({ id: c.id, name: c.name })), [customers.data]);

  const sheet = useMemo<SheetData | null>(
    () => (workbook?.sheets[sheetIndex] ? { ...workbook.sheets[sheetIndex], headerRowIndex: headerRow } : null),
    [workbook, sheetIndex, headerRow],
  );
  const headers = useMemo(() => (sheet ? sheetHeaders(sheet) : []), [sheet]);
  const rows = useMemo(() => (sheet ? sheetDataRows(sheet) : []), [sheet]);
  const cellsByRow = useMemo(() => new Map<number, CellValue[]>(rows.map((row) => [row.rowNumber, row.cells])), [rows]);
  const mappingKey = `${sheetIndex}:${headerRow}`;

  // Aviso ao sair da página com uma importação em andamento.
  useEffect(() => {
    if (!workbook || step === 'done') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [workbook, step]);

  const preview = useMemo(() => {
    if (step !== 'preview' || !mapping) return [];
    return buildPreview({
      headers,
      rows,
      columns: mapping.columns,
      layout: mapping.layout,
      rules,
      products: productRefs,
      customers: customerRefs,
      productAliases: aliases,
      overrides,
      today: today(),
    });
  }, [step, mapping, headers, rows, rules, productRefs, customerRefs, aliases, overrides, today]);

  const fingerprints = useMemo(() => preview.map((row) => row.fingerprint).filter((f): f is string => Boolean(f)), [preview]);
  const fingerprintsKey = useMemo(() => sha256Text(fingerprints.join('|')), [fingerprints]);
  const existing = useExistingFingerprints(fingerprints, fingerprintsKey, step === 'preview');
  const checked = useMemo(() => (existing.data ? applyExistingFingerprints(preview, existing.data) : preview), [preview, existing.data]);

  if (!can('import')) {
    return (
      <Page>
        <PageHeader title="Importar planilha" />
        <EmptyState
          icon={<Lock />}
          title="Somente leitura"
          description="Seu perfil pode consultar o histórico de importações, mas não importar arquivos."
          action={
            <Button asChild variant="outline">
              <Link to="/importar/lotes">
                <History /> Ver importações anteriores
              </Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const restart = () => {
    setStep('upload');
    setWorkbook(null);
    setMapping(null);
    setRules(DEFAULT_RULES);
    setAliases({});
    setOverrides({});
    setIgnored(new Set());
    setResult(null);
    runImport.reset();
  };

  const goToMapping = () => {
    if (!mapping || mapping.key !== mappingKey) {
      const suggestion = suggestMapping(headers, rows.map((row) => row.cells), productRefs);
      setMapping({ key: mappingKey, columns: suggestion.columns, layout: suggestion.layout });
    }
    setStep('mapping');
  };

  const confirm = async () => {
    if (!workbook || !sheet || !mapping) return;
    const outcome = await runImport.mutateAsync({
      batch: {
        file_name: workbook.fileName,
        file_sha256: workbook.sha256,
        file_size_bytes: workbook.sizeBytes,
        sheet_name: sheet.name,
        layout: mapping.layout,
        mapping: mapping.columns,
        rules,
      },
      rows: toRpcRows(checked, ignored),
    });
    setResult(outcome);
    setStep('done');
  };

  const catalogLoading = products.isPending || customers.isPending;

  return (
    <Page>
      <PageHeader
        title="Importar planilha"
        description="Traga as vendas da planilha antiga com prévia, validação e sem duplicar registros."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/importar/lotes">
              <History /> Importações anteriores
            </Link>
          </Button>
        }
      />
      <Stepper steps={STEPS} current={step} />

      {products.isError && !products.data ? <ErrorState error={products.error} onRetry={() => void products.refetch()} /> : null}

      {step === 'upload' ? (
        <UploadStep
          onLoaded={(loaded) => {
            const index = firstSheetWithData(loaded);
            setWorkbook(loaded);
            setSheetIndex(index);
            setHeaderRow(loaded.sheets[index]?.headerRowIndex ?? 0);
            setMapping(null);
            setAliases({});
            setOverrides({});
            setIgnored(new Set());
            setStep('sheet');
          }}
        />
      ) : null}

      {step === 'sheet' && workbook ? (
        <SheetStep
          workbook={workbook}
          sheetIndex={sheetIndex}
          headerRow={headerRow}
          onSheetChange={(index) => {
            setSheetIndex(index);
            setHeaderRow(workbook.sheets[index]?.headerRowIndex ?? 0);
            setOverrides({});
            setIgnored(new Set());
          }}
          onHeaderRowChange={(row) => {
            setHeaderRow(row);
            setOverrides({});
            setIgnored(new Set());
          }}
          onBack={restart}
          onNext={goToMapping}
        />
      ) : null}

      {step === 'mapping' && mapping ? (
        catalogLoading ? (
          <LoadingBlock rows={4} />
        ) : (
          <MappingStep
            rows={rows}
            columns={mapping.columns}
            layout={mapping.layout}
            rules={rules}
            aliases={aliases}
            overrides={overrides}
            products={productRefs}
            onColumnsChange={(columns) => setMapping({ ...mapping, columns })}
            onLayoutChange={(layout) => setMapping({ ...mapping, layout })}
            onRulesChange={setRules}
            onAliasesChange={setAliases}
            onBack={() => setStep('sheet')}
            onNext={() => setStep('preview')}
          />
        )
      ) : null}

      {step === 'preview' && mapping ? (
        <PreviewStep
          preview={checked}
          cellsByRow={cellsByRow}
          columns={mapping.columns}
          ignored={ignored}
          overrides={overrides}
          checking={existing.isFetching && !existing.data}
          checkError={existing.isError ? existing.error : null}
          onRetryCheck={() => void existing.refetch()}
          onToggleIgnored={(rowNumber, ignore) =>
            setIgnored((current) => {
              const next = new Set(current);
              if (ignore) next.add(rowNumber);
              else next.delete(rowNumber);
              return next;
            })
          }
          onOverride={(rowNumber, values) =>
            setOverrides((current) => {
              const next = { ...current };
              if (Object.keys(values).length === 0) delete next[rowNumber];
              else next[rowNumber] = values;
              return next;
            })
          }
          onBack={() => setStep('mapping')}
          onConfirm={confirm}
          confirming={runImport.isPending}
          importError={runImport.error}
        />
      ) : null}

      {step === 'done' && result && workbook ? <ResultStep result={result} fileName={workbook.fileName} onRestart={restart} /> : null}
    </Page>
  );
}
