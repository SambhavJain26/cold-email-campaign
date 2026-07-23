import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/api/queries/auth';

/** Auth guard (docs/11 §2): /auth/me decides; 401 → /login with a return path. */
export function RequireAuth() {
  const { isPending, isError } = useMe();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-64 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }
  if (isError) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
