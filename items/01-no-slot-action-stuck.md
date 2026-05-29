# 01 — Connection stuck when CSP doesn't propose a slot

> **Type:** Gap (missing capability across ES PRD, TAS code, partner app, notification stack)
> **Service(s) to update:** ES PRD (`es-installation-service-prd-v2.5` → next minor) · `csp-tas-service` (implementation against the new spec, tech-owned) · `csp-notification-service` + CleverTap (two new events) · partner app (countdown + warning UI). **No OS change** — the 4h SLA lives entirely in the ES PRD. **No DAS change** — existing reroute path is reused.
> **Owner (PM):** Ashis · **Filed:** 2026-05-29

---

## 1. Summary

After a CSP is allocated a connection, the install candidate enters `AWAITING_SLOT_PROPOSAL`. If the CSP does nothing — never opens the task, never proposes a slot — the candidate sits there indefinitely. There is **no state-machine path out via expiry** for that pre-arrival state, **no working timer** to evict the CSP, and consequently **no D&A reroute**. The customer remains permanently blocked, and the CSP keeps the booking with zero accountability.

---

## 1a. Parameters used in this item

| Term | Meaning |
|---|---|
| **P74** | CL **install window** — 72h hard cap on how long a connection can sit in `PENDING_INSTALL`. The overall envelope inside which this item's new 4h slot-proposal SLA lives. |
| **P78** | CL **install retry cap** — 3 retries before retry-exhaustion forces permanent deactivation. Determines how many times the new 4h SLA's reroute can fire on a given connection. |
| **P51** | DAS **decline cooldown** — 4h. After a CSP "exits" (this item's path) or declines, that CSP is excluded from being re-assigned the same connection for 4h. |
| **P41** | DAS **acceptance window** — 2h. The post-reroute acceptance window for the *next* CSP, once this item's reroute fires. |
| **4h SLA (new)** | This item's introduced **slot-proposal SLA** — lives entirely in the ES PRD, not OS. Times out if the CSP doesn't propose a slot within 4 hours of receiving the booking. Warning at T+3h, reroute at T+4h. |

---

## 2. What's happening today

**PM's description:**
> *"If the CSP doesn't take any action on the connection assigned to him, it stays with him."*

**Evidence — prod DB (`csp_tas_service.install_execution_candidates`, last 7 days, `AWAITING_SLOT_PROPOSAL` only):**

| candidate_id (head) | connection_id | csp_id | hrs since create | hrs since update | proposed_slot |
|---|---|---|---|---|---|
| 0711dcfb… | f38c4c02-…b90a14248f | a0a7e3 | **157.7** | 121.9 | null |
| d43b8eb4… | c69c160c-…4f9bf8b8 | a0a7d3 | 144.8 | 142.9 | null |
| 6c78a427… | eaaf8fcc-…81864a5 | a0a7e3 | 142.6 | 121.9 | null |
| 7e9f74d7… | 6c14d4d3-…02deed17 | a0a7g4 | 141.0 | 140.7 | null |
| 5e946872… | acb05f7d-…1e26172ba | a0a7b0 | 139.8 | 133.4 | null |
| … 5 more rows, all >87h since create, all with `proposed_slot_date = null` … |

The oldest is **6.5 days** in `AWAITING_SLOT_PROPOSAL` with the CSP never having proposed a slot. The CL connections corresponding to these are the same ones already known to be violating P74 (see [[cl-timer-enforcement-gap]]).

**Query used:**
```sql
SELECT execution_candidate_id, connection_id, csp_id,
       ROUND(EXTRACT(EPOCH FROM (NOW() - created_at))/3600, 1) AS hours_since_create,
       ROUND(EXTRACT(EPOCH FROM (NOW() - updated_at))/3600, 1) AS hours_since_update,
       proposed_slot_date, confirmed_slot_date
FROM csp_tas_service.install_execution_candidates
WHERE current_state='AWAITING_SLOT_PROPOSAL' AND task_status='OPEN'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at ASC;
```

---

## 3. What we want to happen

**PM's desired outcome:**
> *"If the booking is not getting actioned, it should be retriggered so that some other CSP (who could get it installed) does so."*

**Mapped to OS / Spec language:**

After the CSP is allocated, if no slot is proposed within **`T_slot_proposal_window = 4h`** (matching `P51 = 4h` cooldown), the TAS install candidate must **expire** → propagate `INSTALLATION_FAILED(TIMEOUT_SLOT_PROPOSAL)` to CL → fire `T3` (retry, `retry_count++` if `retry_count < P78`) → D&A reroutes to a different CSP. D&A's `addDeclineCooldown(...)` (already wired) adds the failing CSP to the P51 cooldown list so the routing engine excludes the inactive CSP from re-selection.

In addition, a **warning is sent to the CSP at T+2h** (`T_slot_proposal_warn`) so the partner has a chance to act before reassignment. The warning and the reassignment are both surfaced to the partner via:

- a **push notification** (driven by a new CleverTap event), and
- the **partner app UI** (countdown on the task card from T+0; amber warning state at T+2h; "Reassigned" badge after T+4h).

None of this exists today — neither the SLA, the warning, the CT events, nor the app UI. We need a new OS parameter, a TAS expiry emitter, a notification-service hook, and a partner-app design change.

---

## 4. What the OS says

`Connection_Lifecycle_OS_v1_7_1_LOCKED.md` only defines **one** time bound across the entire `PENDING_INSTALL` window:

> *S5:456* — `P74 / T_install_window — Max time in PENDING_INSTALL before system-triggered INSTALLATION_FAILED — 72 hours`

There is **no slot-proposal sub-SLA** in the LOCKED CL OS. The Demand & Allocation OS (`Demand_Allocation_OS_v1_9_1_LOCKED.md`) defines `P41 = 2h` for the *acceptance window* (`ASSIGNED → UNASSIGNED`), but that fires *before* the CSP has accepted the assignment — and in the live system auto-accept fires within ~130 ms, so P41 never bites the slot-proposal case. Once CL has emitted `T1` and the candidate is in `AWAITING_SLOT_PROPOSAL`, the **only** OS-defined backstop is the 72-hour P74 — and as established in [[cl-timer-enforcement-gap]], that timer is itself dead in prod.

**Net OS gap:** the OS does not contemplate "CSP accepted the allocation but is ignoring the task" as a distinct failure mode requiring its own SLA. It treats all pre-activation time as one P74 bucket.

## 5. What the Spec / PRD says

`yaml-prd/es-installation-service-prd-v2.4.yaml`:

> *L536–537* — `AWAITING_SLOT_PROPOSAL: "Partner must propose a slot (up to ES_INSTALL_MAX_SLOTS_CONFIG_PER_DAY per day)."`

The spec **does** define a *reminder* — `SLOT_PROPOSAL_URGENT`, scheduled at +1h after entry to `AWAITING_SLOT_PROPOSAL` (a `THRESHOLD_CROSSING` attention, i.e. a UI nudge to the CSP). It does **not** define a state-machine exit via expiry. `INSTALLATION_EXPIRED` (the only expiry terminal) is reachable only from **post-arrival** states (L672):

> *L672* — `to: INSTALLATION_EXPIRED — trigger: TIMER_TASK_EXPIRED — task-expiry-days idle window elapsed (effective 90d per Java field; yml fallback 15d does not bind — see OPEN-PARAM-1). AMENDMENT-03 DIFF F.`

The AMENDMENT-03 changelog (L93–94, L137–141) records the deferred work explicitly:

> *L93–94* — `OPEN-PARAM-2 (NEW) — AMENDMENT-03 DIFF A's "task-expiry-days = 15d" claim is documentation-only. Effective runtime = 90d.`
> *L138* — `AMENDMENT-03 SHIPPED SUBSET — DIFF A — install.task-expiry-days = 15d`

And the v3 risk note (already quoted in the CL-timer audit):

> *CandidateWorkflowServiceImpl.java:986* — *"No candidate currently reaches INSTALLATION_EXPIRED (no TIMER_TASK_EXPIRED emitter is wired; DIFF I is deferred)."*

So the spec acknowledges expiry exists conceptually (90d/15d for idle), but limits it to post-arrival, and the emitter is unimplemented. **Nothing in the spec covers pre-arrival expiry — and certainly nothing for "slot not proposed in X hours."**

## 6. What the Code does

`csp-tas-service` (the install module):

1. **Reminder is scheduled, expiry is not.** `CandidateWorkflowServiceImpl.onAllocationAccepted` calls `reminderScheduler.schedule(connectionId, ReminderType.SLOT_PROPOSAL_URGENT, now.plus(params.getSlotProposalUrgentHours()))`. The threshold is config-driven:

   > `application.yml:261` — `slot-proposal-urgent-hours: ${ES_INSTALL_SLOT_PROPOSAL_URGENT_HOURS:1h}`

   When this fires, it bumps the candidate's attention via `onThresholdReminder(...)` — a UI escalation, not a state exit.

2. **State machine has no `TIMER_TASK_EXPIRED` from `AWAITING_SLOT_PROPOSAL`.** `InstallationStateMachine.java:226–230` wires `TIMER_TASK_EXPIRED → INSTALLATION_EXPIRED` only from `ARRIVED_AT_SITE`, `INSTALLATION_IN_PROGRESS_PRE_FEE`, `FEE_COLLECTION_PENDING`, `INSTALLATION_IN_PROGRESS_POST_FEE`, `AWAITING_CUSTOMER_OTP`. Pre-arrival states are absent. The valid-triggers map for `AWAITING_SLOT_PROPOSAL` (line 87–88) contains only `PROPOSE_SLOT`, `REPORT_INSTALLATION_FAILED`, `CANCELLED_BY_UPSTREAM`, `CANCELLED_BY_CUSTOMER`.

3. **Guard explicitly forbids pre-arrival `INSTALLATION_EXPIRED`.** `InstallationGuards.java:212–226` — *"INSTALLATION_EXPIRED may only be entered via the TIMER_TASK_EXPIRED trigger and only from a post-arrival in-flight state."* Pre-arrival expiry would be rejected by GUARD-ES-INSTALL-19 even if a caller tried to drive it.

4. **`expireCandidate` is inert.** `CandidateWorkflowServiceImpl.java:986–1002`:
   ```java
   // expireCandidate — "No candidate currently reaches INSTALLATION_EXPIRED
   //   (no TIMER_TASK_EXPIRED emitter is wired; DIFF I is deferred)."
   public void expireCandidate(String candidateId) {
       log.info("Workflow.expireCandidate: ignored — DIFF I deferred …");
       reminderScheduler.cancelByType(connectionId, ReminderType.TASK_EXPIRED);
   }
   ```

5. **And the scheduler is off in prod anyway.** `application-prod.yml:18` — `AWS_SCHEDULER_ENABLED: false` for `csp-tas-service` (and CLOS, DAS). The 1h `SLOT_PROPOSAL_URGENT` reminder isn't even being fired today — every `EventBridgeTaskScheduler` method early-returns. See [[cl-timer-enforcement-gap]] BUG-1/BUG-3 for the full root-cause chain.

**Result:** even if a fresh dev today wired a `TIMER_TASK_EXPIRED` emitter for `AWAITING_SLOT_PROPOSAL`, three guards would still block it: (i) the state-machine doesn't have the transition, (ii) `InstallationGuards` rejects pre-arrival expiry, (iii) the scheduler subsystem is disabled in prod.

---

## 7. Where the gap / bug lives

| Layer | Defined? | Notes |
|---|---|---|
| OS | ✗ No | Only `P74 = 72h` (whole PENDING_INSTALL window); no slot-proposal sub-SLA. |
| Spec (ES PRD) | ✗ No | UI reminder only (`SLOT_PROPOSAL_URGENT` at +1h); no state-machine expiry from `AWAITING_SLOT_PROPOSAL`. |
| Code (TAS) | ✗ No | No `TIMER_TASK_EXPIRED` transition from pre-arrival states; `GUARD-ES-INSTALL-19` blocks it; `expireCandidate` is inert (DIFF I deferred). |
| Partner app UI | ✗ No | No countdown / no warning state on the task card today. |
| Notification (PN / CleverTap) | ✗ No | No CleverTap event configured for warning or reassignment. |
| Behaviour in prod | ✗ Broken | 10 candidates stuck > 87h, oldest 6.5 days. Even the existing UI reminder doesn't fire — `AWS_SCHEDULER_ENABLED: false` in prod ([[cl-timer-enforcement-gap]] BUG-1). |

Primary classification: **Gap (missing capability across every layer).** Secondary **Bug** overlap: the partial mechanism that *does* exist (`SLOT_PROPOSAL_URGENT` reminder) is dead in prod because of the disabled scheduler.

## 8. Proposed fix (today → desired)

Sequenced — each step depends on the one above.

**Note:** rewritten per the new PM-spec guideline. **No OS change.** SLA lives in ES PRD. No code prescription; tech designs the implementation. See the HTML deliverable (item-01 tab in `index.html`) for the canonical version with all edge cases and pre/post diffs per surface. The high-level shape:

### Today
Candidate enters `AWAITING_SLOT_PROPOSAL` with no SLA; CSP can ignore it forever.

### Want
- 4h SLA from `AWAITING_SLOT_PROPOSAL` entry. Warning at +2h.
- Two ES-level parameters added to PRD: `T_slot_proposal_window = 4h`, `T_slot_proposal_warn = 2h`.
- On SLA expiry, candidate exits via the existing `INSTALLATION_FAILED(reason=TIMEOUT_SLOT_PROPOSAL)` path → CL T3 retry → DAS reroute. No new OS concept.
- Two new CT events drive warning + reassignment PNs. Partner app shows countdown + warning state + Reassigned badge.

### Edge cases (10 enumerated — see HTML)
Race conditions, retries, single-CSP zones (depends on Item 02), backfill, PN dedup, etc.

### Out of scope
- Customer-side messaging.
- Backfill for already-stuck connections.

## 9. Risks / interactions

- **Hard prerequisite on the scheduler infrastructure landing.** `AWS_SCHEDULER_ENABLED: false` in prod for TAS / CLOS / DAS today; the prod EventBridge dispatcher (Lambda + IAM role + bearer token) was never provisioned. Without it, no timers fire — neither the existing CL P74 backstop nor this item's new 4h SLA. **This item cannot ship until Items 06 (CLOS scheduler) and 07 (DAS scheduler) land in prod** — those items deliver the same scheduler-infrastructure fix this one depends on. See the README's cross-item rollout-sequencing note.
- **Implementing DIFF I for pre-arrival also means revisiting post-arrival expiry.** If we ship `TaskExpiredHandler`, the existing 90d post-arrival `INSTALLATION_EXPIRED` path activates simultaneously. Make sure post-arrival behaviour is intentional before turning the emitter on.
- **Single-CSP zones (BUG-8).** With the cooldown-bypass live, retriggering an ignored CSP in a single-CSP zone just routes back to the same CSP. The PM's "should retrigger so another CSP can take it" intent assumes >1 CSP in zone. Either (a) accept that single-CSP zones don't get the benefit, or (b) fix BUG-8 alongside (recommended — its bypass contradicts OS L176 anyway).
- **P78 retry cap.** With P78=3, an ignored CSP burns one retry per cycle. If the new SLA is short (e.g. 4h) and the CSP keeps ignoring, retries exhaust in 12h and the connection goes to T12 → `PENDING_DEACTIVATION`. Likely desired, but worth confirming the deactivation pathway is the intended terminal for "no CSP wanted this in any zone."
- **D&A cooldown duration (P51 = 4h).** If `P_SLOT_PROPOSAL_WINDOW` < P51, the same CSP could still be excluded correctly. If it's ≥ P51, the cooldown may expire before retry happens and the original CSP could be re-selected. Recommendation: set `P_SLOT_PROPOSAL_WINDOW < P51` *or* align them.

## 10. References

- OS: `os/Connection_Lifecycle_OS_v1_7_1_LOCKED.md` (S5 parameter table, L456 — P74 only); `os/Demand_Allocation_OS_v1_9_1_LOCKED.md` (P41 = 2h acceptance window, predates AWAITING_SLOT_PROPOSAL)
- Spec: `yaml-prd/es-installation-service-prd-v2.4.yaml` (L536–537 AWAITING_SLOT_PROPOSAL; L672 INSTALLATION_EXPIRED post-arrival only; L93–94 OPEN-PARAM-2; L138 DIFF A documentation-only)
- Code: `services/csp-tas-service/src/main/java/io/wiom/csp/tas/install/domain/service/InstallationStateMachine.java:87,226–230`; `InstallationGuards.java:212–226`; `application/impl/CandidateWorkflowServiceImpl.java:986–1002` (inert `expireCandidate`); `application.yml:261` (`slot-proposal-urgent-hours: 1h`); `application-prod.yml:18` (`AWS_SCHEDULER_ENABLED: false`)
- Notification: `csp-notification-service` (existing service); new CleverTap events: `slot_proposal_warning`, `slot_proposal_expired`.
- Related memory: [[cl-timer-enforcement-gap]] — BUG-1 (scheduler off in prod), BUG-3 (TAS expiry not wired / DIFF I deferred), BUG-8 (DAS single-CSP cooldown bypass); [[clevertap-instrumentation-plan]] for CT event registration pattern.
- Sample connection IDs for retesting: `f38c4c02-2b69-4180-bece-2cb90a14248f` (157.7h stuck), `c69c160c-ddec-4a41-b056-6b9ac6536d4a` (144.8h), `eaaf8fcc-bc52-4a17-ac98-93d1081864a5` (142.6h), plus 7 more in the same window — see Section 2.

## 11. Investigation log

- **2026-05-29 — filed.** Investigated against `main` of `csp-os-yaml` (verified clean at `f671132a`). 10 candidates stuck > 87h, oldest 6.5 days. Classified as Gap (missing capability across every layer) + Bug overlap (scheduler off). Cross-linked to three pre-existing bugs.
- **2026-05-29 — updated.** PM locked SLA at **4h** and added the communication scope: warning PN at T+2h and reassignment PN at T+4h via new CleverTap events, plus partner-app countdown / warning-state / reassigned-badge UI. Classification matrix expanded to 6 layers (added Partner App UI and PN/CT). Fix plan grew from 5 → 7 steps (added NOTIF and APP).
- **2026-05-29 — revised per new PM-spec guideline.** Rewrote §8 as a well-scoped human-readable spec with edge cases + pre/post diff per surface. **Removed the proposed new OS parameter** — SLA now lives in the ES PRD only (minimise OS changes per project guideline). Scheduler infrastructure dropped from fix plan; tracked as Tier-0 dependency / risk. Spec references updated v2.4 → v2.5. HTML pane fully expanded (no collapsed `<details>`) as the canonical tech-handoff deliverable.
- **2026-05-29 — further tightening.** Folded the previously-separate "Communication timeline — what the CSP sees" H3 section into the Spec's Post-state (it's not a separate concern). Removed 3 technical edge cases (PN dispatcher race, scheduler fire delay, backfill at launch) — they are tech's domain per new "business edge cases only" guideline. Added an **Open questions for PM** callout in the HTML listing assumptions I made (warning timing = T+2h, race handling, PN copy) so they can be confirmed before tech receives the spec. CSS fix: arrow text between flow-diagram nodes shrunk from 1.3rem to 0.82rem to match node-text scale.
- **2026-05-29 — PM answers locked in.** Warning fires at **T+3h** (1 h before SLA expiry — last-call style), not the assumed T+2h. If the CSP proposes between warning scheduling and PN firing, the warning **is suppressed** (no confusing "1 hour left" PN after they've already acted). PN copy remains placeholder for product. All edits propagated: flow diagram, timeline table, edge cases, pre/post diff per surface. Open Questions section removed (all resolved). Also removed the redundant intro line "Human-readable behaviour spec…" from the Spec heading area.
- **2026-05-29 — removed Pre/post diff per surface section** (per PM: no longer needed). Spec structure is now: Pre-state · Post-state (with embedded comm timeline) · Edge cases · Out of scope. The per-surface change descriptions are now implicit in the Post-state.
