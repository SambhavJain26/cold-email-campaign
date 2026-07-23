import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { loginBodySchema, type LoginBody } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppApiError } from '@/api/client';
import { useLogin } from '@/api/mutations/auth';

/** F1.1 (docs/12 §13): email + password → POST auth/login; error toast on
 *  401/429; redirect to the intended route. Form validation = the SAME zod
 *  schema the server validates with (decision H). */
export default function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname?: string } } };
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginBody>({ resolver: zodResolver(loginBodySchema) });

  const onSubmit = (body: LoginBody) => {
    login.mutate(body, {
      onSuccess: () => navigate(location.state?.from?.pathname ?? '/overview', { replace: true }),
      onError: (error) => {
        // The global mutation toast already fired with the envelope message;
        // add the specific guidance for rate-limiting (docs/12 §13).
        if (error instanceof AppApiError && error.code === 'rate_limited') {
          toast.warning('Too many attempts - wait a minute before retrying.');
        }
      },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Cold Email Campaign</CardTitle>
          <CardDescription>Sign in to the operator console</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" {...register('email')} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>
            {login.isError && (
              <p className="text-sm text-destructive" role="alert">
                {login.error.message}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
