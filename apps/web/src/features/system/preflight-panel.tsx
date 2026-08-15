import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { usePreflight } from '@/api/queries/system';

/**
 * Domain-readiness preflight (docs/16 §8 item 3). Deliberately blunt about its
 * own limits: "ready" here means no check failed, NOT that sending is safe.
 * Warming, list quality and consent are invisible to it.
 */
const STYLE: Record<string, { chip: string; label: string }> = {
  pass: { chip: 'bg-success/15 text-success', label: 'PASS' },
  warn: { chip: 'bg-warning/15 text-warning', label: 'WARN' },
  fail: { chip: 'bg-destructive/15 text-destructive', label: 'FAIL' },
  unknown: { chip: 'bg-muted text-muted-foreground', label: 'UNKNOWN' },
};

export function PreflightPanel() {
  const { data, isPending, isError, refetch, isFetching } = usePreflight();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm">Domain readiness</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Checks what is checkable: DNS per sending domain, plus compliance and caps. It cannot
            see warming, list quality or consent — <strong>ready is not the same as safe</strong>.
          </p>
        </div>
        <Button size="xs" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? 'Checking…' : 'Re-check'}
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : isError ? (
          <EmptyState
            title="Preflight failed to run"
            description="Could not reach the readiness check."
          />
        ) : (
          <>
            <div
              className={`mb-3 rounded-md px-3 py-2 text-xs ${
                data.ready ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
              }`}
              data-testid="preflight-verdict"
            >
              {data.ready
                ? 'No blocking failures. Warnings below are still your call.'
                : 'Not launch-ready — at least one check failed.'}
            </div>
            <ul className="space-y-1.5" data-testid="preflight-checks">
              {data.checks.map((check) => {
                const style = STYLE[check.status] ?? STYLE.unknown!;
                return (
                  <li
                    key={check.id}
                    className="flex items-start gap-3 rounded-md border border-border/60 px-3 py-2"
                    data-testid={`preflight-${check.id}`}
                  >
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${style.chip}`}
                    >
                      {style.label}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{check.label}</div>
                      <div className="text-xs text-muted-foreground">{check.detail}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
