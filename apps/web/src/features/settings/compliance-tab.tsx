import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { complianceSchema, type ComplianceDto } from '@coldemail/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePutCompliance } from '@/api/mutations/settings';

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
  const optout = useWatch({ control, name: 'optout_text' });
  const addressEmpty = address.trim() === '';

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
          <CardTitle className="text-sm">Footer content</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
            {errors.optout_text && (
              <p className="text-xs text-destructive">{errors.optout_text.message}</p>
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
            className="rounded-md border border-dashed border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
            data-testid="footer-preview"
          >
            {`—\n${address || '⟨no address — sends blocked⟩'}\n${optout}`}
          </div>
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
