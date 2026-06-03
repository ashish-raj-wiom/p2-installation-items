# 08 — DAS allocation state never reaches ACCEPTED (post-AMENDMENT-02 wiring orphan)

> **Type:** Gap — **post-AMENDMENT-02 wiring orphan.** AMENDMENT-02 deleted the explicit CSP-accept call (`/actions/accept`) in favour of "auto-accept on assignment", but never named a backend sender for the auto-accept. DAS exposes the receiver; no service signals it. **PM owns the behavioural invariant; tech picks the mechanism.**
> **Service(s) to update:** `csp-demand-allocation-service` *and / or* `csp-tas-service` *and / or* `csp-gateway-service` — tech-owned mechanism choice. AMENDMENT-02 / Install-Flow integration spec (PM, to record the chosen wiring).
> **Owner (PM):** Ashis · **Filed:** 2026-05-29
> **Hard prerequisite for:** Item 07 (DAS P41 acceptance sweep). Item 07 will mis-fire on all live installs until Item 08 ships.

---

## 1. Summary

DAS's allocation state machine has five states — `UNASSIGNED → ASSIGNED → ACCEPTED → ACTIVE → REALLOCATION_PENDING → REASSIGNED`. In prod, only two of those states ever appear: `ASSIGNED` (274 rows) and `UNASSIGNED` (230 rows). `ACCEPTED`, `ACTIVE`, `REALLOCATION_PENDING`, `REASSIGNED` — **zero rows, ever.** `acceptance_timestamp` is NULL on all 504 rows in the table.

The transition mechanism is not the gap. DAS has `AllocationServiceImpl.acceptAllocation(...)` correctly implemented, with a controller endpoint at `POST /api/demand-allocation/csps/{cspId}/accept`. The state machine validates the transition; the timestamp setter exists; the routing-pipeline emits `ALLOCATION_ACCEPTED` correctly. **The endpoint just has no callers.** AMENDMENT-02 (Apr 2026) ripped out the explicit CSP-accept UX path and declared "acceptance is automatic on assignment" — but it did not name which backend service is responsible for signalling the auto-accept, and no service picked up the responsibility.

For the install flow to work end-to-end, **every allocation must reach `ACCEPTED` before P41 expires** (Item 07's safety net). The mechanism (DAS-internal atomic write / TAS-signalled / Gateway-signalled / other) is a tech decision — PM only requires that the invariant holds.

---

## 1a. Parameter used in this item

| Term | Meaning |
|---|---|
| **P41** | DAS **acceptance window** — 2h. The safety-net timer (Item 07) that reclaims `ASSIGNED → UNASSIGNED` if acceptance never lands. Item 08 must close the wiring so P41 sees only genuine wiring-failure rows, not every live install. |

---

## 2. What's happening today

**PM's description:**
> *"DAS — allocation state frozen at ASSIGNED / UNASSIGNED. Never reaches ACCEPTED / ACTIVE."*

**Evidence — prod DB (`csp_demand_allocation_service.connection_allocations`, full table):**

| `allocation_state` | row count |
|---|---|
| `UNASSIGNED` | 230 |
| `ASSIGNED` | 274 |
| `ACCEPTED` | **0** |
| `ACTIVE` | **0** |
| `REALLOCATION_PENDING` | **0** |
| `REASSIGNED` | **0** |

`acceptance_timestamp` is `NULL` on every one of the 504 rows. Every connection that has ever installed in prod did so while its DAS row sat in `ASSIGNED`. The OS state-machine simply never advances.

**Evidence — code:**

- `services/csp-demand-allocation-service/src/main/java/io/wiom/csp/demand_allocation/application/impl/AllocationServiceImpl.java:42–53` — `acceptAllocation(connectionId, cspId)` implementation: validates the `ASSIGNED → ACCEPTED` transition, sets `allocation_state = ACCEPTED`, writes `acceptance_timestamp = Instant.now()`, persists. Correct.
- `api/AllocationController.java:31–39` — exposes `POST /api/demand-allocation/csps/{cspId}/accept`. Bearer-token-protected, reachable. Correct.
- **Search across all `services/` for any caller of the `/accept` path or for the method `acceptAllocation` outside of DAS's own code:** zero hits. No service POSTs to it. No client wrapper for it.
- **Gateway service explicitly removed its accept call:** `services/csp-gateway-service/docs/install-api-contract.md:145` — *"Booking acceptance is automatic on assignment (AMENDMENT-02). The Partner App receives the candidate already in `AWAITING_SLOT_PROPOSAL`. There is no `/actions/accept` or `/actions/decline` endpoint."* And `services/csp-gateway-service/docs/frontend-amendment-02-handoff.md:14` — *"Delete 3 HTTP calls: `/actions/accept`, `/actions/decline`, `/actions/dismiss`."* The gateway side did its half of AMENDMENT-02 (delete the explicit call). Nobody did the other half (wire the auto-accept).
- **`app-specs/das-install-integration-flow.md:112–136`** (Apr 12 2026 doc) describes a flow where the gateway POSTs `event_type: CSP_ACCEPTED` to DAS on slot proposal, mediated by an `InstallDasClient.notifyAccepted()` client. **Search for `InstallDasClient` or `notifyAccepted` in the entire `services/` tree: zero hits.** The integration spec doc names a client class that does not exist in any service. The doc is stale.

So the gap is multi-layer:

| Layer | What it says | Reality |
|---|---|---|
| OS (DAS §4.1) | State machine includes ACCEPTED; trigger "CSP-initiated" or "auto on assignment" | Not actually contradictory — both are listed |
| OS (DAS §4.3) | Routing pipeline emits `ALLOCATION_ACCEPTED` at selection | Emits the *event*; does not transition the *state* — that's a separate step (per §4.1) |
| DAS PRD | Has the ACCEPTED state in the state machine | Consistent with OS |
| AMENDMENT-02 (Apr 2026) | "Acceptance is automatic on assignment" — replaces the prior explicit accept UX | Mandate is clear; **does not name a sender** |
| Gateway service | Removed `/actions/accept` per AMENDMENT-02 | Did its half |
| Any backend service | (Should fire auto-accept on assignment) | **Nobody picked it up** |
| `app-specs/das-install-integration-flow.md` | Names `InstallDasClient.notifyAccepted()` as the sender | Class does not exist |
| Prod | 0 ACCEPTED rows ever | The orphaned half is observable in DB |

The OS / PRD / DAS code are not internally contradictory — they all expect a sender. AMENDMENT-02 changed *who* the sender is supposed to be (was: customer-app CTA → gateway; now: automatic) and the *who* never got assigned.

---

## 3. What we want to happen

**PM-defined invariant — tech picks the mechanism:**

> **Every allocation must reach `ACCEPTED` (with `acceptance_timestamp` set) before P41 expires, on the standard happy path. P41 is the safety net for the rare case where the auto-accept didn't land — not the primary mechanism.**

That is the entire deliverable from PM's side. Tech chooses how to achieve it.

For completeness, the three plausible mechanisms (tech to pick — recorded here so the PM-side decision log is unambiguous):

1. **DAS-internal atomic write.** The DAS routing pipeline, in the same transaction that selects the CSP and emits `ALLOCATION_ACCEPTED`, also sets `allocation_state = ACCEPTED` + `acceptance_timestamp = now()`. `ASSIGNED` becomes a vestigial state used only when a downstream signal later disagrees. No cross-service wire. Closest to AMENDMENT-02's "automatic" intent.
2. **TAS-signalled accept.** TAS, on receiving `ALLOCATION_ACCEPTED` and creating the install candidate in `AWAITING_SLOT_PROPOSAL`, POSTs `/api/demand-allocation/csps/{cspId}/accept` to DAS. One round-trip in `ASSIGNED`; then `ACCEPTED`. Closer to `app-specs/das-install-integration-flow.md`.
3. **Gateway-signalled accept.** Gateway sends the accept on first partner-app touch (e.g. home-feed open or propose-slots). Pre-AMENDMENT-02 model. **Rejected** by AMENDMENT-02 because it ties DAS state to UI events — listed only for completeness.

Whichever mechanism tech picks, the **observable outcome** is the same: every successful allocation lands in `ACCEPTED` quickly enough that Item 07's P41 sweep doesn't trip on it.

**Out of scope for PM:** mechanism choice, transaction boundaries, retry/idempotency design, event-ordering between `ALLOCATION_ACCEPTED` and the state write. Tech.

---

## 4. What the OS says

`os/Demand_Allocation_OS_v1_9_1_LOCKED.md`:

- **§4.1 State Machine:** `UNASSIGNED → ASSIGNED → ACCEPTED → ACTIVE → REALLOCATION_PENDING → REASSIGNED`. Five states, transitions defined.
- **§4.3 Routing Pipeline:** the 7-stage pipeline ends with *"emit `ALLOCATION_ACCEPTED`"* — but does not specify whether the state write to `ACCEPTED` happens inside the same atomic step. That is the implementation question this item resolves.
- **INV-DAO-03 (stickiness):** *"Once an allocation reaches ACCEPTED, it cannot be re-routed to a different CSP except via the REALLOCATION_PENDING path."* — depends on the allocation actually reaching ACCEPTED. Today, with all rows stuck in ASSIGNED, INV-DAO-03 is silently inert.
- **P41:** acceptance window — semantically the *fallback* if auto-accept fails. The OS does not say "P41 must be the only way an ASSIGNED row resolves" — it says "if not accepted within P41, revert." Tech's mechanism choice determines how often that fallback fires.

## 5. What the Spec / PRD says

`yaml-prd/demand-allocation-prd-v1.2.yaml`:

- State machine includes ACCEPTED with the transition validated by `AllocationStateMachine`.
- `acceptance_timestamp` field defined on `ConnectionAllocationEntity`.
- PRD does not prescribe the trigger source for the ACCEPTED transition — correctly left to the integration spec.

**`AMENDMENT-02` (Installation Flow, Apr 2026):** *"Booking acceptance is automatic on assignment. The customer-app `/actions/accept` and `/actions/decline` flows are removed. The Partner App receives the candidate already in `AWAITING_SLOT_PROPOSAL`."* — the amendment is correct about removing the explicit UX path; it omits naming the backend sender.

**`app-specs/das-install-integration-flow.md` (Apr 12 2026):** describes the gateway calling DAS with `event_type=CSP_ACCEPTED` on propose-slots, mediated by `InstallDasClient.notifyAccepted()`. That class does not exist. The integration spec doc was written but never implemented.

## 6. What the Code does

- `services/csp-demand-allocation-service/.../application/impl/AllocationServiceImpl.java:42–53` — `acceptAllocation(...)` works correctly.
- `services/csp-demand-allocation-service/.../api/AllocationController.java:31–39` — endpoint correctly exposed.
- `services/csp-demand-allocation-service/.../api/AllocationController.java:41–49` — corresponding decline endpoint, also unused (paired removal in AMENDMENT-02).
- `services/csp-demand-allocation-service/.../application/impl/RoutingEngineServiceImpl.java` — emits `ALLOCATION_ACCEPTED` at selection; **does not** call `AllocationServiceImpl.acceptAllocation(...)` in the same path. The state-machine write step is missing inside DAS itself.
- `services/csp-gateway-service/.../install/service/InstallFacadeService.java` — handles propose-slots; does **not** POST to DAS `/accept`.
- `services/csp-tas-service/.../*` — handles `ALLOCATION_ACCEPTED` consumer (creates the install candidate in `AWAITING_SLOT_PROPOSAL`); does **not** POST to DAS `/accept`.
- **No `InstallDasClient` class** anywhere in `services/`.

---

## 7. Where the gap / bug lives

| Layer | Defined? | Notes |
|---|---|---|
| OS (DAS §4.1 / §4.3) | ✓ Yes | State machine has ACCEPTED; routing pipeline emits the event; transition itself is "implementation choice." |
| Spec (DAS PRD v1.2) | ✓ Yes | State + field + state-machine validation all present. |
| AMENDMENT-02 (Installation Flow) | ⚠ Partial | Says "automatic on assignment" — does not name the sender. **This is the spec gap.** |
| Integration spec (`app-specs/das-install-integration-flow.md`) | ⚠ Stale | Names a sender class (`InstallDasClient`) that doesn't exist. |
| Code (DAS receiver) | ✓ Works | `acceptAllocation` + endpoint correct. |
| Code (any sender) | ✗ Missing | Zero callers across all services. |
| Prod | ✗ Wrong | 504/504 rows stuck in ASSIGNED/UNASSIGNED; 0 ACCEPTED, ever. |

Classification: **Gap.** Not a bug — the spec itself (AMENDMENT-02) did not name a sender. Until PM names the sender (or tech picks the DAS-internal-atomic-write path and PM amends the integration spec to reflect that), no code is "violating" anything. PM owns the spec clarification; tech owns the implementation.

## 8. Spec — handed to tech

### Today

- Every allocation that has ever been made in prod sits forever in `ASSIGNED` (or `UNASSIGNED`). No allocation has reached `ACCEPTED` or any later state.
- INV-DAO-03 stickiness (once ACCEPTED, allocation cannot be silently re-routed) is inert — there are no ACCEPTED rows to protect.
- The DAS state machine works correctly in qa when the `/accept` endpoint is called manually; the live install flow does not call it.

### Want

**Behavioural invariant:**

> Every allocation that the routing pipeline successfully selects a CSP for must reach `allocation_state = ACCEPTED` with `acceptance_timestamp` set on the standard happy path. The state write must happen quickly enough that P41 (Item 07's 2h sweep) does not trip on a healthy in-progress install.

Concrete observable conditions:

1. After ALLOCATION_ACCEPTED is emitted for a connection, the DB row's `allocation_state` reaches `ACCEPTED` within seconds (or a single transaction — tech's choice).
2. `acceptance_timestamp` is non-null for every connection that has progressed past the acceptance moment.
3. INV-DAO-03 stickiness becomes enforceable — once a row is `ACCEPTED`, the routing engine no longer touches it except via the `REALLOCATION_PENDING` path.
4. `ASSIGNED` is only observed transiently (briefly) or as a leftover of a genuine wiring failure that Item 07's P41 sweep will reclaim.

### What more is required in the install service — depends on mechanism choice

Tech-owned, but documented here so PM understands the implication of each path:

| Mechanism | What changes in DAS | What changes in TAS / Gateway | What changes elsewhere |
|---|---|---|---|
| **A. DAS-internal atomic write** | Routing pipeline writes state=ACCEPTED + timestamp in the same transaction that emits ALLOCATION_ACCEPTED | Nothing | Nothing. AMENDMENT-02 integration spec note updated (PM). |
| **B. TAS signals** | Receiver stays as-is | TAS calls DAS `/csps/{cspId}/accept` on ALLOCATION_ACCEPTED ingest (i.e. on candidate creation) | Integration spec doc updated to match (replace `InstallDasClient.notifyAccepted()` with TAS-side description). |
| **C. Gateway signals** | Receiver stays as-is | Gateway re-adds the call (rejected by AMENDMENT-02; listed for completeness) | n/a |

**Whichever tech picks, PM's deliverable is:**

1. Amend AMENDMENT-02 (or write a follow-up integration spec note) recording the chosen sender.
2. Update or retire `app-specs/das-install-integration-flow.md` to reflect the actual sender.

### Edge cases (business)

1. **ALLOCATION_ACCEPTED emits, but the auto-accept signal (mechanism B / C) fails — network blip / consumer crash.** Item 07's P41 sweep is the safety net: 2h later it reclaims the row to UNASSIGNED and re-routes. From the customer's perspective, this looks like a 2h-delayed re-routing. Mechanism A (DAS-internal) eliminates this case by construction.
2. **Customer cancels before the install reaches ACCEPTED.** The cancellation path (Item 05) takes the connection to a terminal state through CL → TAS → DAS in the usual order; the allocation transitions to its terminal state regardless of which auto-accept mechanism is in flight. Whichever mechanism is picked, customer-initiated cancellation is the authoritative outcome.
3. **CSP declines slot proposal explicitly.** Different from acceptance — DAS's `declineAllocation(...)` endpoint exists (paired with accept, also unused today). This item does not change the explicit-decline path; if AMENDMENT-02 also wants to wire auto-decline-on-customer-cancel or similar, that's a separate item.
4. **A row already in ACCEPTED gets a re-routing request (e.g. CSP suspended).** INV-DAO-03 stickiness routes via REALLOCATION_PENDING → REASSIGNED. This path is currently dead (zero ACCEPTED rows exist) but the state-machine code is in place. Becomes live as soon as ACCEPTED rows start appearing.
5. **A connection re-allocated via T3 retry (Item 06's P74 retry path) lands a new ASSIGNED row.** Same auto-accept flow runs again for the new row. No special-casing needed.

### Notes for tech

- **No AMENDMENT-02 follow-up note required from PM.** PM-resolved: once the mechanism is coded, the **code itself is the source of truth.** Don't gate the build on a PM-written amendment addendum.
- **Stale `app-specs/das-install-integration-flow.md`: tech's call after mechanism is picked.** PM-resolved: defer. Once tech picks DAS-internal atomic write / TAS-signal / Gateway-signal, tech decides whether to retire (delete) or update the doc — based on whether they actually reference it. PM doesn't pre-decide.

### Out of scope

- **Mechanism choice (A / B / C).** Tech-owned per PM.
- **INV-DAO-03 stickiness enforcement testing.** Once ACCEPTED rows start appearing, INV-DAO-03 becomes enforceable — tech will want to add explicit tests. Not in PM scope.
- **The other DAS terminal states** (ACTIVE, REALLOCATION_PENDING, REASSIGNED) — these all become reachable once ACCEPTED is reachable; no separate fix needed for them.
- **Item 02 (P51 cooldown bypass).** Unrelated logically; both fixes can ship independently.

---

## 9. Risks / interactions

- **Hard prerequisite for Item 07.** Without this fix, Item 07 (P41 sweep) would reclaim all 274 live ASSIGNED rows back to UNASSIGNED on first sweep run — mass mis-routing of live installs. **Item 08 must ship first.**
- **First-fire backfill.** When the chosen mechanism activates, future allocations land in ACCEPTED correctly. The 274 currently-ASSIGNED rows (which are live in-progress installs in reality, just mis-stated in DAS) need a backfill decision — do we one-shot-update them to ACCEPTED with `acceptance_timestamp = now()` to bring DAS in sync with truth? Or leave them and let Item 07's P41 sweep reclaim them? **Tech decision** (the truth is the partner is mid-install; reclaim would harm them; one-shot-fix is safer). PM should be told the choice before rollout.
- **Datadog dashboards and Quality OS pattern detection** depend on `acceptance_timestamp` being set (e.g. P41-timeout-rate metrics). Today all dashboards key off `entry_timestamp` on ASSIGNED. Post-fix, dashboards become accurate for the first time.
- **INV-DAO-03 stickiness becomes live.** Once ACCEPTED rows start appearing, the routing engine's "do not re-route ACCEPTED rows" rule actually has rows to enforce. Tech should add an explicit assertion in `RoutingEngineServiceImpl` to ensure no code path silently re-routes an ACCEPTED row outside REALLOCATION_PENDING.

## 10. References

- **OS:** `os/Demand_Allocation_OS_v1_9_1_LOCKED.md` §4.1 (state machine), §4.3 (routing pipeline), INV-DAO-03 (stickiness), P41 (acceptance window — context for Item 07).
- **AMENDMENT-02 (Installation Flow):** "Booking acceptance is automatic on assignment; `/actions/accept` removed."
- **Stale integration spec:** `app-specs/das-install-integration-flow.md` §2.3 (names `InstallDasClient.notifyAccepted()` — class does not exist).
- **DAS code:** `application/impl/AllocationServiceImpl.java:42–53` (`acceptAllocation` — works) · `api/AllocationController.java:31–39` (endpoint — exposed) · `application/impl/RoutingEngineServiceImpl.java` (emits ALLOCATION_ACCEPTED; does NOT update state to ACCEPTED).
- **Gateway "did its half" docs:** `services/csp-gateway-service/docs/install-api-contract.md:145` · `docs/frontend-amendment-02-handoff.md:14`.
- **Prod DB query:** `SELECT allocation_state, COUNT(*) FROM csp_demand_allocation_service.connection_allocations GROUP BY allocation_state;` → 230 UNASSIGNED, 274 ASSIGNED, 0 everything else.
- **Related project notes:** [[cl-timer-enforcement-gap]] BUG-4 (same finding, less detail).
- **Hard dependant:** **Item 07** (DAS P41 sweep — blocked by this item).

## 11. Investigation log

- **2026-05-29 — filed.** Extracted from prior CL-timer-enforcement investigation (memory: `cl-timer-enforcement-gap`, BUG-4). PM asked "where is the gap?" — investigated against current `main` and found that the gap is **not** the OS §4.1-vs-§4.3 contradiction I had previously framed, but rather a **post-AMENDMENT-02 wiring orphan**: AMENDMENT-02 deleted the explicit accept call and declared acceptance "automatic" but did not name a backend sender, and no service picked it up. DAS receiver works; nobody signals. Classified as **Gap** with tech owning the mechanism choice. Filed **as hard prerequisite for Item 07**.
- **2026-05-29 — Open Questions closed.** PM resolved both: (1) No formal AMENDMENT-02 follow-up note required — **the code itself is the source of truth** once the mechanism ships; PM is not gated on writing a spec addendum. (2) Stale `app-specs/das-install-integration-flow.md` — **tech's call** after picking the mechanism (retire vs update vs leave). PM doesn't pre-decide. Open Questions block removed; resolutions absorbed into a "Notes for tech" list.
