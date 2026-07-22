// Decision Q: content_hash = sha256(subject_template + '\0' + body_template),
// computed at variant-SAVE time over the templates - never the rendered
// output, so spintax can't smuggle a "different" copy past the recycle guard.
import { createHash } from 'node:crypto';

export function contentHashOf(subjectTemplate: string, bodyTemplate: string): string {
  return createHash('sha256')
    .update(subjectTemplate + '\0' + bodyTemplate, 'utf8')
    .digest('hex');
}
