import { Link2Off } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useParams } from 'react-router';
import { BrandMark } from '@/components/layout/brand';
import { cn } from '@/lib/cn';

/** Moldura das páginas públicas do link de compras (sem menu do sistema). */
export function StorefrontLayout({ businessName, children }: { businessName?: string; children: ReactNode }) {
  const { token = '' } = useParams();
  const name = businessName ?? 'Magi Doces';
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn('flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors', isActive ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink');
  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <header className="border-b border-line bg-panel/90">
        <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-4 pb-2 pt-3">
          <BrandMark className="size-10 rounded-xl" />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold leading-tight text-ink">{name}</p>
            <p className="text-xs text-muted">Anote sua compra e acompanhe o que deve</p>
          </div>
        </div>
        {businessName ? (
          <nav aria-label="Link de compras" className="mx-auto w-full max-w-lg px-4 pb-3">
            <div className="flex gap-1 rounded-lg bg-subtle p-1">
              <NavLink to={`/compra/${token}`} end className={tab}>
                Anotar compra
              </NavLink>
              <NavLink to={`/compra/${token}/consulta`} className={tab}>
                Quanto eu devo
              </NavLink>
            </div>
          </nav>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-10 pt-5">{children}</main>
      <footer className="mx-auto w-full max-w-lg px-4 pb-8 text-center text-xs text-muted">
        Seu nome e celular ficam só com a {name}, para registrar suas compras e falar com você.
      </footer>
    </div>
  );
}

export function StorefrontUnavailable() {
  return (
    <StorefrontLayout>
      <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-panel/60 px-6 py-12 text-center">
        <Link2Off className="size-9 text-accent-ink" aria-hidden />
        <h1 className="text-xl font-semibold">Link indisponível</h1>
        <p className="max-w-sm text-sm text-muted">Este link de compras não está ativo ou foi trocado. Peça o link atualizado à loja.</p>
      </div>
    </StorefrontLayout>
  );
}
