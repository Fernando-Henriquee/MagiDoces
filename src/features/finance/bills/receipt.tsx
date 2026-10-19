import { FileText, Paperclip, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BUCKET_RULES, useSignedUrl, validateFile } from '@/data/storage';

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

/** Abre o comprovante por URL assinada de curta duração (bucket privado). */
export function ReceiptLink({ path }: { path: string }) {
  const signed = useSignedUrl('receipts', path);
  const isImage = IMAGE_RE.test(path);
  if (signed.isPending) return <p className="text-sm text-muted">Carregando comprovante…</p>;
  if (signed.isError || !signed.data) return <p className="text-sm text-warning">Comprovante indisponível no momento (é preciso estar online).</p>;
  return (
    <div className="space-y-2">
      {isImage ? (
        <a href={signed.data} target="_blank" rel="noopener noreferrer" className="block w-fit">
          <img src={signed.data} alt="Comprovante" className="max-h-48 rounded-lg border border-line object-contain" />
        </a>
      ) : null}
      <a
        href={signed.data}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-ink underline-offset-2 hover:underline"
      >
        <FileText className="size-4" aria-hidden /> Abrir comprovante
      </a>
    </div>
  );
}

interface ReceiptFieldProps {
  /** Comprovante já salvo (edição). */
  currentPath: string | null;
  onRemoveCurrent: () => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
}

/** Envio opcional de comprovante (PDF ou imagem). */
export function ReceiptField({ currentPath, onRemoveCurrent, file, onFileChange }: ReceiptFieldProps) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const rule = BUCKET_RULES.receipts;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-ink-soft">
        Comprovante <span className="font-normal text-muted">(opcional)</span>
      </label>
      {currentPath && !file ? (
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line bg-subtle/60 p-3">
          <ReceiptLink path={currentPath} />
          <Button type="button" variant="ghost" size="sm" onClick={onRemoveCurrent}>
            <Trash2 /> Remover
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="file"
          accept={rule.types.join(',')}
          aria-describedby={`${id}-hint`}
          className="block w-full text-sm text-ink-soft file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border file:border-line-strong file:bg-panel file:px-3 file:text-sm file:font-medium file:text-ink hover:file:bg-subtle"
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            if (!selected) {
              onFileChange(null);
              setError(null);
              return;
            }
            const problem = validateFile('receipts', selected);
            setError(problem);
            onFileChange(problem ? null : selected);
            if (problem) event.target.value = '';
          }}
        />
      </div>
      {file ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <Paperclip className="size-3.5" aria-hidden /> {file.name} será enviado ao salvar
          {currentPath ? ' (substitui o atual)' : ''}.
        </p>
      ) : null}
      <p id={`${id}-hint`} className="text-xs text-muted">
        {rule.label}. Fica guardado em área privada do negócio.
      </p>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
