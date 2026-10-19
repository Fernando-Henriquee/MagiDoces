import { lazy } from 'react';
import { Route } from 'react-router';

const ProfilePage = lazy(() => import('./profile-page').then((m) => ({ default: m.ProfilePage })));

/** Rotas do perfil do usuário. */
export function profileRoutes() {
  return <Route path="/perfil" element={<ProfilePage />} />;
}
