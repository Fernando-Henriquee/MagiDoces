import {
  CakeSlice,
  ChartColumn,
  FileSpreadsheet,
  HandCoins,
  History,
  House,
  type LucideIcon,
  Package,
  Receipt,
  Settings,
  ShoppingBag,
  Users,
  Wallet,
  Wheat,
} from 'lucide-react';
import type { Capability } from '@/features/business/business-context';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  capability?: Capability;
}

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Operação',
    items: [
      { to: '/', label: 'Início', icon: House, end: true },
      { to: '/vendas', label: 'Vendas', icon: ShoppingBag },
      { to: '/receber', label: 'A receber', icon: HandCoins },
      { to: '/clientes', label: 'Clientes', icon: Users },
    ],
  },
  {
    label: 'Produção',
    items: [
      { to: '/produtos', label: 'Produtos', icon: CakeSlice },
      { to: '/ingredientes', label: 'Ingredientes', icon: Wheat },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { to: '/compras', label: 'Compras', icon: Package },
      { to: '/despesas', label: 'Despesas', icon: Receipt },
      { to: '/financeiro', label: 'Fluxo de caixa', icon: Wallet },
      { to: '/relatorios', label: 'Relatórios', icon: ChartColumn },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/importar', label: 'Importar planilha', icon: FileSpreadsheet, capability: 'import' },
      { to: '/auditoria', label: 'Auditoria', icon: History, capability: 'audit' },
      { to: '/configuracoes', label: 'Configurações', icon: Settings },
    ],
  },
];

/** Atalhos da barra inferior no celular (o botão central é "Nova venda"). */
export const MOBILE_PRIMARY = ['/', '/vendas', '/receber'];
