import { lazy } from 'react';
import { Route } from 'react-router';

const ProductsPage = lazy(() => import('./products-page').then((m) => ({ default: m.ProductsPage })));
const ProductDetailPage = lazy(() => import('./product-detail-page').then((m) => ({ default: m.ProductDetailPage })));

export function productsRoutes() {
  return (
    <>
      <Route path="/produtos" element={<ProductsPage />} />
      <Route path="/produtos/:id" element={<ProductDetailPage />} />
    </>
  );
}
