import { lazy } from 'react';
import { Route } from 'react-router';

const SettingsPage = lazy(() => import('./settings-page').then((m) => ({ default: m.SettingsPage })));

/** Rotas de configurações do negócio. */
export function settingsRoutes() {
  return <Route path="/configuracoes" element={<SettingsPage />} />;
}
