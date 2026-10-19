import { lazy } from 'react';
import { Route } from 'react-router';

const ImportPage = lazy(() => import('./import-page').then((m) => ({ default: m.ImportPage })));
const BatchesPage = lazy(() => import('./batches-page').then((m) => ({ default: m.BatchesPage })));
const BatchDetailPage = lazy(() => import('./batch-detail-page').then((m) => ({ default: m.BatchDetailPage })));

/** Rotas da importação de planilhas. */
export function importRoutes() {
  return (
    <>
      <Route path="/importar" element={<ImportPage />} />
      <Route path="/importar/lotes" element={<BatchesPage />} />
      <Route path="/importar/lotes/:id" element={<BatchDetailPage />} />
    </>
  );
}
