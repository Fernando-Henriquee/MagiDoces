import { lazy } from 'react';
import { Route } from 'react-router';

const AuditPage = lazy(() => import('./audit-page').then((m) => ({ default: m.AuditPage })));

/** Rotas do módulo de auditoria (somente leitura). */
export function auditRoutes() {
  return <Route path="/auditoria" element={<AuditPage />} />;
}
