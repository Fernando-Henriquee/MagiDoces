import { lazy } from 'react';
import { Route } from 'react-router';

const PurchasesPage = lazy(() => import('./purchases-page').then((m) => ({ default: m.PurchasesPage })));
const PurchaseFormPage = lazy(() => import('./purchase-form-page').then((m) => ({ default: m.PurchaseFormPage })));
const PurchaseDetailPage = lazy(() => import('./purchase-detail-page').then((m) => ({ default: m.PurchaseDetailPage })));

/** Rotas do módulo de compras. */
export function purchasesRoutes() {
  return (
    <>
      <Route path="/compras" element={<PurchasesPage />} />
      <Route path="/compras/nova" element={<PurchaseFormPage />} />
      <Route path="/compras/:id" element={<PurchaseDetailPage />} />
      <Route path="/compras/:id/editar" element={<PurchaseFormPage />} />
    </>
  );
}
