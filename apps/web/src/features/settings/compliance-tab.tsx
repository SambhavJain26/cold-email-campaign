import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { complianceSchema, type ComplianceDto } from '@coldemail/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import { usePutCompliance } from '@/api/mutations/settings';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** F2.6 — CAN-SPAM footer editor with live preview (docs/12 §10). An empty
 *  physical address BLOCKS all sends (B4 guard) — the banner says so. */
export function ComplianceTab({
  compliance,
  onDirtyChange,
}: {
  compliance: ComplianceDto;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const put = usePutCompliance();
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<ComplianceDto>({
    resolver: zodResolver(complianceSchema),
    defaultValues: compliance,
  });

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const address = useWatch({ control, name: 'physical_address' });
  const emailFormat = useWatch({ control, name: 'email_format' });
  const optout = useWatch({ control, name: 'optout_text' });
  const signatureName = useWatch({ control, name: 'signature_name' });
  const signatureRoleLine = useWatch({ control, name: 'signature_role_line' });
  const unsubBase = useWatch({ control, name: 'unsubscribe_base_url' });
  const addressEmpty = address.trim() === '';

  // Mirrors render/footer.ts: opt-out and address are separate visible lines.
  const hasLiveLink = unsubBase.trim() !== '';

  const onSubmit = (body: ComplianceDto) =>
    put.mutate(body, {
      onSuccess: (saved) => {
        toast.success('Compliance footer saved');
        reset(saved);
      },
    });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {addressEmpty && (
        <Alert className="border-destructive/50 text-destructive" data-testid="empty-address-block">
          <AlertTitle>Sending is blocked without a physical address</AlertTitle>
          <AlertDescription>
            CAN-SPAM requires a postal address in every email. The scheduler refuses ALL sends while
            this is empty — saving an empty address is not allowed.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Sender signature and footer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FieldGroup>
            <Controller
              control={control}
              name="email_format"
              render={({ field }) => (
                <Field data-invalid={Boolean(errors.email_format)}>
                  <FieldLabel htmlFor="email-format">Email format</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="email-format" aria-invalid={Boolean(errors.email_format)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="plain_text">Plain text — default</SelectItem>
                        <SelectItem value="minimal_html">Minimal HTML</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Applies to new messages in all campaigns. Retries keep their original format.
                  </p>
                  {errors.email_format && <FieldError>{errors.email_format.message}</FieldError>}
                </Field>
              )}
            />
            <Field data-invalid={Boolean(errors.signature_name)}>
              <FieldLabel htmlFor="compliance-signature-name">Signature name</FieldLabel>
              <Input
                id="compliance-signature-name"
                aria-invalid={Boolean(errors.signature_name)}
                {...register('signature_name')}
              />
              {errors.signature_name && <FieldError>{errors.signature_name.message}</FieldError>}
            </Field>
            <Field data-invalid={Boolean(errors.signature_role_line)}>
              <FieldLabel htmlFor="compliance-signature-role">Role line</FieldLabel>
              <Input
                id="compliance-signature-role"
                aria-invalid={Boolean(errors.signature_role_line)}
                {...register('signature_role_line')}
              />
              {errors.signature_role_line && (
                <FieldError>{errors.signature_role_line.message}</FieldError>
              )}
              <p className="text-xs text-muted-foreground">
                The sending mailbox domain appears as plain text on the next line.
              </p>
            </Field>
          </FieldGroup>
          <div className="space-y-1">
            <Label htmlFor="compliance-address">Physical address</Label>
            <Textarea id="compliance-address" rows={2} {...register('physical_address')} />
            {errors.physical_address && (
              <p className="text-xs text-destructive">{errors.physical_address.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="compliance-optout">Opt-out text</Label>
            <Input id="compliance-optout" {...register('optout_text')} />
            <p className="text-xs text-muted-foreground">
              Used verbatim while no unsubscribe URL is set. Once one is, the footer switches to a
              one-click link. Replies containing STOP are still detected and honored automatically.
            </p>
            {errors.optout_text && (
              <p className="text-xs text-destructive">{errors.optout_text.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="compliance-unsub-url">Unsubscribe base URL</Label>
            <Input
              id="compliance-unsub-url"
              placeholder="https://unsubscribe.{sender_domain}"
              {...register('unsubscribe_base_url')}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank until you have a real sending domain. Blank means no link and no
              <code className="mx-1">List-Unsubscribe</code>
              header — recipients opt out by replying STOP. Use{' '}
              <code>https://unsubscribe.{'{sender_domain}'}</code> to select the matching host for
              every sending mailbox. HTTPS only, no trailing slash.
            </p>
            {errors.unsubscribe_base_url && (
              <p className="text-xs text-destructive">{errors.unsubscribe_base_url.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Live preview — appended to every send</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="rounded-md border border-dashed border-border bg-muted/30 p-3"
            data-testid="footer-preview"
          >
            {emailFormat === 'plain_text' ? (
              <pre className="font-mono text-xs whitespace-pre-wrap break-words">{`${signatureName}\n${signatureRoleLine}\n[sending mailbox domain]\n\n${hasLiveLink ? 'Unsubscribe: https://unsubscribe-preview.invalid/u/not-a-live-token' : optout}\n${address || '⟨no address — sends blocked⟩'}`}</pre>
            ) : (
              <>
                <div className="font-mono text-xs">
                  <strong>{signatureName}</strong>
                  <br />
                  {signatureRoleLine}
                  <br />
                  [sending mailbox domain]
                </div>
                <div className="mt-5 font-mono text-[10px] leading-[15px] text-[#767676]">
                  {hasLiveLink ? (
                    <span className="font-bold no-underline">Unsubscribe</span>
                  ) : (
                    <span>{optout}</span>
                  )}
                  <br />
                  <span className="whitespace-pre-wrap">
                    {address || '⟨no address — sends blocked⟩'}
                  </span>
                </div>
              </>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {emailFormat === 'plain_text'
              ? 'Plain text uses line breaks and blank lines only. End your draft with Best, to place your name immediately below it.'
              : 'The compliance footer appears 20px below the signature in 10px muted gray text.'}
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={put.isPending || !isDirty || addressEmpty}>
          Save compliance
        </Button>
        {isDirty && <p className="text-xs text-warning">Unsaved changes</p>}
      </div>
    </form>
  );
}
