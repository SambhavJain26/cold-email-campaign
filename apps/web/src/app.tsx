import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { setOnUnauthorized } from '@/api/client';
import { queryClient } from '@/api/queryClient';
import { router } from '@/router';

// 401 anywhere → /login (docs/11 §2), preserving nothing — session is gone.
setOnUnauthorized(() => {
  void router.navigate('/login', { replace: true });
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
