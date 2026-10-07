import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { complianceSchema, type ComplianceDto } from '@coldemail/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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

/** Sender signature editor. A visible postal address must be non-empty. */
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
    defaultValues: {
      ...compliance,
      include_postal_address: compliance.include_postal_address ?? false,
    },
  });

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const address = useWatch({ control, name: 'physical_address' });
  const emailFormat = useWatch({ control, name: 'email_format' });
  const signatureName = useWatch({ control, name: 'signature_name' });
  const signatureRoleLine = useWatch({ control, name: 'signature_role_line' });
  const includeAddress = useWatch({ control, name: 'include_postal_address' });
  const addressEmpty = Boolean(includeAddress) && address.trim() === '';
  const preview = includeAddress
    ? `Best,\n${signatureName}\n${signatureRoleLine} | [sending mailbox domain]\n${address || '⟨no address — sends blocked⟩'}`
    : `Best,\n${signatureName}\n${signatureRoleLine}\n[sending mailbox domain]`;

  const onSubmit = (body: ComplianceDto) =>
    put.mutate(body, {
      onSuccess: (saved) => {
        toast.success('Sender signature saved');
        reset(saved);
      },
    });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {addressEmpty && (
        <Alert className="border-destructive/50 text-destructive" data-testid="empty-address-block">
          <AlertTitle>Sending is blocked without a physical address</AlertTitle>
          <AlertDescription>
            Enter an address or turn off Include postal address before saving.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Sender signature</CardTitle>
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
                The sending mailbox domain follows the role on its own line when the address is
                hidden.
              </p>
            </Field>
          </FieldGroup>
          <Controller
            control={control}
            name="include_postal_address"
            render={({ field }) => (
              <div className="flex items-center gap-3">
                <Switch
                  id="include-postal-address"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
                <Label htmlFor="include-postal-address">Include postal address</Label>
              </div>
            )}
          />
          <div className="space-y-1">
            <Label htmlFor="compliance-address">Physical address</Label>
            <Controller
              control={control}
              name="physical_address"
              render={({ field }) => <Textarea id="compliance-address" rows={2} {...field} />}
            />
            {errors.physical_address && (
              <p className="text-xs text-destructive">{errors.physical_address.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Your saved address is retained when hidden.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="compliance-unsub-url">Unsubscribe base URL</Label>
            <Input
              id="compliance-unsub-url"
              placeholder="https://unsubscribe.{sender_domain}"
              {...register('unsubscribe_base_url')}
            />
            <p className="text-xs text-muted-foreground">
              This configures unsubscribe headers only. It does not append wording or a link to the
              body. Blank means no
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
              <pre className="font-mono text-xs whitespace-pre-wrap break-words">{preview}</pre>
            ) : (
              <>
                <div className="font-mono text-xs">
                  Best,
                  <br />
                  {signatureName}
                  <br />
                  {signatureRoleLine}
                  {includeAddress ? ' | [sending mailbox domain]' : ''}
                  <br />
                  <span className="whitespace-pre-wrap">
                    {includeAddress
                      ? address || '⟨no address — sends blocked⟩'
                      : '[sending mailbox domain]'}
                  </span>
                </div>
              </>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            All signature lines are adjacent. Include your opt-out instruction in each email body.
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
