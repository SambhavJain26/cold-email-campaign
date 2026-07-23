import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { changePasswordBodySchema, type ChangePasswordBody } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMe } from '@/api/queries/auth';
import { useChangePassword } from '@/api/mutations/auth';

/** F2.7 — Account tab: operator email + change password (docs/12 §10). */
export function AccountTab() {
  const { data: me } = useMe();
  const change = useChangePassword();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordBody>({ resolver: zodResolver(changePasswordBodySchema) });

  const onSubmit = (body: ChangePasswordBody) =>
    change.mutate(body, {
      onSuccess: () => {
        toast.success('Password changed');
        reset({ current: '', next: '' });
      },
    });

  return (
    <div className="max-w-md space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Operator</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{me?.email}</p>
          <p className="text-xs text-muted-foreground">
            Single-operator tool — there are no other accounts.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <div className="space-y-1">
              <Label htmlFor="acct-current">Current password</Label>
              <Input
                id="acct-current"
                type="password"
                autoComplete="current-password"
                {...register('current')}
              />
              {errors.current && (
                <p className="text-xs text-destructive">{errors.current.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="acct-next">New password (min 8 chars)</Label>
              <Input
                id="acct-next"
                type="password"
                autoComplete="new-password"
                {...register('next')}
              />
              {errors.next && <p className="text-xs text-destructive">{errors.next.message}</p>}
            </div>
            <Button type="submit" disabled={change.isPending}>
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
