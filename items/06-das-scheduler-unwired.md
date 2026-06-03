# 07 — DAS allocation scheduler unwired (P41 acceptance sweep, P191 held-allocation reroute, et al. inert)

> **Type:** Bug — **Implementation miss** (DAS OS prescribes the sweeps; the PRD prescribes them; the batch methods + endpoints exist; the scheduler is not wired in prod)
> **Ownership:** Tech owns the technical solution. PM owns the rollout-sequencing note that this item is **hard-blocked on Item 08**.
> **Service(s) to update:** `csp-demand-allocation-service` (scheduler infra + config flip). **Hard prerequisite: Item 08 must ship first.**
> **Owner (PM):** Ashis · **Filed:** 2026-05-29

---

## 1. Summary

The Demand-Allocation Service (DAS) has six sweep batches fully implemented — most importantly **P41 acceptance timeout** (reclaim ASSIGNED→UNASSIGNED if CSP doesn't respond in 2h) and **P191 held-allocation reroute** (re-enter routing for connections that exhausted P50 retries). Each is exposed at a `/internal/task/...` endpoint. Same wiring failure as CLOS (Item 06): `AWS_SCHEDULER_ENABLED: false` in prod, `scheduleRecurring(...)` has no callers, no scheduler dispatcher in place. **Net: 0 P41 reclaims in prod, 0 P191 reroutes, 230 UNASSIGNED rows never re-routed, 66/66 recent ASSIGNED-older-than-2h rows still ASSIGNED.**

**Critical — Item 07 cannot ship until Item 08 ships.** Today every successful allocation sits in `ASSIGNED` instead of `ACCEPTED` (Item 08). If P41 sweep is turned on with the current state-machine wiring, the sweep would reclaim **all 274 in-flight, in-the-middle-of-installing ASSIGNED rows back to UNASSIGNED** as if they had timed out — mass mis-routing of live customer installs. Sequence is non-negotiable.

---

## 1a. Parameters used in this item

| Term | Meaning |
|---|---|
| **P41** | DAS **acceptance window** — 2h cap on how long an allocation can sit in `ASSIGNED` before the system reclaims it to `UNASSIGNED` and re-routes. This is the headline sweep this item turns on. |
| **P50** | DAS **routing retries** — 5 attempts. Max attempts the routing engine makes to find an eligible CSP for a single allocation before declaring routing-failure. |
| **P51** | DAS **decline cooldown** — 4h. After a CSP declines a connection — **explicit decline OR P41 timeout** — that CSP cannot be re-assigned the same connection for this duration. (OS L872 / FM-DAO-02 explicitly mandates the timeout-also-triggers-cooldown semantics.) Item 02 fixed a bypass of this rule. |
| **P191** | DAS **held-allocation reroute** — cadence on which `UNASSIGNED` allocations that have exhausted P50 are re-attempted. Kicks in when initial routing couldn't find anyone (e.g. all eligible CSPs in P51 cooldown). |
| **P_DA_REALLOCATION_MAX_DWELL** | DAS **reallocation dwell** — 72h cap on `REALLOCATION_PENDING`. One of the four other sweep batches that share the same scheduler-wiring root cause but are out of scope for this item's spec. |

---

## 2. What's happening today

**PM's description:**
> *"DAS — scheduler unwired. P41 acceptance sweep, P191 reroute."*

**Evidence — prod DB / configs:**

- `services/csp-demand-allocation-service/src/main/resources/application-prod.yml:18` → `AWS_SCHEDULER_ENABLED: false`.
- `EventBridgeTaskScheduler.scheduleRecurring(...)` — **never called** in the DAS source tree.
- `BatchTriggerServiceImpl` exposes six methods: `runAllocationTimeoutSweep` (P41), `runHeldAllocationSweep` (P191), `runReallocationDwellSweep` (`P_DA_REALLOCATION_MAX_DWELL`), `runOverrideWatchdog`, `runConversionEval`, `runExposureRecalculation`. Each backed by an endpoint in `BatchTriggerController`. Compiled, reachable, unused.
- Prod DAS DB (`csp_demand_allocation_service.connection_allocations`):
  - **66 of 66** rows in state `ASSIGNED` with `entry_timestamp` older than 2h — none reclaimed by P41. Should be `UNASSIGNED` per OS.
  - **230 rows** in `UNASSIGNED` for >24h — never re-routed by P191. Should be either re-assigned or escalated to a routing-failure terminal state.
  - Zero `DECLINE_PATTERN` events with `pattern_type=TIMEOUT` in the last 90 days — confirms zero P41 fires.

Pattern is identical to CLOS (Item 06): the infrastructure side never landed; the service-side config flag stays `false`; nothing inside the service self-registers a recurrence.

---

## 3. What we want to happen

| Sweep | Anchor | Threshold | What should happen on fire | Today |
|---|---|---|---|---|
| **P41 acceptance** | `ASSIGNED` | 2h since entering ASSIGNED | If still ASSIGNED (no CSP_ACCEPTED signalled): T → `UNASSIGNED`. Emit `DECLINE_PATTERN(pattern_type=TIMEOUT)` for Quality OS. Connection re-enters routing on the next pipeline run. | Nothing fires. 66 connections stuck in ASSIGNED past 2h. |
| **P191 held-allocation reroute** | `UNASSIGNED` after P50 routing-retry exhaustion | (Per OS) — held-state max | T → re-enter routing pipeline. If pipeline now finds an eligible CSP (e.g. P51 cooldowns have expired), re-assign. If still ineligible, stay UNASSIGNED with the held-state extended. | Nothing fires. 230 connections sit UNASSIGNED indefinitely. |
| **P_DA_REALLOCATION_MAX_DWELL** | `REALLOCATION_PENDING` | 72h | T → reroute completion or escalation to routing-failure. | Nothing fires. *(Not in PM scope for this item but same root cause.)* |
| **Override watchdog** | Allocations with manual override flags | Per override-expiry config | Clear stale manual overrides; let routing engine resume normal behaviour. | Nothing fires. *(Not in PM scope.)* |

Plain English:

- **P41** is the CSP's acceptance window. Today acceptance is meant to be automatic (Item 08); P41 is supposed to be the **safety net** that catches the rare case where the auto-accept signal didn't land in DAS. Without P41 active, every such mis-fire becomes permanent (allocation stuck ASSIGNED, never reclaimed, never visible to ops).
- **P191** prevents UNASSIGNED rows from rotting forever when the initial routing burst couldn't find an eligible CSP (e.g. all in P51 cooldown). After cooldowns expire, P191's reroute tries again.

PM scope for this item is **P41 + P191**. The other batches (REALLOCATION_DWELL, override watchdog, conversion-eval, exposure-recalc) share the same wiring root cause but are not listed as items here — when tech wires the scheduler for P41 + P191, those batches are trivially co-wired. They are out of scope from the spec deliverable's perspective but tech should activate them in the same change.

---

## 4. What the OS says

`os/Demand_Allocation_OS_v1_9_1_LOCKED.md`:

- **P41 = 7200s (2h)** acceptance window — *"if CSP does not respond within P41, allocation reverts to UNASSIGNED and connection re-enters routing."*
- **P50 = 5** routing retries — *"after P50 exhaustion without successful assignment, emit `ALLOC_STATE_ROUTING_FAILURE`; allocation enters held state."*
- **P191** — held-allocation reroute interval (per OS table).
- **DECLINE_PATTERN signal on P41 fire** — *"timer expirations are treated as implicit declines for pattern-tracking purposes; pattern_type=TIMEOUT."*

OS treats P41 as a **mandatory automatic transition** — not advisory. The text "reverts to UNASSIGNED" is unconditional.

## 5. What the Spec / PRD says

`yaml-prd/demand-allocation-prd-v1.2.yaml`:

- State machine has `ASSIGNED → UNASSIGNED` via timeout (per P41).
- Held-allocation reroute is defined per P191.
- PRD describes `trigger_source = SYSTEM` for these transitions, parallel to CLOS's SYSTEM events.
- No prescription of *how* the sweep runs — correctly left to implementation.

## 6. What the Code does

- `services/csp-demand-allocation-service/src/main/resources/application-prod.yml:18` — `AWS_SCHEDULER_ENABLED: false`.
- `application/impl/BatchTriggerServiceImpl.java` — six sweep methods, correctly implemented.
- `api/BatchTriggerController.java` — six endpoints, bearer-token-protected, reachable, unused.
- `infrastructure/scheduler/EventBridgeTaskScheduler.scheduleRecurring(...)` — exists, never called.
- When `runAllocationTimeoutSweep` is invoked manually in qa, it correctly transitions ASSIGNED→UNASSIGNED for rows past P41 and emits the `DECLINE_PATTERN(TIMEOUT)` event. The transition logic is correct.

---

## 7. Where the gap / bug lives

| Layer | Defined? | Notes |
|---|---|---|
| OS (DAS) | ✓ Yes | P41 / P50 / P191 with thresholds + mandatory transitions. |
| Spec (DAS PRD v1.2) | ✓ Yes | State machine includes timeout transitions. |
| Code (DAS) | ✗ Partial | Batch methods correct + endpoints correct; **scheduler infra never wired**, config flag stays `false`. |
| Prod | ✗ Wrong | 66/66 ASSIGNED >2h not reclaimed; 230 UNASSIGNED never re-routed. |

Classification: **Bug — Implementation miss.** Identical pattern to Item 06.

## 8. Spec — handed to tech

### Today

- Allocations stuck in `ASSIGNED` indefinitely when the CSP never proceeds. (Item 08 has already shown that *every* allocation today is stuck in `ASSIGNED` for a different reason — auto-accept never wired — but even if Item 08 weren't a problem, the genuine "CSP ignored the booking" cases would still be stuck because P41 doesn't fire.)
- Allocations dropped to `UNASSIGNED` after P50 routing exhaustion sit there forever — P191 never re-attempts even after P51 cooldowns have long expired.
- Quality OS sees zero `DECLINE_PATTERN(TIMEOUT)` signals — its pattern detection on timeout-driven declines is dead.

### Want

**Both sweeps run on cadence; their state transitions and pattern signals fire on the standard DAS event paths.**

- **P41 fires (ASSIGNED >2h):** allocation transitions `ASSIGNED → UNASSIGNED`, `csp_id` cleared, `DECLINE_PATTERN(pattern_type=TIMEOUT, csp_id=<previously-assigned>, connection_id=...)` emitted to Quality OS. Connection re-enters routing on the next pipeline run.
- **P191 fires (UNASSIGNED held-state):** allocation re-enters routing pipeline. Pipeline picks the best currently-eligible CSP using the existing 7-stage routing flow. If found → ASSIGNED with new CSP. If not found → still UNASSIGNED with held-state extended.
- **DECLINE_PATTERN(TIMEOUT)** events become visible to Quality OS / Enforcement OS for the first time; consumer behaviour is whatever those services already do with EXPLICIT decline patterns — same handler.

### What more is required to make these work — sequencing and install-service interventions

**This item is hard-blocked on Item 08.** Reason and unavoidable consequence:

| Scenario | If Item 07 ships WITHOUT Item 08 | If Item 08 ships first, then Item 07 |
|---|---|---|
| The 274 currently-`ASSIGNED` rows (live, in-progress installs, partner has the booking and is proceeding) | First P41 sweep run reclaims **all 274 rows** to `UNASSIGNED`. Partner loses the booking mid-install. Customer sees the install stop. Mass re-routing chaos. | All 274 rows are in `ACCEPTED` (correct state per Item 08); P41 sweep only reads `ASSIGNED`-anchored rows, so it skips them. Only genuinely-unaccepted-for-2h rows are touched. Safe. |
| Future allocations | Every new allocation lands in `ASSIGNED`, auto-accept signal doesn't update DAS state (Item 08), 2h later P41 reclaims it back to `UNASSIGNED`. Routing loops: re-assign → 2h → reclaim → re-assign. | Every new allocation lands in `ASSIGNED` for a brief moment, then `ACCEPTED` via the Item 08 mechanism. P41 only catches the rare case where the Item 08 signal failed. Acts as safety net, as the OS intended. |

**Other install-service interventions:**

- **None for P41 beyond Item 08.** The P41 sweep transitions are DAS-internal; downstream consumers (TAS, CL, Quality) already handle `DECLINE_PATTERN(TIMEOUT)` via the same path as `DECLINE_PATTERN(EXPLICIT_DECLINE)`.
- **None for P191.** UNASSIGNED→ASSIGNED via reroute is the same path as the original routing; the new `ALLOCATION_ACCEPTED` event flows to TAS as a normal new-allocation event. TAS already handles re-allocation events.

### Edge cases (business)

1. **Same CSP reclaimed by P41, then immediately re-routed back to the same zone.** Per OS L872 / FM-DAO-02, the timed-out CSP enters P51 cooldown for that connection — so the routing engine excludes them on the next pass (assuming Item 02's cooldown-bypass fix has shipped). If the zone has other eligible CSPs, one of them gets the booking; if not, OS L540 applies (service vacuum accepted). No code change for this — the existing pattern handler already triggers P51 on `DECLINE_PATTERN`, and the OS does not distinguish EXPLICIT vs TIMEOUT for cooldown purposes.
2. **P191 fires on a connection where the original assignee has since been suspended (FPV/SUSPENDED).** Routing pipeline already excludes suspended CSPs (DAS OS L540, "service vacuum accepted") — pipeline returns ineligible, allocation stays UNASSIGNED, P191 extends held-state. No new behaviour.
3. **P191 fires on a connection that has been UNASSIGNED for >P75 (7d) — CLOS will deactivate the parent connection.** Sweep should still attempt reroute; CLOS deactivation event will cascade in via the existing path. No coordination needed between the two sweeps — they both touch their own state machines.

### Notes for tech

- **P51 cooldown on P41 timeout:** OS L872 (FM-DAO-02) mandates that the timed-out CSP enters P51 cooldown for that connection — same as an explicit decline. The existing `DECLINE_PATTERN` handler already triggers P51 from the `EXPLICIT_DECLINE` path; emitting `DECLINE_PATTERN(pattern_type=TIMEOUT)` through the same handler is sufficient. **No new gating on `pattern_type` needed.**
- **Sweep cadence:** tech's choice, up to **15-minute granularity** (PM accepts the implication that P41 may fire up to a sweep-period late).
- **P191 customer-facing escalation** (e.g. SMS the customer "we couldn't find an installer" after N days UNASSIGNED): **out of scope** for this item. Today an UNASSIGNED row sits silently; that stays the case after this fix. If we want a customer-facing escalation later, it is a new item.

### Out of scope

- **The other 4 DAS sweep batches** (`reallocation_dwell`, `override_watchdog`, `conversion_eval`, `exposure_recalc`). Tech should co-wire them when the scheduler infra is stood up — but they are not part of this item's behavioural spec.
- **Quality OS / Enforcement OS consumer changes** for the newly-emitted `DECLINE_PATTERN(TIMEOUT)` events. They already have the EXPLICIT_DECLINE handler; tech should sanity-check that TIMEOUT lands on the same path.
- **Backfilling the 230 UNASSIGNED rows on first P191 sweep.** Same first-fire concern as Item 06 — controlled rollout.

---

## 9. Risks / interactions

- **Hard prerequisite: Item 08.** This is the headline risk. Without Item 08, P41 sweep destroys live installs. Recommended rollout sequence: Item 08 → Item 07 → Item 06 (Item 06's T3-retry path also benefits from Item 08 being fixed, since reroutes after T3 land in the new ACCEPTED-state model cleanly).
- **First P41 sweep activation in prod.** Even after Item 08, there may be a small backlog of "genuinely stuck ASSIGNED" rows from edge-case auto-accept failures. Tech should run the first sweep in a controlled window.
- **First P191 sweep activation.** 230 stuck UNASSIGNED rows will all attempt to reroute simultaneously — load spike on routing pipeline. Tech should phase or rate-limit.
- **Item 02 interaction.** Item 02's P51 cooldown bypass fix and Item 07's TIMEOUT-driven cooldown question (Open Q1) overlap. Treat them as one block during rollout if PM answers Open Q1 = "timeout counts as decline."
- **Single-CSP zones (cross-ref Item 02).** Once P41 reclaims a single-CSP-zone allocation, that CSP is the only eligible one. Item 02 (now fixed) keeps the cooldown active, so reroute correctly fails with `ROUTING_FAILURE` — service vacuum accepted per OS L540. Consistent.

## 10. References

- **OS:** `os/Demand_Allocation_OS_v1_9_1_LOCKED.md` — P41 (acceptance window), P50 (routing retries), P51 (decline cooldown), P191 (held-allocation reroute), DECLINE_PATTERN spec, L540 (service-vacuum-accepted).
- **Spec:** `yaml-prd/demand-allocation-prd-v1.2.yaml` — state machine, sweep transitions, `trigger_source = SYSTEM`.
- **Code (DAS):** `services/csp-demand-allocation-service/src/main/resources/application-prod.yml:18` · `application/impl/BatchTriggerServiceImpl.java` (six sweep methods) · `api/BatchTriggerController.java` (six endpoints) · `infrastructure/scheduler/EventBridgeTaskScheduler.scheduleRecurring(...)` (never called).
- **Related project notes:** [[cl-timer-enforcement-gap]] BUG-2 (same finding for DAS).
- **Hard dependency:** **Item 08** (DAS state never reaches ACCEPTED).
- **Related items:** Item 02 (P51 cooldown bypass — interacts with Open Q1 here) · Item 06 (parallel scheduler-wiring fix in CLOS).

## 11. Investigation log

- **2026-05-29 — filed.** Extracted from prior CL-timer-enforcement investigation (memory: `cl-timer-enforcement-gap`, BUG-2). Confirmed against current `main`: `AWS_SCHEDULER_ENABLED: false` in DAS `application-prod.yml`; `scheduleRecurring(...)` still has zero callers in DAS; `BatchTriggerServiceImpl` still has six unused sweep methods; prod DB still has 66/66 ASSIGNED>2h not reclaimed and 230 UNASSIGNED never re-routed. Classified as **Bug — Implementation miss.** Filed **as hard-blocked on Item 08** per PM direction.
- **2026-05-29 — Open Questions resolved.** PM closed all three: (1) **P51 cooldown applies on P41 TIMEOUT** — validated against OS L872 / FM-DAO-02 ("ASSIGNED CSP does not respond within P41 → P51 cooldown applies for that connection"). No new code gating needed; existing pattern handler already triggers cooldown. (2) **Sweep cadence = 15-min granularity acceptable.** (3) **P191 customer-facing escalation = out of scope** for this item. Open-questions block removed; resolutions absorbed into glossary, edge case 2, and a compact "Notes for tech" block.
