import type { Sentiment } from '@coldemail/shared';
import { cn } from '@/lib/utils';

/** Unibox tag row vocabulary (docs/12 §13): 🟢 positive · ⚪ neutral · 🔴 negative. */
const GLYPH: Record<Sentiment, string> = {
  positive: '🟢',
  neutral: '⚪',
  negative: '🔴',
};

export function SentimentTag({
  sentiment,
  suggested = false,
  className,
}: {
  sentiment: Sentiment;
  /** Greyed "AI-assisted" display for suggested-not-yet-confirmed tags. */
  suggested?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium capitalize',
        suggested && 'opacity-60',
        className,
      )}
      data-sentiment={sentiment}
      data-suggested={suggested || undefined}
    >
      <span aria-hidden>{GLYPH[sentiment]}</span>
      {sentiment}
      {suggested && (
        <span className="text-[10px] normal-case text-muted-foreground">(AI-assisted)</span>
      )}
    </span>
  );
}
