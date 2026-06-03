# 06 — CLOS timeout scheduler unwired (P74 / P75 / P76 / P77 / P78 inert)

> **Type:** Bug — **Implementation miss** (CL OS defines the timers; spec defines the batches; code wires the batch methods + endpoints; nobody flipped the AWS scheduler on)
> **Ownership:** Tech owns the technical solution — infra + caller wiring. PM owns the install-service intervention spec (§8 below) and CL-PRD note for retry-handling.
> **Service(s) to update:** `csp-connection-lifecycle-service` (scheduler infra + config flip), `csp-tas-service` (T3-retry handling intervention)
> **Owner (PM):** Ashis · **Filed:** 2026-05-29

---

## 1. Summary

The Connection Lifecycle Service (CLOS) has five **timeout sweep batches** fully implemented in code — install window (P74), request expiry (P75), pause max (P76), deactivation timeout (P77), retry exhaustion (P78). Each is exposed as an `/internal/task/process-*` endpoint. The OS prescribes them, the PRD prescribes them, the service compiles and exposes them. **But the AWS EventBridge scheduler that was supposed to call them is disabled in prod, and no code path inside CLOS calls `scheduleRecurring(...)` to register the recurrence. Net effect: zero system-driven CL transitions in prod in the last 90 days.** Connections that exceed P74 / P75 / P76 / P77 silently stay in their pre-timeout state forever.

For these to work end-to-end on the install flow, **the install service (TAS) also needs to react when P74 fires a T3 retry** — today TAS no-ops on `entry_reason=RETRY`, which would orphan the old install candidate. That intervention is part of this item (§8).

---

## 1a. Parameters used in this item

| Term | Meaning |
|---|---|
| **P74** | CL **install window** — 72h hard cap on how long a connection can sit in `PENDING_INSTALL` before the system either retries it or kills it. |
| **P75** | CL **request expiry** — 7-day cap on how long a connection can sit in `REQUESTED` (i.e. no CSP has been assigned yet) before auto-deactivation. |
| **P76** | CL **pause max** — 90-day cap on how long a connection can stay `PAUSED` before auto-deactivation. |
| **P77** | CL **deactivation timeout** — **45 days** cap on how long a connection can sit in `PENDING_DEACTIVATION` before being forced to `DEACTIVATED`. Value lives in AWS / Tier-2 param store (45d, PM-confirmed canonical); OS doc table still shows the older 30d default — minor doc-drift, not blocking. |
| **P78** | CL **install retry cap** — 3 retries before retry-exhaustion forces permanent deactivation (T12 path inside P74). Scope is **global per-connection** (counts `PENDING_INSTALL → REQUESTED` cycles regardless of which CSP each attempt is routed to) — per OS L460. |

---

## 2. What's happening today

**PM's description:**
> *"CLOS — timeout scheduler unwired. P74 / P75 / P76 / P77 / P78 not getting triggered."*

**Evidence — prod DB / configs:**

- `services/csp-connection-lifecycle-service/src/main/resources/application-prod.yml:18` → `AWS_SCHEDULER_ENABLED: false`
- `EventBridgeTaskScheduler.scheduleRecurring(...)` — the only method that registers a recurrence with AWS EventBridge — **never called from anywhere in the CLOS source tree.**
- `SchedulingServiceImpl` exposes five batch methods (`processInstallTimeoutBatch`, `processRequestExpiryBatch`, `processPauseExpiryBatch`, `processDeactivationTimeoutBatch`, `processRetryExhaustionBatch`); each is fronted by an `/internal/task/process-*` endpoint in `InternalTaskController`. Endpoints are reachable, methods are correct — they just never get called.
- Prod CLOS DB (`csp_connection_lifecycle.connections`):
  - **0** events with source `SYSTEM` in the last 90 days (`event_log` query: `source='SYSTEM' AND created_at > now() - INTERVAL '90 days'` → no rows).
  - **50** connections in `PENDING_INSTALL` longer than P74 (oldest: `2026-04-21`, ≈ 38 days). Per spec, every one of these should already be in REQUESTED (retry) or PENDING_DEACTIVATION (exhausted) — they sit untouched.
  - Connections in `REQUESTED` older than P75 (7d) likewise sit untouched — never expired.
  - Connections in `PENDING_DEACTIVATION` past P77 — never deactivated.

**Cause is a clean wiring gap:** the *infrastructure* side (AWS EventBridge schedule rules + IAM + the bearer-token-protected dispatcher that hits `/internal/task/process-*`) was never stood up in prod; the service-side config flag stays `false`; nothing inside the service self-registers a recurrence either. Three independent places where the wire never landed.

---

## 3. What we want to happen

Five P-timers, each with one clear job. Below is the **business expectation** — tech picks the dispatcher (AWS EventBridge schedule rule + Lambda dispatcher hitting `/internal/task/process-*`, in-process scheduled task, whatever — not a PM concern).

| Timer | Anchor state | Threshold | What should happen when it fires | Today |
|---|---|---|---|---|
| **P74** | `PENDING_INSTALL` | 72h since entering PENDING_INSTALL | If `retry_count < P78`: T3 → `REQUESTED` (`entry_reason = RETRY`). If `retry_count >= P78`: T12 → `PENDING_DEACTIVATION` (`deactivation_reason = RETRY_EXHAUSTION`). | Nothing fires. Connection sits in PENDING_INSTALL indefinitely. |
| **P75** | `REQUESTED` | 7 days since entering REQUESTED | T9 → `DEACTIVATED` with `deactivation_reason = REQUEST_EXPIRED`. | Nothing fires. Customer waits forever; no expiry. |
| **P76** | `PAUSED` | 90 days since entering PAUSED | T → `DEACTIVATED` with `deactivation_reason = PAUSE_MAX_EXCEEDED`. | Nothing fires. Long-paused connections never auto-deactivate. |
| **P77** | `PENDING_DEACTIVATION` | **45 days** (canonical; sourced from AWS param store) | T → `DEACTIVATED` with `deactivation_reason = DEACTIVATION_TIMEOUT`. | Nothing fires. Connection stays in PENDING_DEACTIVATION forever (downstream services that wait for DEACTIVATED also stall). |
| **P78** | `PENDING_INSTALL` (cap, not standalone timer) | `retry_count >= 3` | Triggered together with P74 — see P74 row's exhausted branch. | Same as P74. |

Plain-English summary:

- **P74** is the install-window timeout. If the CSP didn't get to arrival within 72h, give the connection a retry; if it's already had 3 retries, kill it.
- **P75** kills bookings that nobody ever picked up (REQUESTED with no CSP) after a week.
- **P76** kills paused connections after 90 days of inactivity.
- **P77** finishes deactivation when the deactivation paperwork (CL cleanup, asset return, etc.) takes too long — gives a hard cap.
- **P78** is the retry cap (3 retries) — it lives inside P74's exhausted branch, not as a standalone sweep.

---

## 4. What the OS says

`os/Connection_Lifecycle_OS_v1_6_LOCKED.md`:

- **P74_INSTALL_WINDOW** = 72h; transitions T3 (retry) and T12 (exhausted) are defined on PENDING_INSTALL.
- **P75_REQUEST_MAX_WAIT** = 7d on REQUESTED.
- **P76_PAUSE_MAX_DURATION** = 90d on PAUSED.
- **P77_DEACTIVATION_TIMEOUT** — value listed as 30d in the OS doc table; PM has overridden to 45d (Open Q1).
- **P78_INSTALL_MAX_RETRIES** = 3 retries before retry-exhaustion path is taken.

The OS treats these as *automatic system transitions* — there is no "actor" involved. The expectation is that the service itself fires them on the cadence (CL's "system source" event class).

## 5. What the Spec / PRD says

`yaml-prd/connection-lifecycle-prd-v1.6.yaml`:

- State machine includes T3, T9, T12, plus pause/deactivation timeouts — all listed with their respective P-anchors.
- The PRD describes `system_source = SYSTEM` for these transitions, distinct from `USER_INITIATED` (Item 05) and `UPSTREAM` (events from other OS aggregates).
- No prescription of *how* the sweep runs (cron vs in-process scheduler vs external dispatcher) — that is correctly left as an implementation choice.

## 6. What the Code does

For evidence — tech will design the implementation.

- `services/csp-connection-lifecycle-service/src/main/resources/application-prod.yml:18` — `AWS_SCHEDULER_ENABLED: false`.
- `application/impl/SchedulingServiceImpl.java` — five batch methods, each correctly implementing the corresponding P-timer's transition. They are correct; they are unreachable in prod.
- `api/InternalTaskController.java` — exposes the five batches at `/internal/task/process-install-timeout`, `/internal/task/process-request-expiry`, `/internal/task/process-pause-expiry`, `/internal/task/process-deactivation-timeout`, `/internal/task/process-retry-exhaustion`. Reachable, bearer-token-protected, unused.
- `infrastructure/scheduler/EventBridgeTaskScheduler.scheduleRecurring(...)` — exists; **the only way to register a recurrence — never called.** No `@PostConstruct` registration, no Spring startup hook, nothing.
- The CL "system source" code path is intact — when the batch methods *are* called manually (e.g. via curl in qa), they emit correctly and transitions land in DB. Verified in qa.

---

## 7. Where the gap / bug lives

| Layer | Defined? | Notes |
|---|---|---|
| OS (CL) | ✓ Yes | P74 / P75 / P76 / P77 / P78 defined with anchors, thresholds, and transitions. |
| Spec (CL PRD v1.6) | ✓ Yes | T3, T9, T12, pause/deactivation timeouts all in the state machine with `system_source = SYSTEM`. |
| Code (CLOS) | ✗ Partial | Batch methods correct + endpoints correct; **scheduler infra never wired**, config flag stays `false`. |
| Code (TAS) | ✗ Gap | TAS does not handle the T3 retry signal — once P74 starts firing, the old install candidate would be orphaned (see §8 intervention). |
| Prod | ✗ Wrong | 0 SYSTEM events in 90d; 50 connections past P74 still in PENDING_INSTALL. |

Classification: **Bug — Implementation miss.** The OS and PRD are correct; the service-side code is correct; the *wiring* — both the config flag and the EventBridge scheduling infra — was never landed in prod. The TAS-side intervention is a co-fix needed to make the P74 retry path work safely; on its own it's a small ES PRD addition.

## 8. Spec — handed to tech

### Today

- The five timeout sweeps exist in code but never run. Connections that should be advancing through CL states on a timer simply stop where they are.
- Most visible failure: install booking where the CSP doesn't arrive within 72h stays in PENDING_INSTALL forever instead of retrying or expiring.

### Want

**The five sweeps run on the cadence described in §3, and their state transitions emit the standard CL system events for downstream consumers.**

Each transition emits the existing CL event(s) on the standard path:

- **P74 → T3 (retry):** CL emits `CL_STATE_CHANGED` with `transitionType=T3`, `entry_reason=RETRY`, `retry_count` incremented. DAS receives it and re-routes (which is where Item 07's P41 sweep + Item 08's accepted-state fix come into play).
- **P74 → T12 (exhausted):** CL emits `CL_DEACTIVATION_INITIATED` with `deactivation_reason = RETRY_EXHAUSTION`. TAS receives it (today path — `cancelByUpstream`). Item 05's cause-bifurcation fix routes this to the correct candidate-cancellation reason.
- **P75 → T9 (REQUEST_EXPIRED):** CL emits `CL_DEACTIVATION_INITIATED` with `deactivation_reason = REQUEST_EXPIRED`. No active TAS candidate for REQUESTED-state connections, so no TAS impact.
- **P76:** Post-install state. The TAS install candidate is already terminal (`CONNECTION_ACTIVE`). No install-service impact.
- **P77:** PENDING_DEACTIVATION post-state. The TAS install candidate is already terminal (CANCELLED_BY_* on entry to PENDING_DEACTIVATION). No install-service impact.

### What more is required in the install service (TAS) — co-fix

**One TAS intervention is needed before P74 can ship safely.** Today, when CL fires a T3 retry, TAS no-ops because its `UPSTREAM_RETRY_TRIGGERS` set only contains T11 / T12, not T3. The behavioural fix is plain:

| When CL emits | Today TAS does | Should do |
|---|---|---|
| `CL_STATE_CHANGED transitionType=T3` (P74 retry) | Logs *"no action required"*; old install candidate stays OPEN | Close the current install candidate (`CANCELLED_BY_UPSTREAM` with reason `RETRY`). When DAS reroutes and fires the new `ALLOCATION_ACCEPTED`, a fresh install candidate is created cleanly. |

Without this, the moment P74 starts firing in prod, every PENDING_INSTALL retry would leave an orphaned `AWAITING_SLOT_PROPOSAL` (or later-state) candidate in TAS, plus create a new one — visible to the partner as duplicate bookings.

P75 / P76 / P77 do not require TAS interventions (the install candidate is either non-existent or already terminal by the time those timers fire).

### Edge cases (business)

1. **P74 fires after a CSP-reported install failure.** CL would already have processed the explicit failure (T11) — the connection is no longer in PENDING_INSTALL. Sweep skips.
2. **CSP slot is set but day-of-install passes without arrival (e.g. slot was T+24h, CSP no-show at slot).** P74 still anchors on PENDING_INSTALL entry, not on the slot. T+72h since PENDING_INSTALL → P74 fires regardless of the slot timing. *(PM acknowledges this is the OS-defined anchor; PM not asking to change.)*
3. **Connection enters PENDING_INSTALL twice within the same P74 cycle (re-allocation immediately after a decline).** Each PENDING_INSTALL entry resets the P74 clock — the second 72h count starts fresh from the second entry. The CL state machine's existing `entry_timestamp` handles this; sweep reads `entry_timestamp`, not original-create timestamp.
4. **P75 fires while a stale TAS candidate from a previous allocation still exists.** This is a residual cleanup question (e.g. T3 happened, TAS didn't close the old candidate, then connection sat in REQUESTED for 7d → P75 fires). Mitigated by the T3 co-fix above — once T3 closes candidates correctly, REQUESTED has no live TAS candidate to orphan.
5. **P77 fires while ACS still holds router asset for the connection.** Out of scope for this item — ACS has its own retrieval flow that should already be running on entry to PENDING_DEACTIVATION. P77 just hard-caps the wait; downstream cleanup is its own problem.
6. **Retry count already at P78 when P74 fires.** Sweep takes the exhausted branch (T12 → PENDING_DEACTIVATION with `RETRY_EXHAUSTION`). No silent loop.

### Notes for tech

- **Sweep cadence:** tech's choice, up to **15-minute granularity**. PM accepts the implication that timers can fire up to a sweep-period late (e.g. P75 may fire up to 15 min after the 7-day mark).
- **Retry-cap scope:** P78 stays global per-connection (per OS L460, current code matches). No per-CSP scoping in this item.
- **P77 value:** 45 days is canonical (AWS param store). The OS doc table still shows the older 30d default — minor doc-drift, optional follow-up on the next OS-doc revision; not blocking.

### Out of scope

- **CSP / customer notifications around the timeout firings** (e.g. "your booking is in retry," "your request expired"). Separate item if PM wants them.
- **Exit OS S4 routing on RETRY_EXHAUSTION / REQUEST_EXPIRED.** Exit OS is not implemented today; the deactivation reasons land in CL but no consumer reads them yet — not blocking.
- **Backfilling the 50 stuck-PENDING_INSTALL connections on first sweep activation.** Tech decides whether the first sweep run reclaims them all (which would be a one-time mass-deactivation event in prod) or whether a staged manual reconciliation is preferred. Tracking note for ops, not a spec change.

---

## 9. Risks / interactions

- **First sweep activation in prod will produce a flood.** 50 stuck PENDING_INSTALL connections, an unknown number of stuck REQUESTED / PENDING_DEACTIVATION / PAUSED ones. Tech should run the first sweep in a controlled window, not at peak traffic, and notify ops.
- **Hard dependency on Item 08 (DAS state ACCEPTED) before Item 07 (P41 sweep).** Not a direct dependency for *this* item — CLOS sweeps and DAS sweeps live in different services — but if Item 06 starts firing P74-T3 retries while Item 08 is still broken, the retry loop's new ALLOCATION_ACCEPTED would re-land at DAS state ASSIGNED (not ACCEPTED), repeating Item 08's symptoms in the retried connection. The cleanest rollout is Item 08 first → Item 07 → Item 06. (See cross-item sequencing note in README.)
- **TAS co-fix is small but mandatory.** Without it, the first P74-T3 fire orphans 50 install candidates in prod. Recommended: tech ships TAS T3-handling first, verify no orphans on qa, then flip the CLOS scheduler.
- **CL system-source events were the prior gap for downstream sweep visibility.** Once they start emitting, downstream services (TAS, DAS, Quality, ACS) will see CL `transitionType=T3 / T9 / T12 / DEACTIVATION_TIMEOUT / PAUSE_MAX_EXCEEDED` events for the first time in prod. Each consumer should be checked for "do I handle this transition? am I a no-op? do I crash?" — tech reviewer call.

## 10. References

- **OS:** `os/Connection_Lifecycle_OS_v1_6_LOCKED.md` — parameters P74 / P75 / P76 / P77 / P78; transitions T3, T9, T12, pause/deactivation timeouts.
- **Spec:** `yaml-prd/connection-lifecycle-prd-v1.6.yaml` — state machine + system-source transitions.
- **Code (CLOS):** `services/csp-connection-lifecycle-service/src/main/resources/application-prod.yml:18` (`AWS_SCHEDULER_ENABLED: false`) · `application/impl/SchedulingServiceImpl.java` (the five batch methods) · `api/InternalTaskController.java` (the five endpoints) · `infrastructure/scheduler/EventBridgeTaskScheduler.scheduleRecurring(...)` (never called).
- **Code (TAS) — co-fix site:** `services/csp-tas-service/src/main/java/.../inbound/ClStateChangedHandler.java` — `UPSTREAM_RETRY_TRIGGERS = {"T11", "T12"}`, T3 missing.
- **Related project notes:** [[cl-timer-enforcement-gap]] BUG-1 (this is the same finding, expanded with the TAS co-fix scope) · [[install-flow-reference]] for the upstream-event consumer map.

## 11. Investigation log

- **2026-05-29 — filed.** Extracted from prior CL-timer-enforcement investigation (memory: `cl-timer-enforcement-gap`, BUG-1) and combined with the TAS T3-retry-handling co-fix (which was tracked separately in the prior thread). Confirmed against current `main`: `AWS_SCHEDULER_ENABLED: false` in `application-prod.yml`, `scheduleRecurring(...)` still has zero callers, `UPSTREAM_RETRY_TRIGGERS` in TAS still `{T11, T12}`. Classified as **Bug — Implementation miss.**
- **2026-05-29 — Open Questions resolved.** PM closed all three: (1) **P77 = 45d canonical** (sourced from AWS param store; OS doc's 30d figure is stale doc-drift, optional follow-up); (2) **P78 retry cap scope = Global per-connection** — verified against `Connection_Lifecycle_OS_v1_7_1_LOCKED.md:460` (`N_install_retry_max`, Scope: Global, Value: 3) and `SchedulingServiceImpl.java:118` matches the OS — no change; (3) **Sweep cadence = 15-min granularity acceptable** to PM. Item is now unambiguous from PM's side; tech can ship.
