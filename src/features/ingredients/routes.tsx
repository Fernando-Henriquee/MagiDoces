import { lazy } from 'react';
import { Route } from 'react-router';

const IngredientsPage = lazy(() => import('./ingredients-page').then((m) => ({ default: m.IngredientsPage })));

export function ingredientsRoutes() {
  return <Route path="/ingredientes" element={<IngredientsPage />} />;
}
