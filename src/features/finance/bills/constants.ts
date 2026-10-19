export const PURCHASE_CATEGORIES = ['Ingredientes', 'Embalagens', 'Utensílios', 'Outros insumos'];

export const EXPENSE_CATEGORIES = [
  'Aluguel',
  'Energia',
  'Água',
  'Gás',
  'Internet/telefone',
  'Transporte/entrega',
  'Marketing',
  'Taxas e tarifas',
  'Manutenção',
  'Outros',
];

export const PURCHASE_UNITS = ['un', 'dz', 'g', 'kg', 'mg', 'ml', 'l', 'cx', 'pct', 'fardo'];

export const BILL_STATUS_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Em aberto' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'paid', label: 'Pagas' },
  { value: 'cancelled', label: 'Canceladas' },
] as const;
