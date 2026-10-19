import { CircleCheck, FileSpreadsheet, HandCoins, ListChecks, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ImportResult } from '@/data/imports';

function Line({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0">
      <span className="text-sm text-ink-soft">
        {label}
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
      <span className="num text-lg font-semibold">{value.toLocaleString('pt-BR')}</span>
    </div>
  );
}

/** Etapa 5: relatório final da importação. */
export function ResultStep({ result, fileName, onRestart }: { result: ImportResult; fileName: string; onRestart: () => void }) {
  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <CircleCheck className="size-8 shrink-0 text-success" aria-hidden />
        <div>
          <h2 className="text-xl font-semibold">Importação concluída</h2>
          <p className="text-sm text-muted">{fileName}</p>
        </div>
      </div>
      <div className="max-w-xl">
        <Line label="Vendas importadas" value={result.imported} />
        <Line label="Já importadas antes (não duplicadas)" value={result.duplicates} />
        <Line label="Ignoradas" value={result.ignored} hint="Linhas vazias ou desmarcadas na revisão" />
        <Line label="Inválidas (não importadas)" value={result.invalid} />
        <Line label="Clientes cadastrados" value={result.created_customers} />
        <Line label="Vendas com valores inferidos por regra" value={result.inferred} />
        <Line label="Total de linhas registradas no lote" value={result.total_rows} />
      </div>
      <p className="mt-4 text-xs text-ink-soft">
        Vendas sem informação de pagamento aparecem como “A confirmar” em Contas a receber: confirme-as ou registre os recebimentos.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild>
          <Link to={`/importar/lotes/${result.batch_id}`}>
            <ListChecks /> Ver relatório do lote
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/vendas">
            <ShoppingBag /> Ver vendas
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/receber">
            <HandCoins /> Contas a receber
          </Link>
        </Button>
        <Button variant="ghost" onClick={onRestart}>
          <FileSpreadsheet /> Importar outro arquivo
        </Button>
      </div>
    </Card>
  );
}
