import { lazy } from 'react';
import { Route, Routes } from 'react-router';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { NotFoundPage } from './screens';

export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<DashboardPage />} />
      <Route path="/entrar" element={<DashboardPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export const lazyPage = lazy;
