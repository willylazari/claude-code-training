# SPEC · NWP-201 — Issue virtual cards from the console

> Written before any code. Generated with `/spec`, then edited by a human.
> Load it as context when you build: `@docs/specs/NWP-201-issue-cards.md`

**Ticket:** [NWP-201](../tickets/NWP-201.md)
**Author:** Willy Lazari
**Status:** done

## Problem

Ops issues virtual cards by messaging the platform team, who create them by hand. It takes hours, happens twelve to twenty times a week, and last month two cards were created with the wrong spend limit because the request lived in a Slack thread. Ops needs to issue a card themselves, see the cards they have issued, and open one to check it.

## Current state

Every claim below was checked against the code. Cards do not exist anywhere yet; `merchant-console/CLAUDE.md` says so in its layout table, and `.claude/rules/cards.md` already holds the rules for when they do.

- `src/data/types.ts` — `Merchant` (id, name, country, IANA `timezone`, `currency`, `riskTier`), `Currency = "USD" | "EUR" | "GBP"`. No card type.
- `src/data/store.ts` — the in-memory store: `merchants`, `payments`, `refunds`, `disputes`, `payouts`, built once by `generate()` and parked on `globalThis` outside production. Cards go here, the same way.
- `src/data/generate.ts` — deterministic seed (`mulberry32(20260813)`), ids like `pay_000001` via `pad()`, everything anchored to `GENERATED_AT`. Seed cards belong here so every machine gets the same list.
- `src/data/merchants.ts` — ten fictional merchants; `merchantById()`. Two are `riskTier: "elevated"`, three settle in EUR or GBP. The codebase knows a merchant's currency and risk; the ticket does not mention either.
- `src/data/queries.ts:18-36` — `parseFilters` is the allowlist pattern: read the param, check it against a fixed list, fall back to a safe default. Route handlers call a parser rather than reading input themselves.
- `src/app/api/payments/route.ts` — the shape of a route handler: parse, query, `NextResponse.json`. No error response exists yet in the API.
- `src/lib/money.ts` — `formatMoney` (the only place a decimal point appears), `parseAmountToMinorUnits` (boundary parser for typed input like `250.00`), `sumMinorUnits`. Spend limits use these; no new formatter.
- `src/lib/dates.ts` — `formatDate` (UTC, tables), `formatInZone` (merchant timezone, detail pages). Created dates use these.
- `src/app/payments/page.tsx` and `src/app/payments/[id]/page.tsx` — the list and detail patterns: server components, `Table*` primitives, `StatusBadge`, a `Field` dl on detail, `notFound()` for an unknown id, `← All payments` back link.
- `src/components/ui/payments/StatusBadge.tsx` — one badge for every status enum in the app (`LABELS`, `DOTS`, `VARIANTS`). Card statuses extend it rather than getting a second badge.
- `src/components/Drawer.tsx` — the accessible overlay (Radix Dialog): title, description, body, footer, close. The issue form lives in one. There is no `Dialog.tsx`, `Checkbox`, or `RadioGroup` primitive; `Input`, `Select`, `Button`, `Badge`, `Divider` exist.
- `src/components/ui/navigation/AppSidebar.tsx`, `Breadcrumbs.tsx`, `src/app/siteConfig.ts` — navigation is three lists that must all learn the new route.
- `src/lib/*.test.ts` — Vitest, plain Node, one `describe` per function, comments that say why the test exists. `vitest.config.ts` collects only `src/**/*.test.ts`.

Where the ticket does not match the code:

- The ticket says "Store the last four and the generated number's reference". Nothing in the codebase defines a reference; this spec defines it as an opaque `pan_` id that cannot be turned back into the number.
- The ticket allows any of `USD`, `EUR`, `GBP`. The codebase knows each merchant settles in exactly one of them. A card in another currency is almost certainly the wrong-currency mistake the ticket's reporter is describing, so the server rejects a mismatch and the form defaults to the merchant's currency.

## Domain rules

| Rule | Source | What breaks if ignored |
| --- | --- | --- |
| "Money is integer minor units. A `$250.00` limit is `25000`. Never a float, never a string with a dollar sign." | ticket rule 1, `CLAUDE.md` convention 1, `money.md` | Limits drift or compare wrong; the exact bug the ticket cites |
| "Never persist or display a full card number after creation. Store the last four and the generated number's reference." | ticket rule 2, `cards.md` "Reveal once", `api-routes.md` | A card number in a list payload or a re-readable field |
| "`active → frozen → active`, and either can go to `cancelled`. `cancelled` is terminal." | ticket rule 3, `cards.md` "Status is a state machine. Guard the transition on the server" | A cancelled card coming back, or a transition only the UI enforces |
| "Every generated number starts `4242` and carries a valid Luhn check digit." | ticket rule 4, `cards.md` "Test BIN only", root `CLAUDE.md` | Something in the repo resembling a real PAN |
| "Generate on the server. A card number produced in the browser is a bug." | `cards.md` | Client-side generation |
| "Validate everything from the client against an allowlist before it reaches the store" | `api-routes.md`, ORG-STANDARDS #7 | A missing merchant, a negative limit, or a made-up currency reaching the store |
| "Use what is here… Dialogs and forms must be operable" | `components.md` | A hand-rolled overlay, an input without a label |
| "Do not add a database, an ORM, or a migration" | ticket out of scope, `CLAUDE.md` | Lost time, zero points |

## Approach

Cards become a fifth collection in the in-memory store with a small pure library beside the money and date helpers. `src/lib/cards.ts` holds what has no state: the Luhn check digit, number generation on the `4242` BIN from an injected random source, masking, and the status state machine as a transition table. `src/data/cards.ts` holds what touches the store: the input parser (allowlist and range checks, one error per field), `issueCard`, `listCards`, `cardById`, `transitionCard`, and an idempotency map so a double-submitted form yields one card. The card record stores `last4` and an opaque `numberRef`; the full number exists only in the `POST` response.

Three route handlers under `src/app/api/cards/` follow the payments handler shape and return one error shape, `{ error, fields? }`, with a status that means what it says: 400 for bad input, 404 for an unknown card, 409 for an illegal transition. Pages are server components in the payments style: `/cards` lists every card with a written empty state; `/cards/[id]` shows the full record, spend against the limit as an integer percentage with a bar that turns amber at 80, the category lock, the merchant's timezone, and an audit trail of what happened to the card and when. Two client components do the interactive parts: an issue drawer (form, then a one-time reveal screen whose state is cleared on close) and freeze/unfreeze/cancel buttons that call the status route and `router.refresh()`, so the list updates without a full reload. Seed data gets a handful of deterministic cards with spend, so the list and the amber bar can be seen on day one.

**Considered and rejected:**

- Generating the number in the drawer and posting it. Rejected by `cards.md` and the ticket: generation is server-side, full stop.
- Keeping the full number on the record with a `revealed` flag. Rejected: "The reveal is a one-time response, not a field you can re-read."
- A `Checkbox`/`RadioGroup` primitive for the form. Not needed: the form is text inputs and selects, all of which exist.
- Deriving card spend from the payments table. Payments are money coming in to merchants; card spend is money going out to vendors. There is no source for it, so `spent` is a stored integer, seeded for the sample cards and zero for new ones, and the detail page says so.
- Allowing a card currency different from the merchant's. Rejected, see "where the ticket does not match the code".

## File map

| File | Add or change | Why |
| --- | --- | --- |
| `src/data/types.ts` | Change | `Card`, `CardStatus`, `CardCategory`, `CardEvent`, `IssueCardInput` |
| `src/lib/cards.ts` | Add | Luhn, `generateCardNumber`, `maskCardNumber`, `CARD_TRANSITIONS`, `nextCardStatus` |
| `src/lib/cards.test.ts` | Add | Luhn on the 4242 BIN, masking, every legal and illegal transition |
| `src/data/cards.ts` | Add | `parseIssueCardInput`, `issueCard`, `listCards`, `cardById`, `transitionCard`, idempotency |
| `src/data/cards.test.ts` | Add | Validation cases from the ticket, reveal-once, idempotent issue and the conflict case, guarded transitions |
| `src/app/api/cards/route.test.ts` | Add | The handlers themselves, with a real `NextRequest`: 201 with the number once, replay, conflict, every 400, 409, 404 |
| `src/data/store.ts`, `src/data/generate.ts` | Change | `cards` collection and the idempotency map; deterministic seed cards |
| `src/app/api/cards/route.ts` | Add | `GET` list (masked), `POST` issue (validated, 201 with the number once) |
| `src/app/api/cards/[id]/route.ts` | Add | `GET` one card, masked; 404 |
| `src/app/api/cards/[id]/status/route.ts` | Add | `POST { action }` guarded by the state machine; 409 |
| `src/app/cards/page.tsx` | Add | The list, the empty state, the issue button |
| `src/app/cards/[id]/page.tsx` | Add | Detail: record, spend bar, category, timezone, history, actions |
| `src/app/cards/issue-card-drawer.tsx` | Add | Client form and the one-time reveal; currency follows the merchant |
| `src/app/cards/card-actions.tsx` | Add | Client freeze/unfreeze/cancel, no full reload |
| `src/components/ui/payments/StatusBadge.tsx` | Change | `active`, `frozen`, `cancelled` |
| `AppSidebar.tsx`, `Breadcrumbs.tsx`, `siteConfig.ts` | Change | The route exists in navigation |
| `src/components/ui/detail/Field.tsx`, `Timeline.tsx` | Add | The description-list field and the timeline the payment detail page had inline, shared by both detail pages |
| `merchant-console/CLAUDE.md` | Change | The layout table stops saying cards do not exist |
| `src/data/metrics.ts`, `src/data/metrics.test.ts` | Change, add | Not planned. The org-standards review of this branch found `dailyVolume` bucketing by the server's local day and summing floats; fixed in its own commit with a test that runs under `TZ=America/New_York` |

## Plan

1. **Pure library and its tests** — done when: every generated number is 16 digits, starts `4242`, passes Luhn; `maskCardNumber` gives `•••• 4242`; the transition table allows exactly `active⇄frozen`, `active→cancelled`, `frozen→cancelled`, and nothing out of `cancelled`; `npm test` green.
2. **Types, store, seed, data layer, tests** — done when: `parseIssueCardInput` rejects a missing merchant, a zero or negative limit, a limit above 5,000,000, a currency outside the three, a currency that is not the merchant's, and a bad category, each with a field message; `issueCard` returns the number once and the stored record has no number; a repeated idempotency key returns the same card without the number; `transitionCard` refuses illegal moves; seed cards exist.
3. **Route handlers** — done when: `curl` shows `POST` 201 with `number` once, `GET` list and detail without it, 400 with `fields` for each rejection, 404 for an unknown id, 409 for cancelled→active.
4. **List and detail pages, navigation, badge** — done when: `/cards` renders the seed cards and the empty state copy exists; `/cards/[id]` shows the record, the bar and the history; unknown id is a 404; Cards appears in the sidebar and breadcrumbs.
5. **Issue drawer and actions** — done when: the form defaults currency to the merchant's, shows server errors by field, shows the number once on success with a copy button, clears it on close, and the list updates; freeze/unfreeze/cancel work from the list without a reload; cancel asks for confirmation.
6. **`tsc`, lint, `npm test`, `npm run build`, `/ship-ready`** — done when: all clean.

## Verification

| Acceptance criterion | How it is proven |
| --- | --- |
| Issue a card: nickname, merchant, limit, currency; appears in the list | `POST /api/cards` with `curl` → 201 and the card in `GET /api/cards`; the drawer in the browser |
| Card list at `/cards`: nickname, merchant, masked number, limit, status, created date | `curl /cards` and read the table; masked number is `•••• dddd` |
| Card detail: full record and spend against limit | `/cards/<id>` renders the fields, the percentage and the bar |
| Generated numbers: server-side, `4242` BIN, valid Luhn | `src/lib/cards.test.ts` runs 500 generations; `src/app/api/cards/route.test.ts` checks the number the `POST` handler returned |
| Reveal once: full number only on the success screen | `POST` response has `number`; `GET` list and detail do not; the `Card` type has `last4` and `numberRef` and no field for the number, and `cards.test.ts` asserts the number is not on the record |
| Server-side validation: missing merchant, ≤0, >5,000,000, bad currency | `src/data/cards.test.ts` and `curl` each case → 400 with the field named |
| Stretch: freeze/unfreeze without reload | `POST /api/cards/<id>/status` and the buttons on the list |
| Stretch: spend bar amber past 80% | a seed card at 80%+ renders the amber class |
| Stretch: category lock | field on the form, shown on list and detail |
| Stretch: tests on Luhn and transitions | the two test files, `npm test` |
| Stretch: empty and error states | `/cards` with no cards; a 400 rendered under the field; a failed action shown inline |

## Risks

- `router.refresh()` is what keeps freeze/unfreeze from being a full reload; if it turns out not to re-render the list, the fallback is local state plus refresh.
- The reveal must not survive the drawer. State lives in the drawer component and is reset on close; nothing about the number reaches the URL, the store, or a log.
- The spend bar must never compute in floats. Percentage is `Math.floor(spent * 100 / limit)` on integers.

## Out of scope

- Editing a limit after issue (NWP-202). The detail page says where it lives.
- Persistence (NWP-203). Cards vanish on restart, like everything else.
- Authentication, roles, real network calls.

## Open questions

- Should a card in a currency other than the merchant's ever be allowed? This spec says no; if ops has a real case, the check is one line in `parseIssueCardInput`.
