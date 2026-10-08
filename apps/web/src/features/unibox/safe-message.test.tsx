import { it, expect } from 'vitest';
import { sanitizeIncomingHtml, isolatedMessageDocument } from './safe-message';
it('strips all active content and external resource loading while preserving readable structure', () => {
  const result = sanitizeIncomingHtml(
    '<p>Hello<br>Next paragraph</p><script>alert(1)</script><img src="https://evil.test/pixel"><svg onload="alert(1)"></svg><style>@import "https://evil.test/font";</style><form><input></form><iframe src="https://evil.test"></iframe><p style="background:url(https://evil.test)">Readable</p><a href="javascript:alert(1)">Unsafe</a><a href="https://example.com">Open deliberately</a><blockquote>Old history</blockquote>',
  );
  expect(result.html).toContain('Hello<br>Next paragraph');
  expect(result.html).toContain('Readable');
  expect(result.html).not.toMatch(
    /<script|<img|<svg|<form|<input|<iframe|style=|javascript:|evil\.test/,
  );
  expect(result.quoted).toContain('Old history');
  expect(result.html).not.toContain('Old history');
  expect(result.html).toContain('noopener noreferrer');
  expect(isolatedMessageDocument(result.html)).toContain("default-src 'none'");
});
