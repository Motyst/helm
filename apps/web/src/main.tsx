import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryCache, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/newsreader/wght-italic.css';
import { App } from './app/App.tsx';
import { ApiError } from './lib/api.ts';
import { PERSISTED_KEYS, clearUserData, keys } from './lib/queries.ts';
import './ui/theme.css';

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // Session expired or signed out elsewhere: back to the sign-in screen.
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        queryClient.setQueryData(keys.me, { signedIn: false });
        clearUserData(queryClient);
      }
    },
  }),
  defaultOptions: {
    queries: {
      // Live events keep the cache fresh; refetch only on reconnect/reset.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
      // Persisted snapshots older than this are dropped on load.
      gcTime: 1000 * 60 * 60 * 24 * 7,
    },
    mutations: {
      // Try even when the browser thinks it's offline, so a change fails visibly instead of
      // waiting silently in memory. (Offline queueing can come later.)
      networkMode: 'always',
    },
  },
});

function deviceStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined; // Private mode or blocked storage: run without an offline copy.
  }
}

// The board, projects and sign-in state are kept on this device so the installed app opens
// instantly and still shows the last snapshot offline. Cleared on sign-out.
const persister = createSyncStoragePersister({ storage: deviceStorage(), key: 'helm.cache' });

// Dev-only handle for inspecting the cache from the console.
if (import.meta.env.DEV) (window as unknown as { __helmQc: QueryClient }).__helmQc = queryClient;

// Service worker (production builds only): precaches the app shell and updates itself.
// A display can stay open for days, so also look for a new build every hour.
if (import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onRegisteredSW: (_url, reg) => {
      if (reg) setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24 * 7,
        // Bump when the cached shapes change.
        buster: 'v1',
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            q.state.status === 'success' && PERSISTED_KEYS.includes(String(q.queryKey[0])),
        },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
