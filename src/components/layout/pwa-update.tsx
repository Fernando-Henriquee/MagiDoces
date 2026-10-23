import { RefreshCw, X } from 'lucide-react';
import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Versão nova encontrada logo ao abrir: ainda não há nada digitado a perder. */
const AUTO_UPDATE_WINDOW_MS = 15_000;
const LOADED_AT = Date.now();

/**
 * Atualização controlada: quando há uma nova versão, o usuário escolhe o momento
 * de recarregar (evita perder um formulário em preenchimento).
 *
 * `autoUpdate` (telas fora da área logada: login, link de compras): a versão nova
 * encontrada logo ao abrir é aplicada na hora, para ninguém ficar preso numa
 * versão antiga guardada no aparelho (ex.: apontando para um servidor que mudou).
 */
export function PwaUpdatePrompt({ autoUpdate = false }: { autoUpdate?: boolean }) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) void registration.update();
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });

  useEffect(() => {
    if (autoUpdate && needRefresh && Date.now() - LOADED_AT < AUTO_UPDATE_WINDOW_MS) void updateServiceWorker(true);
  }, [autoUpdate, needRefresh, updateServiceWorker]);

  if (!needRefresh) return null;
  return (
    <div
      role="alertdialog"
      aria-labelledby="pwa-update-title"
      className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-panel p-3 shadow-[var(--shadow-pop)] lg:bottom-6"
    >
      <RefreshCw className="size-5 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0 flex-1">
        <p id="pwa-update-title" className="text-sm font-semibold">
          Nova versão disponível
        </p>
        <p className="text-xs text-muted">Salve o que estiver editando antes de atualizar.</p>
      </div>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>
        Atualizar
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Depois" onClick={() => setNeedRefresh(false)}>
        <X />
      </Button>
    </div>
  );
}
