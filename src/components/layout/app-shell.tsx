import { Ellipsis, LogOut, Plus, UserRound } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useAuth } from '@/features/auth/auth-context';
import { ROLE_LABELS, useBusiness } from '@/features/business/business-context';
import { cn } from '@/lib/cn';
import { LocalEnvBanner, OfflineBanner } from './banners';
import { BrandMark, BrandName } from './brand';
import { MOBILE_PRIMARY, NAV_GROUPS, type NavItem } from './nav';

function useVisibleGroups() {
  const { can } = useBusiness();
  return NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !item.capability || can(item.capability)) })).filter(
    (group) => group.items.length > 0,
  );
}

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-accent-soft text-accent-ink' : 'text-ink-soft hover:bg-subtle hover:text-ink',
        )
      }
    >
      <Icon className="size-[1.1rem] shrink-0" aria-hidden />
      {item.label}
    </NavLink>
  );
}

function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, signOut } = useAuth();
  const { role, business } = useBusiness();
  const name = (user?.user_metadata?.display_name as string | undefined) ?? user?.email ?? '';
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-lg text-left hover:bg-subtle',
            compact ? 'p-1.5' : 'w-full px-2 py-2',
          )}
          aria-label="Menu da conta"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-ink">
            {name.slice(0, 1).toUpperCase() || <UserRound className="size-4" />}
          </span>
          {compact ? null : (
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{name}</span>
              <span className="block truncate text-xs text-muted">{ROLE_LABELS[role]}</span>
            </span>
          )}
        </button>
      </MenuTrigger>
      <MenuContent align={compact ? 'end' : 'start'}>
        <div className="px-2.5 py-2 text-xs text-muted">
          <p className="truncate font-medium text-ink">{user?.email}</p>
          <p className="truncate">{business.name}</p>
        </div>
        <MenuSeparator />
        <MenuItem asChild>
          <Link to="/perfil">
            <UserRound /> Meu perfil
          </Link>
        </MenuItem>
        <MenuItem onSelect={() => void signOut('local')}>
          <LogOut /> Sair
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function Sidebar() {
  const groups = useVisibleGroups();
  const { can } = useBusiness();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-panel/70 lg:flex">
      <Link to="/" className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <BrandMark />
        <BrandName />
      </Link>
      {can('write') ? (
        <div className="px-4 pb-3">
          <Button asChild className="w-full">
            <Link to="/vendas/nova">
              <Plus /> Nova venda
            </Link>
          </Button>
        </div>
      ) : null}
      <nav aria-label="Navegação principal" className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <SidebarLink key={item.to} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-3">
        <UserMenu />
      </div>
    </aside>
  );
}

function MobileNav() {
  const groups = useVisibleGroups();
  const { can } = useBusiness();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const all = groups.flatMap((g) => g.items);
  const primary = MOBILE_PRIMARY.map((to) => all.find((item) => item.to === to)).filter((item): item is NavItem => Boolean(item));
  const moreActive = !primary.some((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))) && location.pathname !== '/vendas/nova';

  const tab = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.7rem] font-medium', isActive ? 'text-accent-ink' : 'text-muted')
        }
      >
        <Icon className="size-5" aria-hidden />
        {item.label}
      </NavLink>
    );
  };

  return (
    <>
      <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur safe-bottom lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch">
          {primary.slice(0, 2).map(tab)}
          {can('write') ? (
            <div className="flex flex-1 items-center justify-center">
              <Link
                to="/vendas/nova"
                aria-label="Nova venda"
                className="-mt-5 grid size-14 place-items-center rounded-full bg-brand text-brand-fg shadow-[var(--shadow-pop)] ring-4 ring-cream"
              >
                <Plus className="size-6" />
              </Link>
            </div>
          ) : null}
          {primary.slice(2).map(tab)}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.7rem] font-medium', moreActive ? 'text-accent-ink' : 'text-muted')}
          >
            <Ellipsis className="size-5" aria-hidden />
            Mais
          </button>
        </div>
      </nav>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent title="Menu">
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{group.label}</p>
                <div className="grid grid-cols-2 gap-1">
                  {group.items.map((item) => (
                    <SidebarLink key={item.to} item={item} onNavigate={() => setMoreOpen(false)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { business } = useBusiness();
  return (
    <div className="flex min-h-dvh flex-col">
      <LocalEnvBanner />
      <div className="flex flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-cream/95 px-4 py-2.5 backdrop-blur safe-top lg:hidden">
            <Link to="/" className="flex min-w-0 items-center gap-2">
              <BrandMark className="size-8" />
              <span className="min-w-0">
                <BrandName className="block text-lg leading-tight" />
                <span className="block truncate text-[0.7rem] text-muted">{business.name}</span>
              </span>
            </Link>
            <UserMenu compact />
          </header>
          <OfflineBanner />
          <main id="conteudo" className="flex-1 pb-24 lg:pb-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav />
    </div>
  );
}
