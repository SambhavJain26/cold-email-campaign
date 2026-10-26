import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { createMailboxBodySchema, type MailboxDto } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateMailbox, usePatchMailbox, useTestConnection } from '@/api/mutations/mailboxes';

/** The shared create schema, narrowed to the form's shape: ports/cap always
 *  present here (prefilled defaults), password validated per-mode at submit - 
 *  blank in edit mode means "keep the sealed one" (never re-displayed, B6.2). */
const formSchema = createMailboxBodySchema.omit({ auth_type: true, send_window: true }).extend({
  smtp_port: z.number().int().min(1).max(65535),
  imap_port: z.number().int().min(1).max(65535),
  daily_cap: z.number().int().min(1),
  password: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

/** F2.2 - Add/Edit mailbox dialog (walkthrough Stage-0 form). */
export function MailboxDialog({
  open,
  onOpenChange,
  mailbox,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode. */
  mailbox?: MailboxDto;
}) {
  const editing = mailbox !== undefined;
  const create = useCreateMailbox();
  const patch = usePatchMailbox();
  const test = useTestConnection();
  const [testResult, setTestResult] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  });

  // Stale test results are cleared in handleOpenChange (an event handler) - 
  // setState inside this effect trips the react-hooks compiler rule.
  useEffect(() => {
    if (!open) return;
    reset(
      mailbox
        ? {
            display_name: mailbox.display_name,
            from_address: mailbox.from_address,
            smtp_host: mailbox.smtp_host,
            smtp_port: mailbox.smtp_port,
            imap_host: mailbox.imap_host,
            imap_port: mailbox.imap_port,
            daily_cap: mailbox.daily_cap,
            password: '',
          }
        : {
            display_name: '',
            from_address: '',
            smtp_host: '',
            smtp_port: 465,
            imap_host: '',
            imap_port: 993,
            daily_cap: 30,
            password: '',
          },
    );
  }, [open, mailbox, reset]);

  const handleOpenChange = (next: boolean) => {
    if (!next) setTestResult(null);
    onOpenChange(next);
  };

  const onSubmit = (values: FormValues) => {
    if (!editing && values.password.length === 0) {
      setError('password', { message: 'App password is required' });
      return;
    }
    if (editing) {
      const { password, ...rest } = values;
      patch.mutate(
        { id: mailbox.id, body: password ? { ...rest, password } : rest },
        {
          onSuccess: () => {
            toast.success('Mailbox updated');
            handleOpenChange(false);
          },
        },
      );
    } else {
      create.mutate(values, {
        onSuccess: () => {
          toast.success('Mailbox added');
          handleOpenChange(false);
        },
      });
    }
  };

  const field = (
    name: keyof FormValues,
    label: string,
    type: 'text' | 'password' | 'number' = 'text',
    placeholder?: string,
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`mb-${name}`}>{label}</Label>
      <Input
        id={`mb-${name}`}
        type={type}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        {...register(name, type === 'number' ? { valueAsNumber: true } : undefined)}
      />
      {errors[name] && <p className="text-xs text-destructive">{errors[name]?.message}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${mailbox.from_address}` : 'Add mailbox'}</DialogTitle>
          <DialogDescription>
            SMTP sends, IMAP reply detection. The password is sealed at rest and never shown again.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-3">
            {field('display_name', 'Display name')}
            {field('from_address', 'From address')}
            {field('smtp_host', 'SMTP host')}
            {field('smtp_port', 'SMTP port', 'number')}
            {field('imap_host', 'IMAP host')}
            {field('imap_port', 'IMAP port', 'number')}
            {field(
              'password',
              editing ? 'App password (blank = unchanged)' : 'App password',
              'password',
            )}
            {field('daily_cap', 'Daily cap', 'number')}
          </div>
          {testResult && (
            <p className="text-sm" data-testid="test-result">
              {testResult}
            </p>
          )}
          <DialogFooter>
            {editing && (
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending}
                onClick={() =>
                  test.mutate(mailbox.id, {
                    onSuccess: (r) =>
                      setTestResult(
                        `${r.smtp_ok ? '✅' : '❌'} SMTP ${r.smtp_ok ? 'OK' : 'failed'} · ${r.imap_ok ? '✅' : '❌'} IMAP ${r.imap_ok ? 'OK' : 'failed'}${r.round_trip_ms !== undefined ? ` · ${(r.round_trip_ms / 1000).toFixed(1)}s` : ''}`,
                      ),
                  })
                }
              >
                Test Connection
              </Button>
            )}
            <Button type="submit" disabled={create.isPending || patch.isPending}>
              {editing ? 'Save changes' : 'Add mailbox'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
