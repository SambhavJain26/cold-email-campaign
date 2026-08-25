import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { loginBodySchema, type LoginBody } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
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
          toast.warning('Too many attempts — wait a minute before retrying.');
        }
      },
    });
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-sm shadow-sm">
        <CardHeader>
          <CardTitle>Cold Email Campaign</CardTitle>
          <CardDescription>Sign in to the operator console</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <FieldGroup className="gap-4">
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
                <FieldError>{errors.email?.message}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.password)}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  {...register('password')}
                />
                <FieldError>{errors.password?.message}</FieldError>
              </Field>
              {login.isError && (
                <p className="text-sm text-destructive" role="alert">
                  {login.error.message}
                </p>
              )}
              <Button type="submit" className="min-h-11 w-full" disabled={login.isPending}>
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
