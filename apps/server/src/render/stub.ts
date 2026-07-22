// B3's Renderer: deterministic canned content. The real engine (merge tags,
// spintax, footer, threading subjects — docs/08) replaces this at B4; the B4
// gate requires golden L3 to stay green across the swap.
import type { Renderer, RenderInput, RenderedMessage } from '../scheduler/types';

export class StubRenderer implements Renderer {
  render(input: RenderInput): RenderedMessage {
    const { variant, step, lead } = input;
    const first = lead.firstName ?? 'there';
    return {
      subject:
        step.stepNo === 1
          ? `Quick question about ${lead.company ?? 'your listings'}`
          : `Re: Quick question about ${lead.company ?? 'your listings'}`,
      bodyText: `Hi ${first},\n\n[stub body — step ${step.stepNo}, variant ${variant.label}]\n`,
      contentHash: variant.contentHash,
    };
  }
}
