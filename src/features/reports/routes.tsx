import { lazy } from 'react';
import { Route } from 'react-router';

const ReportsPage = lazy(() => import('./reports-page').then((m) => ({ default: m.ReportsPage })));

export function reportsRoutes() {
  return <Route path="/relatorios" element={<ReportsPage />} />;
}
