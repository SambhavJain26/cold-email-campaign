# Frontend Build Stages - F0-F8 (task level)

The frontend track. Buildable against MSW mocks from F0 (needs only the frozen contract, docs/10, + golden fixtures from B2.18). Each stage lists its **integration point** - the backend stage after which the screens run against the real API. Task IDs mirrored in [PROGRESS.md](../PROGRESS.md).

**Screen specs:** [12-frontend-screens.md](12-frontend-screens.md). **Conventions:** [11-frontend-architecture.md](11-frontend-architecture.md).

---

## F0 - Foundation *(needs: contract + B2.18 fixtures)*

F0.1 Vite+React+TS scaffold in `apps/web`; Tailwind; shadcn init + base primitives · F0.2 `api/client.ts` (envelope, 401 redirect, zod parse) · F0.3 TanStack Query setup + query/mutation file skeletons per route group · F0.4 MSW: handlers for the full contract over golden fixtures; mutation state-mutation; failure-fixture toggle (11 §4) · F0.5 Router + route table + auth guard · F0.6 shared components: MetricStat, TierBadge, StateBadge, SentimentTag, DataTable, EmptyState, Sparkline, CapacityMeter, ConfirmTypedDialog, ProgressBar · F0.7 Playwright wiring (mock mode) + CI job.

**Gate:** app boots in mock mode; login-guarded blank shell; component tests for shared pieces green.

## F1 - Shell & auth *(integration: B6.1)*

F1.1 Login screen · F1.2 AppShell: SideNav (9+System entries), TopBar with campaign selector (URL-synced) + transport-mode chip · F1.3 AlertsBell + alerts panel + per-kind rendering + ack · F1.4 toasts, skeletons, error conventions applied · F1.5 e2e: login → navigate all empty screens.

## F2 - Mailboxes & Settings *(integration: B6.2, B6.10)*

F2.1 Mailboxes table + totals row + status chips · F2.2 Add/Edit dialog + Test Connection inline result · F2.3 Failure panels: auth_failed reconnect, imap_stale retry, auto_paused detail + resume-at-50% (12 §4) · F2.4 Volume trend chart + imbalance banner · F2.5 Settings/Rules tab (all knobs incl. optout radio) · F2.6 Compliance tab: footer editor + live preview + empty-address block · F2.7 Account tab · F2.8 e2e: add mailbox → failure fixtures → panels render+actions.

## F3 - Leads & Import *(integration: B6.3, B6.4)*

F3.1 Leads table + filters + tier-distribution header + untiered banner · F3.2 Bulk-tier bar (ids + all-matching-filter) · F3.3 Lead detail: profile, editable tier/notes/custom_observation, event timeline · F3.4 Suppression banner + typed-confirm removal · F3.5 Import wizard (3 steps, exact preview panel) · F3.6 e2e: import fixture CSV → 885 split → commit → bulk-tier.

*Milestone M2 (with B6): F0-F3 running against the real API.*

## F4 - Sequences *(integration: B6.5)*

F4.1 Sequence list · F4.2 Builder: steps, waits, in-thread, stop conditions · F4.3 Variant tabs + template editor + live validation chips (debounced validate-template) · F4.4 Preview panel: lead picker, rendered output, locked footer block, pre-send checklist + score · F4.5 e2e: build walkthrough sequence → 24 variations → fatal link-in-step-1 → fix → save.

## F5 - Campaigns & Overview *(integration: B6.6, B6.9-overview)*

F5.1 Campaign list + create/edit + config editors · F5.2 Detail: capacity meter card + enroll action + state breakdown · F5.3 Completion panel (outcomes-sum-✓ + rates block + CTAs) · F5.4 Overview screen: progress, 5 metric tiles, TODAY panel + enroll, watch banners · F5.5 Catch-up notice banner (12 §12) · F5.6 e2e: create → enroll 20 → capacity math asserts.

## F6 - Unibox *(integration: B6.7, B6.8)*

F6.1 Feed + tabs (human/auto-reply) + sentiment filters · F6.2 Reply card: tag row (optimistic), suggested-tag display, meeting-booked, snooze, auto-unsub caption · F6.3 Thread view · F6.4 Manual composer dialog (Mode 1, 12 §14) · F6.5 tag_only-mode unsubscribe button variant · F6.6 e2e: tag → overview positive-rate updates; book meeting; STOP card shows auto-unsub.

## F7 - Analytics & Cold Storage *(integration: B6.9, B6.6)*

F7.1 Variants tab + deactivate flow · F7.2 Steps tab + verdict chips + reconciliation footer · F7.3 Tiers tab + promote action · F7.4 Health tab: sparklines + watch rules · F7.5 Cold Storage screen + recycle dialog + hash-conflict handling · F7.6 e2e: 13a-13d numbers match golden fixtures; recycle guard message.

## F8 - System screens & full replay *(integration: B6.12; closes with B7)*

F8.1 Reply-detection debug table · F8.2 Job status panel + rebuild dry-run dialog · F8.3 accessibility & keyboard pass on Unibox + builder (the two high-interaction screens) · F8.4 empty/error state sweep across all screens · F8.5 **the full walkthrough-replay e2e** (13 §5) against real backend + MockTransport, green in CI.

*Milestone M3 (with B7): full product, offline, e2e-proven.*

---

## Dependency matrix (what unblocks what)

| Frontend stage | Hard dependency | Integrates after |
|---|---|---|
| F0, F1 | contract (docs/10) + B2.18 fixtures | B6.1 (auth only) |
| F2 | F1 | B6.2 + B6.10 |
| F3 | F1 | B6.3 + B6.4 |
| F4 | F1 | B6.5 (+B4 for true previews) |
| F5 | F1 | B6.6 (+B3 numbers) |
| F6 | F1 | B6.7/.8 (+B3 poller) |
| F7 | F5 | B6.9 (+B2) |
| F8 | F2-F7 | B6.12, B7 |

**Recommended solo order** (one keyboard, minimal thrash): B0→B1→B2 (+B2.18) → B3 → B4 → B5 → B6 → F0→F1→…→F8 (backend fixes inline as integration surfaces them) → B7 → B8.
**Two-person split:** dev A runs B-track; dev B starts F0 the moment B2.18 lands and tracks the matrix above.
