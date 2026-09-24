import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import './ui/theme.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live events keep the cache fresh; refetch only on reconnect/reset.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: (count, err) => (err as { status?: number }).status !== 401 && count < 2,
    },
  },
});

// Dev-only handle for inspecting the cache from the console.
if (import.meta.env.DEV) (window as unknown as { __helmQc: QueryClient }).__helmQc = queryClient;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
