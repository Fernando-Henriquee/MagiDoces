import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Route, Routes } from 'react-router';
import { PurchasePage } from './purchase-page';
import { StatementPage } from './statement-page';
import { StorefrontUnavailable } from './storefront-layout';

/**
 * Páginas públicas do link de compras (/compra/<token>). Ficam fora da sessão e
 * do cache local do sistema: nada da área das sócias é carregado ou salvo aqui.
 */
export function StorefrontApp() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
          mutations: { retry: false, networkMode: 'always' },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Routes>
        <Route path="/compra/:token" element={<PurchasePage />} />
        <Route path="/compra/:token/consulta" element={<StatementPage />} />
        <Route path="*" element={<StorefrontUnavailable />} />
      </Routes>
    </QueryClientProvider>
  );
}
