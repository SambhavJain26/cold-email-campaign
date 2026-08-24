import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  ianaTimezoneSchema,
  sendWindowSchema,
  type CreateMailboxBody,
  type MailboxDto,
} from '@coldemail/shared';
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
import { Checkbox } from '@/components/ui/checkbox';
import { useCreateMailbox, usePatchMailbox, useTestConnection } from '@/api/mutations/mailboxes';
import { useSettings } from '@/api/queries/settings';
import { useMailboxFolders } from '@/api/queries/mailboxes';
import { FolderMultiSelect } from '@/components/shared/folder-multi-select';
import { TimezoneCombobox } from '@/components/shared/timezone-combobox';

/** The shared create schema, narrowed to the form's shape: ports/cap always
 *  present here (prefilled defaults), password validated per-mode at submit —
 *  blank in edit mode means "keep the sealed one" (never re-displayed, B6.2). */
const formSchema = z
  .object({
    auth_type: z.enum(['app_password', 'google_oauth']),
    display_name: z.string().min(1),
    from_address: z.email(),
    smtp_host: z.string(),
    smtp_port: z.number().int().min(1).max(65535),
    imap_host: z.string(),
    imap_port: z.number().int().min(1).max(65535),
    daily_cap: z.number().int().min(1),
    password: z.string(),
    timezone: ianaTimezoneSchema,
    send_window: sendWindowSchema,
    poll_folders: z.array(z.string().min(1)).min(1, 'Select at least one folder'),
  })
  .superRefine((values, ctx) => {
    if (values.auth_type === 'app_password' && values.smtp_host.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['smtp_host'], message: 'SMTP host is required' });
    }
    if (values.auth_type === 'app_password' && values.imap_host.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['imap_host'], message: 'IMAP host is required' });
    }
  });
type FormValues = z.infer<typeof formSchema>;

/** F2.2 — Add/Edit mailbox dialog (walkthrough Stage-0 form). */
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
  const settings = useSettings();
  const folders = useMailboxFolders(mailbox?.id, false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  });
  const selectedDays = useWatch({ control, name: 'send_window.days' }) ?? [];
  const authType = useWatch({ control, name: 'auth_type' }) ?? 'google_oauth';

  // Stale test results are cleared in handleOpenChange (an event handler) —
  // setState inside this effect trips the react-hooks compiler rule.
  useEffect(() => {
    if (!open) return;
    reset(
      mailbox
        ? {
            display_name: mailbox.display_name,
            auth_type: mailbox.auth_type,
            from_address: mailbox.from_address,
            smtp_host: mailbox.smtp_host,
            smtp_port: mailbox.smtp_port,
            imap_host: mailbox.imap_host,
            imap_port: mailbox.imap_port,
            daily_cap: mailbox.daily_cap,
            timezone: mailbox.timezone,
            send_window: mailbox.send_window,
            poll_folders: mailbox.poll_folders,
            password: '',
          }
        : {
            display_name: '',
            auth_type: 'google_oauth',
            from_address: '',
            smtp_host: 'smtp.gmail.com',
            smtp_port: 587,
            imap_host: 'imap.gmail.com',
            imap_port: 993,
            daily_cap: 30,
            timezone: settings.data?.default_timezone ?? 'UTC',
            send_window: { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
            poll_folders: ['INBOX', '[Gmail]/Spam'],
            password: '',
          },
    );
  }, [open, mailbox, reset, settings.data?.default_timezone]);

  const handleOpenChange = (next: boolean) => {
    if (!next) setTestResult(null);
    onOpenChange(next);
  };

  const onSubmit = (values: FormValues) => {
    if (!editing && values.auth_type === 'app_password' && values.password.length === 0) {
      setError('password', { message: 'App password is required' });
      return;
    }
    const body: CreateMailboxBody = {
      ...values,
      ...(values.auth_type === 'google_oauth' && { password: undefined }),
    } as CreateMailboxBody;
    if (editing) {
      const { password, auth_type: _authType, ...rest } = body;
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
      create.mutate(body, {
        onSuccess: () => {
          toast.success(
            body.auth_type === 'google_oauth'
              ? 'Mailbox added — connect Google to finish setup'
              : 'Mailbox added',
          );
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
            Google OAuth is recommended for Workspace inboxes. App passwords remain available as a
            fallback and are sealed at rest.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="mb-auth-type">Authentication</Label>
              <select
                id="mb-auth-type"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-60"
                disabled={editing}
                {...register('auth_type', {
                  onChange: (event) => {
                    if (event.target.value === 'google_oauth') {
                      setValue('smtp_host', 'smtp.gmail.com');
                      setValue('smtp_port', 587);
                      setValue('imap_host', 'imap.gmail.com');
                      setValue('imap_port', 993);
                      setValue('poll_folders', ['INBOX', '[Gmail]/Spam']);
                    }
                  },
                })}
              >
                <option value="google_oauth">Google OAuth (recommended)</option>
                <option value="app_password">App password</option>
              </select>
              <p className="text-xs text-muted-foreground">
                OAuth opens Google after this mailbox is saved; the application never stores your
                Google password.
              </p>
            </div>
            {field('display_name', 'Display name')}
            {field('from_address', 'From address')}
            {authType === 'app_password' && field('smtp_host', 'SMTP host')}
            {authType === 'app_password' && field('smtp_port', 'SMTP port', 'number')}
            {authType === 'app_password' && field('imap_host', 'IMAP host')}
            {authType === 'app_password' && field('imap_port', 'IMAP port', 'number')}
            {authType === 'app_password' &&
              field(
                'password',
                editing ? 'App password (blank = unchanged)' : 'App password',
                'password',
              )}
            {field('daily_cap', 'Daily cap', 'number')}
            <div className="space-y-1">
              <Label>Polled folders</Label>
              <Controller
                name="poll_folders"
                control={control}
                render={({ field }) => (
                  <FolderMultiSelect
                    value={field.value}
                    options={
                      folders.data?.items ?? [
                        { name: 'INBOX', special_use: '\\Inbox' },
                        { name: '[Gmail]/Spam', special_use: '\\Junk' },
                      ]
                    }
                    onChange={field.onChange}
                    onRefresh={editing ? () => void folders.refetch() : undefined}
                    refreshing={folders.isFetching}
                  />
                )}
              />
              <p className="text-xs text-muted-foreground">
                Select INBOX and the provider&rsquo;s spam folder so spam-filed replies remain
                visible. New folders start at UIDNEXT; old message history is not imported.
              </p>
              {errors.poll_folders && (
                <p className="text-xs text-destructive">{errors.poll_folders.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="mb-timezone">Fallback timezone</Label>
              <Controller
                name="timezone"
                control={control}
                render={({ field }) => (
                  <TimezoneCombobox
                    id="mb-timezone"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              <p className="text-xs text-muted-foreground">
                Used only when a lead has no known local timezone.
              </p>
              {errors.timezone && (
                <p className="text-xs text-destructive">{errors.timezone.message}</p>
              )}
            </div>
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="mb-window-start">Send window start</Label>
                <Input id="mb-window-start" type="time" {...register('send_window.start')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mb-window-end">Send window end</Label>
                <Input id="mb-window-end" type="time" {...register('send_window.end')} />
              </div>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Send days</Label>
              <div className="flex flex-wrap gap-x-3 gap-y-2">
                {[
                  [1, 'Mon'],
                  [2, 'Tue'],
                  [3, 'Wed'],
                  [4, 'Thu'],
                  [5, 'Fri'],
                  [6, 'Sat'],
                  [7, 'Sun'],
                ].map(([day, label]) => {
                  const n = Number(day);
                  const checked = selectedDays.includes(n);
                  return (
                    <Label
                      key={n}
                      className="flex cursor-pointer items-center gap-1.5 text-sm font-normal"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setValue(
                            'send_window.days',
                            next
                              ? [...selectedDays, n].sort((a, b) => a - b)
                              : selectedDays.filter((d) => d !== n),
                            { shouldValidate: true },
                          )
                        }
                      />
                      {label}
                    </Label>
                  );
                })}
              </div>
              {errors.send_window?.days && (
                <p className="text-xs text-destructive">{errors.send_window.days.message}</p>
              )}
            </div>
          </div>
          {testResult && (
            <p className="text-sm" data-testid="test-result">
              {testResult}
            </p>
          )}
          <DialogFooter>
            {editing && (mailbox.auth_type !== 'google_oauth' || mailbox.oauth_connected) && (
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending}
                onClick={() =>
                  test.mutate(mailbox.id, {
                    onSuccess: (r) =>
                      setTestResult(
                        `${r.smtp_ok ? '✅' : '❌'} SMTP ${r.smtp_ok ? 'OK' : 'failed'} · ${r.imap_ok ? '✅' : '❌'} IMAP ${r.imap_ok ? 'OK' : 'failed'} · ${r.folders.map((folder) => `${folder.exists ? '✅' : '❌'} ${folder.name}`).join(' · ')}${r.round_trip_ms !== undefined ? ` · ${(r.round_trip_ms / 1000).toFixed(1)}s` : ''}`,
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
