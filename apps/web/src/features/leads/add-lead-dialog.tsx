import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { createLeadBodySchema, type CreateLeadBody } from '@coldemail/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateLead } from '@/api/mutations/leads';

/**
 * Finding 10 — adding one lead used to mean hand-writing a CSV. This posts to
 * the route that runs the same ingest path, so a refusal here is the ordinary
 * hygiene outcome and gets explained rather than thrown.
 */
const REFUSAL: Record<string, string> = {
  invalid: 'That is not a valid email address.',
  duplicate: 'That lead already exists.',
  suppressed: 'That address is suppressed — it opted out or hard-bounced, and cannot be re-added.',
  role_based:
    'Role-based addresses (info@, sales@, support@…) are refused, the same as in a CSV import.',
};

export function AddLeadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateLead();
  const [refusal, setRefusal] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateLeadBody>({ resolver: zodResolver(createLeadBodySchema) });

  const close = (next: boolean) => {
    if (!next) {
      reset();
      setRefusal(null);
    }
    onOpenChange(next);
  };

  const onSubmit = (body: CreateLeadBody) => {
    setRefusal(null);
    create.mutate(body, {
      onSuccess: (result) => {
        if (result.created) {
          toast.success('Lead added');
          close(false);
          return;
        }
        setRefusal(
          REFUSAL[result.reason ?? 'invalid'] ?? 'The lead was refused by import hygiene.',
        );
      },
    });
  };

  const field = (name: keyof CreateLeadBody, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`add-lead-${name}`}>{label}</Label>
      <Input id={`add-lead-${name}`} {...register(name)} />
      {errors[name] && <p className="text-xs text-destructive">{errors[name]?.message}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a lead</DialogTitle>
          <DialogDescription>
            Runs the same hygiene, dedup and suppression checks as a CSV import — this is a one-row
            import, not a shortcut around them.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          {field('email', 'Email')}
          <div className="grid grid-cols-2 gap-3">
            {field('first_name', 'First name')}
            {field('company', 'Company')}
            {field('city', 'City')}
            {field('state', 'State')}
          </div>
          {refusal && (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {refusal}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add lead'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
