'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PwaProvider } from '@/features/pwa/PwaProvider';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/services/api';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <PwaProvider>{children}</PwaProvider>
    </QueryClientProvider>
  );
}
