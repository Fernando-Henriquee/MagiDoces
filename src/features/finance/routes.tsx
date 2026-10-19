import { lazy } from 'react';
import { Route } from 'react-router';

const FinancePage = lazy(() => import('./finance-page').then((m) => ({ default: m.FinancePage })));

/** Rotas do módulo financeiro (fluxo de caixa, contas a pagar, pagamentos). */
export function financeRoutes() {
  return <Route path="/financeiro" element={<FinancePage />} />;
}
