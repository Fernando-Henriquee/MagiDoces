import { lazy } from 'react';
import { Route } from 'react-router';

const SalesPage = lazy(() => import('./sales-page').then((m) => ({ default: m.SalesPage })));
const SaleFormPage = lazy(() => import('./sale-form-page').then((m) => ({ default: m.SaleFormPage })));
const SaleDetailPage = lazy(() => import('./sale-detail-page').then((m) => ({ default: m.SaleDetailPage })));

export function salesRoutes() {
  return (
    <>
      <Route path="/vendas" element={<SalesPage />} />
      <Route path="/vendas/nova" element={<SaleFormPage />} />
      <Route path="/vendas/:id" element={<SaleDetailPage />} />
      <Route path="/vendas/:id/editar" element={<SaleFormPage />} />
    </>
  );
}
