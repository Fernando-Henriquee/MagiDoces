import { Route, Routes } from 'react-router';
import { auditRoutes } from '@/features/audit/routes';
import { customersRoutes } from '@/features/customers/routes';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { expensesRoutes } from '@/features/expenses/routes';
import { financeRoutes } from '@/features/finance/routes';
import { importRoutes } from '@/features/import/routes';
import { ingredientsRoutes } from '@/features/ingredients/routes';
import { productsRoutes } from '@/features/products/routes';
import { profileRoutes } from '@/features/profile/routes';
import { purchasesRoutes } from '@/features/purchases/routes';
import { receivablesRoutes } from '@/features/receivables/routes';
import { reportsRoutes } from '@/features/reports/routes';
import { salesRoutes } from '@/features/sales/routes';
import { settingsRoutes } from '@/features/settings/routes';
import { NotFoundPage } from './screens';

/**
 * Cada módulo expõe suas rotas em src/features/<módulo>/routes.tsx (páginas
 * carregadas sob demanda). A proteção real dos dados está na RLS do banco.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<DashboardPage />} />
      {salesRoutes()}
      {receivablesRoutes()}
      {customersRoutes()}
      {productsRoutes()}
      {ingredientsRoutes()}
      {purchasesRoutes()}
      {expensesRoutes()}
      {financeRoutes()}
      {reportsRoutes()}
      {importRoutes()}
      {auditRoutes()}
      {settingsRoutes()}
      {profileRoutes()}
      <Route path="/entrar" element={<DashboardPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
