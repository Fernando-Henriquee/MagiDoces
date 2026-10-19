import { lazy } from 'react';
import { Route } from 'react-router';

const CustomersPage = lazy(() => import('./customers-page').then((m) => ({ default: m.CustomersPage })));
const CustomerDetailPage = lazy(() => import('./customer-detail-page').then((m) => ({ default: m.CustomerDetailPage })));

export function customersRoutes() {
  return (
    <>
      <Route path="/clientes" element={<CustomersPage />} />
      <Route path="/clientes/:id" element={<CustomerDetailPage />} />
    </>
  );
}
