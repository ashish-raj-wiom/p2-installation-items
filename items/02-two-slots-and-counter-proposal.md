# 03 — Propose 2 slots + customer can counter-propose

> **Type:** Gap (missing capability in ES spec + both apps)
> **Service(s) to update:** ES PRD (`es-installation-service-prd-v2.5` → next minor) · partner app · customer app · `csp-tas-service` (implementation against the new spec, tech-owned)
> **Owner (PM):** Ashis · **Filed:** 2026-05-29

---

## 1. Summary

Today the CSP can propose only **one** slot, and the customer can only accept it. We want the CSP to propose **two** slots, and the customer to be able to either pick one of those two **or** put forward their own slot — and the customer's own slot becomes the confirmed slot directly, without going back to the CSP. The CSP must be able to see which path was taken.

---

## 2. What's happening today

**PM's description:**
> *"The CSP proposes only one slot to the customer and the customer can confirm the slot."*

**Observable behaviour:**
- CSP submits one slot (date + time range).
- Customer sees that one slot in the customer app.
- Customer either confirms it, or doesn't act (any further behaviour — auto-confirm, prompts — lives on the customer-app side and is out of scope for this backend spec).

---

## 3. What we want to happen

**PM's desired outcome:**
> *"CSP proposes two slots, with slot date and slot timerange (typically 3 time ranges in a day). The customer can choose between the slots proposed or choose a completely different slot + time range, which will be shown to the CSP as confirmed slot by the customer."*

In plain English:
1. The CSP submits **exactly two** slot proposals.
2. The customer sees both, and has three ways to confirm:
   - Pick CSP slot 1, **or**
   - Pick CSP slot 2, **or**
   - Counter-propose any other slot of their choice.
3. Whichever path the customer takes, the booking lands in `SLOT_CONFIRMED_BY_CUSTOMER`. A single field on the candidate records which path was used: `CSP_SLOT_1`, `CSP_SLOT_2`, or `CUSTOMER_COUNTER`.
4. The CSP sees the confirmed slot in the partner app along with that source so they understand whether the customer accepted one of their proposals or counter-proposed.

---

## 4. What the OS says

Slot-proposal cardinality and the customer-counter-propose pathway are **ES-domain**, not OS-domain. No LOCKED OS file (CL OS, D&A OS, Quality OS) covers this. **No OS change is needed for this item.**

## 5. What the Spec / PRD says

`yaml-prd/es-installation-service-prd-v2.5.yaml` (current latest, uploaded 2026-05-27) — the slot-related transitions are unchanged from v2.4:

- **L536–540** — `AWAITING_SLOT_PROPOSAL` description says *"Partner must propose **a** slot"* (singular). `PROPOSE_SLOT` trigger carries one `{date, start, end}`.
- **L569–580** — `AWAITING_CUSTOMER_SLOT_CONFIRMATION` allows `→ SLOT_CONFIRMED_BY_CUSTOMER` only via the customer's signal acknowledging the single proposed slot. There is no transition for a customer counter-proposal landing directly in `SLOT_CONFIRMED_BY_CUSTOMER`.

So the spec is missing: (a) two-slot proposal, (b) the counter-propose path.

## 6. What the Code does

For evidence only — tech will revise these in line with the new spec.

- TAS schema (`install_execution_candidates`) holds **one** proposed slot — `proposed_slot_date`, `proposed_slot_time_range_start`, `proposed_slot_time_range_end`. The 2-slot columns were dropped in migration `V057` with the note *"the two-slot model was unused (slot2 always NULL in practice)."*
- TAS DTO `ProposeSlotRequest` takes one slot.
- The customer-confirm event handler matches the customer payload against the single proposed slot and rejects anything that doesn't match exactly. Today there is no path for the customer to send a fresh slot the partner didn't propose.

**Prod confirmation:** in the last 30 days, **zero** candidates have a slot-2 record (`confirmed_slot_number = 2` count: 0). Consistent with the single-slot world the spec describes.

---

## 7. Where the gap / bug lives

| Layer | Defined? | Notes |
|---|---|---|
| OS | n/a | Cardinality is ES-domain, no LOCKED OS file covers it. |
| Spec (ES PRD v2.5) | ✗ No | Singular "slot"; no customer counter-propose transition. |
| TAS persistence model | ✗ No | One proposed slot only (V057 dropped slot 2). |
| Partner app | ✗ No | Single-slot picker (the original reason slot 2 was dropped). |
| Customer app | ✗ No | No "propose your own" path. |
| Prod | — | 0 candidates ever used slot 2 in 30 days. Confirms single-slot today. |

Classification: **Gap — missing capability across ES spec + both apps + the TAS model that backs them.** Not a bug; nothing is being violated.

---

## 8. Spec — handed to tech

### Today

- The CSP submits exactly one slot (date + time range).
- The candidate moves into `AWAITING_CUSTOMER_SLOT_CONFIRMATION`.
- The customer can confirm that single slot; the candidate moves to `SLOT_CONFIRMED_BY_CUSTOMER`. The `slot_confirmation_source` field records `CUSTOMER`.

### Want

**Slot proposal (partner side) — fixed grid:**

The CSP picks **exactly two slots from a fixed grid** of *(date × time-block)* options:

- **Date options (3):** today, tomorrow, day after tomorrow. The window is anchored to the calendar — at 8 PM today, today may show zero future slots; the window does **not** slide forward to compensate.
- **Time-block options (3, all 3-hour windows):** 10 AM – 1 PM, 1 PM – 4 PM, 4 PM – 7 PM.
- **Future-only filter:** A slot is visible to the CSP only if its start time is in the future. At 10 Jun 11 AM, the 10 Jun 10 AM – 1 PM block is hidden (already in progress); 10 Jun 1–4 PM, 10 Jun 4–7 PM, all 11 Jun slots, all 12 Jun slots are visible.
- **Pair rule:** the two chosen slots must be **distinct** (not the same date + same time-block). Same date with different time-blocks is allowed (e.g. *Jun 10 1–4 PM* + *Jun 10 4–7 PM*). Same time-block on different dates is allowed.
- **No free-form windows on the CSP side.** The CSP cannot type a custom `start_time` / `end_time` — they pick from the 9 fixed cells of the grid (filtered to future-only). This means `end > start` and "no past slots" are enforced by the picker itself, not by submission-time validation.
- After submission, the candidate transitions through `SLOT_SELECTED` to `AWAITING_CUSTOMER_SLOT_CONFIRMATION` exactly as today; only the carried payload changes.

**Customer choice (three paths, all land in `SLOT_CONFIRMED_BY_CUSTOMER`):**

> The customer side is **NOT** constrained to the CSP's fixed grid. The customer can counter-propose any future date + any time of day, defined and validated by the customer-app side. The asymmetry is deliberate — the CSP's grid keeps partner UI simple; the customer's free-form picker accommodates anyone whose preferred time falls outside the 10 AM – 7 PM window or beyond the 3-day calendar window.


| Customer action | Confirmed slot recorded | `slot_confirmation_source` |
|---|---|---|
| Accepts CSP slot 1 | CSP slot 1's `{date, start, end}` | `CSP_SLOT_1` |
| Accepts CSP slot 2 | CSP slot 2's `{date, start, end}` | `CSP_SLOT_2` |
| Counter-proposes own slot | the customer's chosen `{date, start, end}` | `CUSTOMER_COUNTER` |

**CSP visibility:**

- The partner app shows the confirmed slot and the `slot_confirmation_source` so the CSP knows whether the customer accepted one of their proposals or counter-proposed.
- There is no separate "you must re-propose" flow; the customer's counter-proposal is **the** confirmed slot and the CSP simply executes against it.

**Re-assignment carry-forward:**

If a CSP fails after the customer has confirmed a slot (e.g. CSP1 marks installation failed) and DAS routes the booking to a new CSP, the customer's previously-confirmed slot is **persisted at the connection level** so it survives the re-assignment. When the new CSP is allocated:

- **If the confirmed slot is still at least 1 hour away from now()** — the new CSP is shown the customer's confirmed slot up-front, with two choices:
  - **Proceed** — accept the customer's slot; install proceeds at that time; `slot_confirmation_source = INHERITED` on the new candidate.
  - **Propose my own 2 slots** — start the normal 2-slot proposal flow; the customer's previous confirmation is discarded; the customer goes through the normal 3-choice flow against the new CSP's 2 new slots.
- **If the confirmed slot is less than 1 hour away or already in the past** — the inherited slot is treated as unusable; the new CSP sees the normal 2-slot proposal screen with no inherited info shown.

Carry-forward applies on **every** re-assignment (CSP2, CSP3, ...) — the latest confirmed slot keeps travelling forward as long as it remains ≥ 1 hour away. The first CSP to "Proceed" locks it in.

**Updated enum:** `slot_confirmation_source` now includes `INHERITED` (in addition to `CSP_SLOT_1 | CSP_SLOT_2 | CUSTOMER_COUNTER`).

### Edge cases (well-scoped)

1. **CSP submits 0, 1, or 3+ slots.** Rejected at submission with message *"Please propose exactly 2 slots."*
2. **CSP picks the same grid cell twice** (same date + same time-block). Rejected — the customer needs a real choice between two distinct options.
3. **CSP picks two grid cells on the same date but different time-blocks.** Allowed. (E.g. *Jun 10 1–4 PM* + *Jun 10 4–7 PM*.)
4. **CSP picks two grid cells on different dates.** Allowed (the common case).
5. **CSP opens slot-proposal late in the day (e.g. 8 PM Jun 10).** Window is anchored to today + 2 days — Jun 10 shows 0 future slots, Jun 11 + Jun 12 each show 3. Effectively 6 grid cells visible. The window does **not** slide forward to give the CSP a third day's worth.
6. **CSP opens slot-proposal right after 1 PM on Jun 10.** Jun 10 10 AM – 1 PM is hidden (in the past). Jun 10 1–4 PM has just started — also hidden per the future-only rule (start time is not strictly future). Jun 10 4–7 PM and all Jun 11 / Jun 12 slots remain visible.
7. **Customer's counter-proposal is in the past.** Rejected at the customer app, with message; no event reaches the backend.
8. **Customer's counter-proposal is far in the future.** **No cap on the customer side.** Customer picks from a free-form picker — they can counter weeks or months ahead if they wish. (Asymmetric with CSP's 3-day grid by design.)
9. **Customer's counter-proposal has `end_time ≤ start_time`.** Rejected at the customer app.
10. **Customer's counter-proposal happens to coincide with one of the CSP's proposed slots** (same date + start + end). **Always recorded as `CUSTOMER_COUNTER`** — the customer's choice is authoritative; what they entered in the counter-propose flow is what becomes the confirmed slot, regardless of equality. *(PM-confirmed 2026-05-29.)*
11. **CSP wants to re-propose / change their two slots after submission.** Out of scope today. Once the two slots have been submitted, the booking sits in `AWAITING_CUSTOMER_SLOT_CONFIRMATION` until the customer acts.
12. **Customer doesn't act at all.** Out of scope here. Any prompt / auto-confirm / nudge behaviour is the customer app's concern, not this backend spec.
13. **Same customer flips between options inside the customer app** (taps slot 1, then slot 2, then a counter) before final submit. Only the final submission matters; the backend sees a single `CUSTOMER_SLOT_CONFIRMED` event.
14. **Allocation cancellation arrives** (CL deactivation / D&A reallocation / customer cancel) while the candidate is in `AWAITING_CUSTOMER_SLOT_CONFIRMATION`. Cancellation wins; the customer's pending slot choice is discarded. (No change from today.)
15. **CSP1 fails, customer's confirmed slot is 4 hours away.** CSP2 is allocated; CSP2 sees the inherited slot with *Proceed* + *Propose my own 2 slots* CTAs.
16. **CSP1 fails, customer's confirmed slot is 30 minutes (or 59 minutes) away.** Below the 1-hour buffer — inherited slot treated as unusable; CSP2 sees the normal 2-slot proposal screen.
17. **CSP1 fails, customer's confirmed slot is already in the past.** Inherited slot discarded; CSP2 sees the fresh proposal screen.
18. **CSP2 taps "Proceed"** on the inherited slot. CSP2's candidate moves to `SLOT_CONFIRMED_BY_CUSTOMER` with `slot_confirmation_source = INHERITED`. The customer's confirmed slot is preserved at the connection level (unchanged).
19. **CSP2 taps "Propose my own 2 slots."** The inherited slot is discarded; customer goes through the normal 3-choice flow against CSP2's 2 new slots. Whichever slot the customer confirms now becomes the new connection-level confirmed slot.
20. **CSP2 proceeds; CSP2 also fails.** CSP3 sees the same inherited slot if still ≥ 1h from now() (carry-forward applies again, on the unchanged slot).
21. **CSP2 proposes new slots; customer counter-proposes via CSP2; CSP2 also fails.** The customer's *new* counter-proposed slot (from CSP2 era) is what travels forward to CSP3 — the latest confirmed slot is what's persisted.
22. **CSP2 ignores the inherited-slot screen** (doesn't tap either CTA). Item 01's 4-hour SLA applies — *Proceed-or-Propose* counts as "the CSP must act"; if 4 h pass with no action, the system reassigns to CSP3 (and the inherited slot continues to travel forward if still ≥ 1h away).

### Out of scope

- Customer auto-confirm-on-timeout behaviour (customer-app domain; the spec entry `SLOT_AUTO_CONFIRMED` in the ES PRD does not match real behaviour and is a separate clean-up item, not this one).
- Customer-reschedule-back-to-CSP flow (does not exist today; the spec entry `CUSTOMER_RESCHEDULE` in the ES PRD does not match real behaviour and is a separate clean-up item, not this one).
- CSP re-propose / change-of-slots after submission (edge case 11 — not in this item).
- OS changes — none required; the entire change lives in the ES PRD and the two apps.

---

## 9. Risks / interactions

- **The "partners never used slot 2" history is real.** V057 collapsed the schema because partners never filled slot 2 — so partner-app UX has to make 2-slot entry *the* path (block submit until both are entered, suggest defaults). Otherwise this change is cosmetic and partners stick to one.
- **Backward compatibility on `CUSTOMER_SLOT_CONFIRMED`.** Today's customer-app payload has no `selection_source`. Tech should plan a two-release rollout: backend first with tolerant fallback (match by equality if `selection_source` is absent), then customer app starts sending the new flag, then backend can rely on it.
- **Auto-confirm and reschedule in the existing PRD don't match reality.** The current `es-installation-service-prd-v2.5` spec mentions both `SLOT_AUTO_CONFIRMED` and `CUSTOMER_RESCHEDULE` transitions but neither corresponds to actual production behaviour. Worth flagging as a separate PRD-hygiene item.
- **No DAS / CL impact.** D&A and CL never see slot details; nothing changes for them.
- **Communication.** This item does not introduce any new PN/CleverTap events. If we want to notify the CSP that the customer counter-proposed (rather than picking one of their slots), that's a separate notification item.

## 10. References

- **OS:** silent — slot-proposal cardinality is ES-domain.
- **Spec:** `yaml-prd/es-installation-service-prd-v2.5.yaml` (current latest as of 2026-05-27) — L536–540 (singular "slot"), L569–580 (customer transitions, no counter-propose path).
- **Code evidence (not the fix — for tech context):** TAS schema (single proposed slot), TAS `ProposeSlotRequest` DTO (single slot), TAS customer-confirm handler (rejects non-matching payloads). V057 migration (`V057__rename_slot_columns_to_proposed_and_confirmed.sql`) explains why slot 2 was dropped: *"two-slot model was unused (slot2 always NULL in practice)."*
- **Prod evidence:** `csp_tas_service.install_execution_candidates` — 0 candidates with `confirmed_slot_number = 2` in last 30 days (consistent with single-slot today).

## 11. Investigation log

- **2026-05-29 — filed.** Spec gap across ES PRD + both apps. Fix is PM-spec-only; tech designs implementation.
- **2026-05-29 — revised (PM corrections).** Per PM: removed "Reschedule" and "Auto (12h)" from both Today and Want flows — neither corresponds to real behaviour (auto-confirm is customer-app side; reschedule does not exist as a flow). Rewrote §8 as a well-scoped human-readable spec with 15 enumerated edge cases and pre/post diffs per affected surface — no code prescriptions. Switched all spec references from v2.4 to v2.5 (latest). Confirmed no OS change is needed.
- **2026-05-29 — further tightening.** Removed 1 technical edge case (customer-app refresh-delay race) per new "business edge cases only" guideline. Added **Open questions for PM** callout in the HTML listing assumptions made (7-day future cap on counter, coincidence-with-CSP-slot handling, time-range duration constraint). CSS fix: arrow text between flow-diagram nodes shrunk from 1.3rem to 0.82rem to match node-text scale.
- **2026-05-29 — PM answers locked in.** Customer counter future cap: **no cap** (was assumed 7 days). Coincidence with CSP slot: **always recorded as `CUSTOMER_COUNTER`** (was assumed: treat as CSP slot). Edge cases 8 and 10 updated. Open Questions section now has only the time-range duration rule (`end > start` confirmed; pending PM: is there a min-window or max-window duration constraint?). Also removed the redundant intro line "Human-readable behaviour spec…" from the Spec heading area.
- **2026-05-29 — Time-range / slot-shape Open Question closed (with material spec revision).** PM clarified the CSP side is **not** free-form — it's a **fixed grid** of 3 dates (today, tomorrow, day-after) × 3 time-blocks (10–1, 1–4, 4–7), filtered to future-only by slot start. CSP picks exactly 2 out of the 9 future grid cells; same-date pairs allowed; window anchored to calendar (does not slide forward when today is empty). The customer side **remains free-form** (no grid constraint, no future cap) — defined and validated on the customer-app side. Spec §8 Post-state rewritten with the grid model; edge cases 2–6 rewritten to reflect the grid rather than free-form windows; edge cases 7–10 (customer side) unchanged.
- **2026-05-29 — re-assignment carry-forward added (PM nuance + 4 PM answers).** New behaviour: when a CSP fails and the booking is re-assigned to a new CSP, the customer's previously-confirmed slot is preserved at the connection level (not just on the per-CSP candidate). If still ≥ 1 hour from now(), the new CSP is shown the slot with *Proceed* / *Propose my own 2 slots* CTAs. `Proceed` → `slot_confirmation_source = INHERITED` (new enum value, PM-confirmed). `Propose` → normal flow; old confirmed slot discarded (PM-confirmed). 1-hour buffer (PM-confirmed: anything below 1h treated as unusable). Carry-forward applies on every re-assignment until a CSP Proceeds or the slot ages out (PM-confirmed). Added 8 new edge cases (#16–23). Updated Post-state, Persisted-model card (now describes connection-level persistence), Partner-app card (new inherited-slot screen with 2 CTAs), Customer-app card (no visible change on Proceed; fresh flow on Propose). Added a new Re-assignment branch flow diagram inline in Post-state.
- **2026-05-29 — removed Pre/post diff per surface section** (per PM: no longer needed). Spec structure is now: Pre-state · Post-state (with embedded behaviour + comm timeline + re-assignment carry-forward) · Edge cases · Open questions · Out of scope. The per-surface change descriptions remain implicit in the Post-state — tech infers what each surface needs from the behavioural spec.
