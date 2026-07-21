# Render Engine Spec — Merge Tags, Spintax, Compliance Footer, Pre-send Checks

Implements walkthrough Stage 4 + spec Part 8. Lives in `apps/server/src/render/`. Pure functions except the settings read; fully snapshot-testable. The renderer is the **only** producer of outbound message bodies — the scheduler, the preview endpoint, and the manual composer all call it.

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

Output is **plain text only** (walkthrough: no images, no HTML). Subject gets steps 1–3 only (no footer).

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

## 3. Personalization modes (walkthrough Stage 4, corrected two-mode model)

| Mode (`enrollments.personalization_mode`) | `{{custom_observation}}` source | Send path |
|---|---|---|
| `human_written` (Mode 1, Tier A) | Whole email is bespoke: the **manual composer** submits final subject+body per lead. Stored as a one-off variant (`step_variants` row flagged `attributes.bespoke=true` — hash still computed, recycle guard still applies). Follow-ups may fall back to templates. | `POST /manual-sends` → same render pipeline with steps 1–3 skipped (already literal), footer + checks still applied |
| `template_researched` (Mode 2a, Tier B) | `leads.custom_fields.custom_observation` — filled per lead by the operator (Leads screen inline edit). Empty → falls back to segment rule (below) + warning check | scheduler |
| `template_auto` (Mode 2b, Tier C) | Segment rule: market-keyed lookup table in `campaigns.tier_effort_config.auto_observations` (e.g. `{"TX": "your listings move fast in Texas", "default": "..."}` ) | scheduler |

## 4. CAN-SPAM footer (spec Part 8 — non-removable)

```
\n\n---\n{compliance_settings.physical_address}\n{compliance_settings.optout_text}
```

- Appended at render time, **after** all expansion; template text cannot alter or remove it (a template containing its own footer text just gets the canonical one appended anyway — check #6 warns on duplication).
- Fatal boot/send guard: `physical_address` empty → sends are refused globally, alert raised (CAN-SPAM requires it; empty address = non-compliant mail).

## 5. Pre-send checks + deliverability score (decision W)

`checks` returns `{ fatal: Check[], warnings: Check[], score: number, variations: number }`.

| # | Check | Class |
|---|-------|-------|
| 1 | All merge tags parse; unknown/no-fallback empty fields | **fatal** |
| 2 | Spintax valid (≥2 options, no nesting); report variation count | fatal if invalid |
| 3 | Step 1 contains no URLs (`https?://` or `www.`) | fatal for step 1 (walkthrough rule), warning for later steps |
| 4 | Footer present with non-empty address + opt-out text | **fatal** |
| 5 | No HTML tags / no image markup | fatal |
| 6 | Template body duplicates opt-out/footer text | warning |
| 7 | Subject ≤ 60 chars (post-expansion, longest spintax branch) | warning |
| 8 | Body 40–180 words | warning |
| 9 | Spam-trigger lexicon (data file `render/spamwords.ts`: "free!!!", "guarantee", "act now", "risk-free", "100% free", "click here", ALL-CAPS words > 2, > 1 exclamation mark) | warning each |
| 10 | Personalization present: ≥1 lead-specific tag (`first_name`/`company`/`custom_observation`) | warning |

**Score rubric:** start 10.0; −2.0 per fatal (preview display only — fatals block sending anyway); −0.4 per warning #6–#10 hit (max −0.8 per check); −0.3 per spam-lexicon hit beyond the first. Clamp [0,10], one decimal. Deterministic → snapshot-tested. The walkthrough's "9.1/10" is a display of this number.

## 6. Threading headers (with docs/07 §4)

`render` returns text; the scheduler's `buildMime` adds: `Message-ID` (app-generated), `In-Reply-To`/`References` for in-thread steps, `Re: `-prefixed step-1 subject for follow-ups, `From: {display_name} <{from_address}>`. No `List-Unsubscribe` header (plain-text opt-out is the finalized mechanism; header can be added in B8 if providers reward it — noted as a B8 tuning option).

## 7. Tests (B4)

Snapshot renders (full matrix: lead-with-everything, missing first_name, missing company, missing custom_observation × 3 modes); footer-always-present including adversarial template; seed determinism (same enrollment/step/variant twice → identical output; different enrollment → different spintax pick eventually); variation count exact (walkthrough opener = 2×3×2×2 = 24); every check's positive+negative case; score rubric snapshots; manual-compose path gets footer + checks; threading headers correct for step 1 vs steps 2+.
