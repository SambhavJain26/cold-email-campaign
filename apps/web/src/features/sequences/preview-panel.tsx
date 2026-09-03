import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLeads } from '@/api/queries/leads';
import { useCampaigns } from '@/api/queries/campaigns';
import { usePreviewSequence } from '@/api/mutations/sequences';
import { useDebounced } from '@/lib/use-debounced';
import type { DraftVariant } from './draft';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface PreviewTarget {
  stepNo: number;
  variant: DraftVariant | null;
}

export function previewRequirement(
  target: PreviewTarget | null,
  campaignId: number | null,
  leadId: number | null,
): string | null {
  if (target === null) return 'Choose Preview on a step card.';
  if (target.variant === null && campaignId === null) {
    return 'Choose a campaign context for this personalized step.';
  }
  if (target.variant !== null && target.variant.id === undefined) {
    return 'This variant is new — save the sequence before previewing it.';
  }
  if (leadId === null) return 'Pick a lead to render against.';
  return null;
}

const FOOTER_SEPARATOR = '\n\n';

/** The engine appends the CAN-SPAM footer after all expansion (docs/08 §4) — split
 *  at the final blank line so earlier message paragraphs remain untouched. */
export function splitFooter(body: string): { body: string; footer: string | null } {
  const index = body.lastIndexOf(FOOTER_SEPARATOR);
  if (index === -1) return { body, footer: null };
  return { body: body.slice(0, index), footer: body.slice(index + FOOTER_SEPARATOR.length) };
}

/** Convert the plain-text preview footer into the appearance used by the HTML
 *  alternative. The raw capability URL intentionally stays out of the UI. */
export function footerPreviewParts(footer: string): {
  optout: string;
  address: string;
  linked: boolean;
} {
  const [firstLine = '', ...addressLines] = footer.split('\n');
  const linked = firstLine.startsWith('Unsubscribe: ');
  return {
    optout: linked ? 'Unsubscribe' : firstLine,
    address: addressLines.join('\n'),
    linked,
  };
}

/** F4.4 — Preview & pre-send panel (docs/12 §5): lead picker → POST preview →
 *  rendered output with the locked footer block + the checklist verbatim. */
export function PreviewPanel({
  sequenceId,
  target,
  dirty,
}: {
  sequenceId: number | null;
  target: PreviewTarget | null;
  dirty: boolean;
}) {
  const [search, setSearch] = useState('');
  const [leadId, setLeadId] = useState<number | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const debouncedSearch = useDebounced(search, 300);
  const leads = useLeads({ per_page: 8, q: debouncedSearch === '' ? undefined : debouncedSearch });
  const campaigns = useCampaigns();
  const preview = usePreviewSequence(sequenceId ?? 0);

  const selectedLead = leads.data?.items.find((lead) => lead.id === leadId);
  const requirement = previewRequirement(target, campaignId, leadId);
  const canPreview = sequenceId !== null && requirement === null;

  const rendered = preview.data ? splitFooter(preview.data.body) : null;
  const renderedFooter = rendered?.footer ? footerPreviewParts(rendered.footer) : null;
  const checks = preview.data?.checks;

  return (
    <aside
      className="space-y-3 rounded-lg border border-border p-4"
      aria-label="Preview and pre-send checks"
      data-testid="preview-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Preview &amp; pre-send</h2>
        {target && (
          <span className="text-xs text-muted-foreground">
            Step {target.stepNo} ·{' '}
            {target.variant === null ? 'Personalized Copy' : `variant ${target.variant.label}`}
          </span>
        )}
      </div>

      {sequenceId === null ? (
        <p className="text-xs text-muted-foreground">
          Save the sequence first — the preview renders through the real engine, so it needs saved
          templates.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Campaign context</Label>
            <Select
              value={campaignId === null ? 'sequence-defaults' : String(campaignId)}
              onValueChange={(value) =>
                setCampaignId(value === 'sequence-defaults' ? null : Number(value))
              }
            >
              <SelectTrigger aria-label="Preview campaign context" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sequence-defaults">Sequence defaults</SelectItem>
                {(campaigns.data?.items ?? [])
                  .filter((campaign) => campaign.sequence_id === sequenceId)
                  .map((campaign) => (
                    <SelectItem key={campaign.id} value={String(campaign.id)}>
                      {campaign.name} · {campaign.status}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="preview-lead" className="text-xs">
              Lead
            </Label>
            <Input
              id="preview-lead"
              className="h-8"
              placeholder="Search leads by email, name, company"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="max-h-40 overflow-y-auto rounded-md border border-border">
              {(leads.data?.items ?? []).map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => setLeadId(lead.id)}
                  className={`flex w-full flex-col items-start px-2 py-1 text-left text-xs hover:bg-accent ${
                    lead.id === leadId ? 'bg-accent' : ''
                  }`}
                >
                  <span className="font-medium">{lead.email}</span>
                  <span className="text-muted-foreground">
                    {[lead.first_name, lead.company].filter(Boolean).join(' · ') || '—'}
                  </span>
                </button>
              ))}
              {leads.data?.items.length === 0 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">No leads match.</p>
              )}
            </div>
          </div>

          {dirty && (
            <p className="text-[11px] text-warning">
              Unsaved edits are not previewed — the render runs against the saved templates.
            </p>
          )}

          <Button
            size="sm"
            className="w-full"
            disabled={!canPreview || preview.isPending}
            onClick={() => {
              if (!canPreview || target === null || leadId === null) return;
              preview.mutate({
                lead_id: leadId,
                step_no: target.stepNo,
                ...(target.variant?.id !== undefined && { variant_id: target.variant.id }),
                ...(campaignId !== null && { campaign_id: campaignId }),
              });
            }}
          >
            {preview.isPending ? 'Rendering…' : 'Render preview'}
          </Button>
          {!canPreview && <p className="text-[11px] text-muted-foreground">{requirement}</p>}

          {preview.data && (
            <div className="space-y-3" data-testid="preview-result">
              {selectedLead && (
                <p className="text-[11px] text-muted-foreground">
                  Rendered for {selectedLead.email}
                </p>
              )}
              {preview.data.personalized_copy_status && (
                <Badge variant="outline">
                  Personalized copy · {preview.data.personalized_copy_status.replaceAll('_', ' ')}
                </Badge>
              )}
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Subject</p>
                <p
                  className="rounded-md border border-border px-2 py-1 text-xs"
                  data-testid="preview-subject"
                >
                  {preview.data.subject}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Body</p>
                <pre
                  className="rounded-md border border-border px-2 py-1 font-mono text-xs whitespace-pre-wrap"
                  data-testid="preview-body"
                >
                  {rendered?.body}
                </pre>
                {rendered?.footer !== null && rendered !== null && (
                  <div
                    className="rounded-md border border-dashed border-border bg-muted/40 px-2 py-1"
                    data-testid="preview-footer"
                  >
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Lock className="size-3" aria-hidden /> Appended to every send —{' '}
                      <Link to="/settings" className="underline">
                        edit in Compliance settings
                      </Link>
                    </p>
                    {renderedFooter && (
                      <div className="mt-5 font-mono text-[10px] leading-[15px] whitespace-pre-wrap text-[#595959]">
                        <span className={renderedFooter.linked ? 'text-[#1155cc] underline' : ''}>
                          {renderedFooter.optout}
                        </span>
                        <br />
                        <span>{renderedFooter.address}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {preview.data.resolution_trace && (
                <details className="rounded-md border border-border p-2 text-xs">
                  <summary className="cursor-pointer font-medium">Resolution details</summary>
                  <div className="mt-2 space-y-2 text-muted-foreground">
                    <p>
                      Rendering mode:{' '}
                      <span className="text-foreground">
                        {preview.data.resolution_trace.render_mode === 'template_researched'
                          ? 'Tier A · Researched'
                          : 'Tier B · Auto Observation'}
                      </span>
                    </p>
                    <p>
                      Observation: {preview.data.resolution_trace.observation.value || 'none'} ·
                      rule {preview.data.resolution_trace.observation.matched_rule ?? 'none'}
                    </p>
                    <dl className="space-y-1">
                      {Object.entries(preview.data.resolution_trace.lead_values).map(
                        ([key, value]) => (
                          <div key={key} className="flex justify-between gap-3">
                            <dt>{key}</dt>
                            <dd className="text-right text-foreground">{value || 'empty'}</dd>
                          </div>
                        ),
                      )}
                    </dl>
                    {Object.entries(preview.data.resolution_trace.sequence_variables).map(
                      ([key, item]) => (
                        <p key={key}>
                          sequence.{key} = <span className="text-foreground">{item.value}</span> (
                          {item.source})
                        </p>
                      ),
                    )}
                    {preview.data.resolution_trace.spintax_choices.map((choice, index) => (
                      <p key={`${choice.selected}-${index}`}>
                        Spintax chose <span className="text-foreground">{choice.selected}</span>{' '}
                        from {choice.options.join(' / ')}
                      </p>
                    ))}
                    {preview.data.resolution_trace.warnings.map((warning) => (
                      <p key={warning} className="text-warning">
                        {warning}
                      </p>
                    ))}
                  </div>
                </details>
              )}

              {checks && (
                <div className="space-y-1" data-testid="preview-checks">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        checks.fatal.length > 0
                          ? 'destructive'
                          : checks.warnings.length > 0
                            ? 'secondary'
                            : 'default'
                      }
                      className="tabular-nums"
                      data-testid="preview-score"
                    >
                      score {checks.score.toFixed(1)} / 10
                    </Badge>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {checks.variations} variations
                    </span>
                  </div>
                  {checks.fatal.map((item) => (
                    <p
                      key={item.id}
                      role="alert"
                      className="flex items-start gap-1 text-[11px] text-destructive"
                    >
                      <XCircle className="mt-px size-3 shrink-0" aria-hidden /> {item.message}
                    </p>
                  ))}
                  {checks.warnings.map((item) => (
                    <p key={item.id} className="flex items-start gap-1 text-[11px] text-warning">
                      <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden /> {item.message}
                    </p>
                  ))}
                  {checks.fatal.length === 0 && checks.warnings.length === 0 && (
                    <p className="flex items-center gap-1 text-[11px] text-success">
                      <CheckCircle2 className="size-3" aria-hidden /> All pre-send checks pass.
                    </p>
                  )}
                  {checks.fatal.length > 0 && (
                    <p className="text-[11px] text-destructive">
                      Fatal checks block the send — this variant will not go out until they are
                      fixed.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
