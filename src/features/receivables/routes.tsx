import { lazy } from 'react';
import { Route } from 'react-router';

const ReceivablesPage = lazy(() => import('./receivables-page').then((m) => ({ default: m.ReceivablesPage })));

export function receivablesRoutes() {
  return <Route path="/receber" element={<ReceivablesPage />} />;
}
