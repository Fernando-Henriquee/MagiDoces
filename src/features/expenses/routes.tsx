import { lazy } from 'react';
import { Route } from 'react-router';

const ExpensesPage = lazy(() => import('./expenses-page').then((m) => ({ default: m.ExpensesPage })));
const ExpenseFormPage = lazy(() => import('./expense-form-page').then((m) => ({ default: m.ExpenseFormPage })));
const ExpenseDetailPage = lazy(() => import('./expense-detail-page').then((m) => ({ default: m.ExpenseDetailPage })));

/** Rotas do módulo de despesas. */
export function expensesRoutes() {
  return (
    <>
      <Route path="/despesas" element={<ExpensesPage />} />
      <Route path="/despesas/nova" element={<ExpenseFormPage />} />
      <Route path="/despesas/:id" element={<ExpenseDetailPage />} />
      <Route path="/despesas/:id/editar" element={<ExpenseFormPage />} />
    </>
  );
}
