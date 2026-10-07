# Render Engine Spec — Merge Tags, Spintax, Compliance Footer, Pre-send Checks

> **Migration 0019 overlay:** Template steps continue through this renderer. Personalized steps
> use literal ready subject/body from the campaign-step snapshot, then run the shared footer and
> checks. The Personalized Copy editor previews but never sends; old Manual Compose paths are
> retired with `410 Gone`. See [docs/22](22-personalized-copy-two-tier.md).

Implements walkthrough Stage 4 + spec Part 8. Lives in `apps/server/src/render/`. Pure functions except the settings read; fully snapshot-testable. The renderer is the **only** producer of template-step outbound bodies; personalized-step literal content joins the same footer/check pipeline in the scheduler and preview service.

---

## 1. Pipeline

```
render(variant, lead, enrollment, opts) → { subject, bodyText, checks }
  1. resolve slots        // {{custom_observation}} source depends on personalization_mode (§3)
  2. expand merge tags    // §2
  3. expand spintax       // §2, seeded by (enrollment_id, step_no, variant_id) → deterministic per send
  4. append footer        // §4 — unconditional, last, cannot be skipped
  5. run pre-send checks  // §5 (preview mode only; send path asserts the fatal ones)
```

Output is matching plain text plus minimal escaped HTML (`multipart/alternative` in SMTP). The HTML
exists only to preserve natural paragraph spacing and link the unsubscribe word; it contains no
images, tracking, external CSS, or arbitrary template HTML. Subject gets steps 1–3 only (no footer).

## 2. Template grammar

```
merge-tag  := '{{' field ('|' fallback)? '}}'
spintax    := '{{RANDOM|' option ('|' option)+ '}}'
field      := first_name | company | market | custom_observation
            | sender_physical_address | any key of leads.custom_fields
```

- **Fallback rule:** `{{first_name|there}}` renders the field if non-empty after trim, else the fallback literal. A tag with no fallback whose field is empty = **fatal check failure** (blocks send).
- `{{market|US}}`: resolves from `lead.state` → state name, else fallback.
- `{{sender_physical_address}}`: always resolves from `compliance_settings.physical_address` (never lead data).
- **Spintax:** uniform pick, one per tag per render. Seed = `fnv1a(enrollmentId + ':' + stepNo + ':' + variantId)` so retries of the same send render identically (a soft-bounce retry must resend the *same* text) and tests are deterministic.
- **Variation count** (pre-send check "24 unique variations") = Π option-counts across all spintax tags in subject+body.
- Escaping: `\{\{` renders literal braces. Unknown field with no fallback = fatal. Nested tags unsupported (parse error = fatal).
- Parser: single-pass regex tokenizer + validator `parseTemplate(str) → {tokens, errors}`; exported separately for the Sequence-Builder live validation endpoint.

## 3. Current content sources and tier modes

Sequence steps choose the content source; tier does not choose whether the email is personalized:

| Step source / enrollment mode | Content source | Send path |
|---|---|---|
| `personalized` | Ready subject/body from the exact lead + campaign + stable sequence-step snapshot. It is literal: merge tags and spintax are not reinterpreted. | scheduler only; direct Manual Compose sending is retired |
| `template` + `template_researched` (Tier A) | `leads.custom_fields.custom_observation`; empty values retain the existing Auto Observation fallback warning behavior. | scheduler |
| `template` + `template_auto` (Tier B) | Campaign chooses one standard/custom lead field and an exact-match rule table with a required `default`; keys are trim/case-fold matched. | scheduler |

Untiered and Nurture leads cannot enroll. Historical `human_written`, Tier C, and Nurture-tier
snapshots remain readable but cannot be selected for new work. The sequence preview derives Tier A
or Tier B behavior from the selected lead when a campaign context is selected. Personalized steps
preview the exact campaign-step copy and its readiness through the same literal footer/check path.

Reusable non-lead variables use `{{sequence.key|fallback}}`. Defaults live on the sequence; a
draft campaign may override them, and first activation freezes the resolved snapshot. Values are
literal and are never recursively parsed as tags or spintax. Campaign-context preview reports the
matched observation rule, resolved variable source, fallbacks, and deterministic spintax choices.

## 4. Sender signature and optional postal address (2026-10-07 operator revision)

Global `compliance_settings.email_format` defaults to `plain_text`: send only `text/plain`, with
no HTML alternative or styling. `minimal_html` retains both MIME alternatives and the styling
below. The default role is `Property Management Automation Specialist`. Terminal `Best,` signoffs,
including a legacy name line, are replaced by one automatic signoff. One blank line separates
body and signature; no blank lines separate the four signature lines. Internal body whitespace
is preserved. The automatic opt-out wording/link is removed; the operator supplies the instruction
in campaign copy. Legacy stored opt-out configuration remains readable.
Sequence previews display the complete text representation, including all appended content.
Every new sent snapshot records its format; retries reuse complete saved bodies and format.
Legacy HTML snapshots remain HTML, and legacy template retries without snapshots retain their
existing rendering fallback.

```text
Best,
{signature_name}
{signature_role_line}
{sending mailbox domain}
```

`include_postal_address` defaults to false. When enabled, use:

```text
Best,
{signature_name}
{signature_role_line} | {sending mailbox domain}
{compliance_settings.physical_address}
```

- Appended at render time after expansion. Name, role and address remain editable. Migration 0026 starts the toggle off, updates the previous default role, and retains the address and custom role wording.
- The domain comes from the actual sending mailbox. Previews without a mailbox show an explicit placeholder. HTML escapes identity/address and uses the same four lines without an automatic body link.
- Minimal HTML retains explicit paragraph margins and 16px paragraph gaps, followed by the signature and adjacent address. Email clients may independently link domains or trim signatures.
- A blank address blocks saving/rendering/sending only when Include postal address is on. Hiding the address retains its saved value. Existing body content, sent messages and retry snapshots remain unchanged.

## 5. Pre-send checks + deliverability score (decision W)

`checks` returns `{ fatal: Check[], warnings: Check[], score: number, variations: number }`.

| # | Check | Class |
|---|-------|-------|
| 1 | All merge tags parse; unknown/no-fallback empty fields | **fatal** |
| 2 | Spintax valid (≥2 options, no nesting); report variation count | fatal if invalid |
| 3 | Step 1 contains no URLs (`https?://` or `www.`) | fatal for step 1 (walkthrough rule), warning for later steps |
| 4 | Visible signature address is non-empty | **fatal** when address inclusion is enabled |
| 5 | No HTML tags / no image markup | fatal |
| 6 | Template body duplicates the visible postal address | warning when address inclusion is enabled |
| 7 | Subject ≤ 60 chars (post-expansion, longest spintax branch) | warning |
| 8 | Body 40–180 words | warning |
| 9 | Spam-trigger lexicon (data file `render/spamwords.ts`: "free!!!", "guarantee", "act now", "risk-free", "100% free", "click here", ALL-CAPS words > 2, > 1 exclamation mark) | warning each |
| 10 | Personalization present: ≥1 lead-specific tag (`first_name`/`company`/`custom_observation`) | warning |

**Score rubric:** start 10.0; −2.0 per fatal (preview display only — fatals block sending anyway); −0.4 per warning #6–#10 hit (max −0.8 per check); −0.3 per spam-lexicon hit beyond the first. Clamp [0,10], one decimal. Deterministic → snapshot-tested. The walkthrough's "9.1/10" is a display of this number.

## 6. Threading headers (with docs/07 §4)

`render` returns text and, only in `minimal_html` mode, an HTML alternative. The scheduler retains Message-ID, conversation-scoped In-Reply-To/References and From headers. Configured unsubscribe URLs still produce both RFC 8058 headers, never a body link. Inbound explicit opt-out detection remains globally suppressive. Saved retries retain their exact text/HTML bodies and format. Legacy retry header URLs are recovered from their saved body link; new bodies without that link receive a fresh configured header token on retry. Raw tokens are not persisted separately.

## 7. Tests (B4)

Snapshot renders (full matrix: lead-with-everything, missing first_name, missing company, missing custom_observation); footer-always-present including adversarial template; first-paragraph margin and intentional paragraph gaps; seed determinism (same enrollment/step/variant twice → identical output; different enrollment → different spintax pick eventually); variation count exact (walkthrough opener = 2×3×2×2 = 24); every check's positive+negative case; score rubric snapshots; literal Personalized Copy gets footer + checks; threading headers correct for step 1 vs steps 2+.
