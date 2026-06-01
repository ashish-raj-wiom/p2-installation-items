# 10 — Change-team-member workflow post technician assignment

> **Type:** Gap (capability missing or hidden across multiple task families)
> **Service(s) to update:** `csp-tas-service` (Install allowed-actions resolver · Restore allowed-actions verification · NBREC parity for already-shipped behaviour) · `csp-gateway-service` (surface-contract `can_reassign` actually populated · drilldown actions list) · CSP App (UI for *"Change team member"* CTA in each family's drilldown) · `csp-notification-service` + CleverTap (re-fire technician FPN on every change, per Item 04 pattern)
> **Owner (PM):** Ashis · **Filed:** 2026-06-01

---

## 1. Summary

Today the CSP can assign a technician (team member) on Install, Restore, and NetBox-Recovery (NBREC) tasks — but **the workflow to *change* the assigned team member after the initial assignment is inconsistent across the three families.** NBREC has a clean unified `assignTask` endpoint that handles both initial assignment and reassignment, plus a tracked `reassignmentCount`. Install has the backend capability (state machine self-loops on `TECHNICIAN_ASSIGNED → ASSIGN_TECHNICIAN`) but the gateway hides it from the partner-app's allowed-actions list — so the CSP sees no UX path to swap. Restore has the backend capability explicitly added in v1.7-DIFF-A1 (*"CSP can swap technician without intermediate recall"*) and likely exposes it via the allowed-actions resolver — needs verification.

This item adds the **same change-team-member action everywhere a team member is assigned** — without unifying the per-service vocabularies (Install keeps `executor_id`, Restore keeps `assigned_technician_id`, NBREC keeps `assigned_member_id`). PM-scope: keep each service's existing model, just close the workflow gaps.

---

## 2. What's happening today

**PM's description:**
> *"Change Team Member Workflow Post Technician Assignment. This workflow has to be added for all the services wherever the team member/technician is assigned to do certain tasks."*

**Per-family audit (verified against `csp-os-yaml@main`):**

| Family | Initial assignment exists? | Backend state machine allows reassign? | Gateway exposes reassign action? | Reassignment counter? | Customer-visible status today |
|---|---|---|---|---|---|
| **Install** (`tas/install`) | ✓ `ASSIGN_TECHNICIAN` action at `AWAITING_TECHNICIAN_ASSIGNMENT → TECHNICIAN_ASSIGNED`. Sets `executor_id` on the candidate. | ✓ Self-loop `TECHNICIAN_ASSIGNED → ASSIGN_TECHNICIAN → TECHNICIAN_ASSIGNED` in `InstallationStateMachine.java:182` (comment: *"reassign"*) | **✗ NO.** `TasCandidateQueryServiceImpl.resolveAllowedActions:118` returns only `MARK_ARRIVED` for `TECHNICIAN_ASSIGNED`. The reassign capability is in the state machine but filtered out of the allowed-actions list. CSP has no UX path. | ✗ Not tracked. | Once a tech is assigned, the CSP cannot swap them via the partner app. They'd have to call ops or live with it. |
| **Restore** (`tas/restore`) | ✓ `ASSIGN_TECHNICIAN` action allowed at `PENDING_ACCEPTANCE` / `ACCEPTED` / `ASSIGNED_TECHNICIAN`. Sets `assigned_technician_id`. | ✓ Self-loop at `ASSIGNED_TECHNICIAN` — explicit v1.7-DIFF-A1 comment: *"CSP can swap technician without intermediate recall"* (`RestoreCandidateStateMachine.java:69-73`). | ⚠ Likely yes — `AllowedActionsResolver:49,56` lists `ASSIGN_TECHNICIAN` for multiple states. To be confirmed in tech-review. | ✗ Not tracked explicitly. The `TASK_REASSIGNED` reason code is about CSP-to-CSP reassignment (different concept). | If exposure is verified: works. If not: same gap as Install. |
| **NBREC** (`tas/netbox_recovery`) | ✓ `assignTask` endpoint with `AssigneeType.SELF` (CSP themselves) or `TEAM_MEMBER` (specific team member). Sets `assigned_member_id` + `assigned_member_name`. | ✓ Same `assignTask` endpoint handles both initial AND reassignment — detected via `assigned_at != null` (`CandidateCommandServiceImpl:240-258`). No separate "reassign" action needed; no state transition needed (assignment is orthogonal to state). | ✓ Yes (single endpoint, same path for both). | ✓ **`reassignmentCount` column** + `EsNbrecTaskAssigned.isReassignment` boolean. Only family that tracks this. | Works. Reference implementation. |
| **Gateway `can_reassign` flag** | n/a | n/a | **Always `null`** — defined as an INSTALL-specific field on `TaskDrilldown` but never set in `HomeFacadeService:297-319` (one of the placeholder `null`s). | n/a | The SC has the field; no service populates it. Dead flag. |

The headline mismatch: Install backend has the capability but the gateway filters it; NBREC has it clean end-to-end; Restore is in the middle. Customer-visible result depends on which task family the partner is operating on — same conceptual "change tech" action, three different stories.

---

## 3. What we want to happen

**PM's desired outcome:** *"The change-team-member workflow has to be added for all the services wherever the team member/technician is assigned to do certain tasks."*

Concretely, on every family where a team member is assigned (**Install, Restore, NBREC** — PM-scoped):

1. The CSP App's drilldown exposes a *"Change team member"* / *"बदलें"* CTA whenever the task has a team member already assigned, and the task hasn't yet reached a terminal state.
2. Tapping the CTA opens the same team-member picker the CSP used for the initial assignment.
3. Confirming the picker triggers the same backend action that was used for the initial assignment:
   - **Install:** existing `ASSIGN_TECHNICIAN` action with the new `executor_id` (state machine already supports the self-loop)
   - **Restore:** existing `ASSIGN_TECHNICIAN` action with the new `assigned_technician_id` (state machine already supports the self-loop)
   - **NBREC:** existing `assignTask` endpoint with the new `assigned_member_id` (handler already detects reassignment vs initial)
4. Per-service vocabulary is preserved (no migration to a unified model). Tech just adds the missing exposure points.
5. The new team member receives the same FPN that fires on initial assignment ([[Item 04]] — *"every assignment including re-assignments"* — already PM-confirmed there).
6. Optional but recommended: each family tracks a `reassignmentCount` for observability, mirroring NBREC's existing pattern.

---

## 4. What the OS says

Team-member assignment / reassignment UX is not in scope for any LOCKED OS file. The CL OS, D&A OS, Quality OS, ACS OS, ESR OS are silent on technician swap. **No OS change is needed for this item.** The whole change lives at ES PRD level + service code + CSP App.

## 5. What the Spec / PRD says

- **`yaml-prd/es-installation-service-prd-v2.5.yaml`** — Install state machine has `TECHNICIAN_ASSIGNED` state and `ASSIGN_TECHNICIAN` action. The PRD's allowed-actions section likely needs to add `ASSIGN_TECHNICIAN` to the `TECHNICIAN_ASSIGNED` state's allowed list (currently shows only `MARK_ARRIVED` per the code resolver).
- **Restore PRD** — v1.7-DIFF-A1 explicitly added the `ASSIGN_TECHNICIAN` self-loop on `ASSIGNED_TECHNICIAN`. Already aligned at PRD level.
- **NBREC PRD** — `AssigneeType` + `assignTask` already documented; nothing to add for parity.
- **Surface contract (`sc_home.md`)** — `TaskDrilldown.can_reassign` field exists but always `null`. SC either needs to (a) populate the flag correctly across all three families, or (b) replace the flag with a per-family `allowed_actions` list that already includes `ASSIGN_TECHNICIAN`/`assignTask` when reassignment is valid. Tech's call which model is cleaner.

## 6. What the Code does

For evidence — tech will design the implementation.

**Install:**
- `services/csp-tas-service/src/main/java/io/wiom/csp/tas/install/domain/service/InstallationStateMachine.java:182` — self-loop `TECHNICIAN_ASSIGNED + ASSIGN_TECHNICIAN → TECHNICIAN_ASSIGNED` (allowed ✓).
- `services/csp-tas-service/src/main/java/io/wiom/csp/tas/install/application/impl/TasCandidateQueryServiceImpl.java:111-125` — `resolveAllowedActions` returns **only `MARK_ARRIVED`** at `TECHNICIAN_ASSIGNED`. **The fix is one line: add `ASSIGN_TECHNICIAN` here.** (Plus matching ES PRD allowed-actions table.)
- `services/csp-tas-service/src/main/java/io/wiom/csp/tas/install/application/impl/CandidateWorkflowServiceImpl.java:528-547` — `assignTechnician(...)` workflow method. Already handles the initial-assignment path; the reassign path will reuse the same call because the state machine accepts the self-loop. Likely no change needed in the workflow service itself.

**Restore:**
- `services/csp-tas-service/src/main/java/io/wiom/csp/tas/restore/domain/service/RestoreCandidateStateMachine.java:68-73` — self-loop at `ASSIGNED_TECHNICIAN` ✓ (v1.7-DIFF-A1).
- `services/csp-tas-service/src/main/java/io/wiom/csp/tas/restore/domain/service/AllowedActionsResolver.java:49,56` — `ASSIGN_TECHNICIAN` listed in multiple states; tech-review to confirm `ASSIGNED_TECHNICIAN` is one of them.

**NBREC:**
- `services/csp-tas-service/src/main/java/io/wiom/csp/tas/netbox_recovery/application/impl/CandidateCommandServiceImpl.java:223-285` — `assignTask` already handles both initial and reassignment via the same endpoint. No backend change.

**Gateway:**
- `services/csp-gateway-service/src/main/java/in/wiom/gateway/home/dto/response/TaskDrilldown.java:26` — `can_reassign: Boolean` field exists.
- `services/csp-gateway-service/src/main/java/in/wiom/gateway/home/service/HomeFacadeService.java:303` — value passed as `null` today (one of the placeholder nulls in the INSTALL-specific block). Either populate it from upstream, or drop the field and rely on `allowed_actions` carrying `ASSIGN_TECHNICIAN` / `assignTask` directly.

**CSP App:**
- `core/model/.../TaskDetail.kt:49` — `canReassign: Boolean = false` field exists (referenced in Restore section per earlier reading). Drilldown UI needs a *"Change team member"* CTA wired to fire the action.

---

## 7. Where the gap / bug lives

| Layer | Defined? | Notes |
|---|---|---|
| OS | n/a | Not an OS-level concern. |
| ES PRD (Install) | ✗ Partial | State machine permits the self-loop; allowed-actions table likely doesn't surface it at `TECHNICIAN_ASSIGNED`. |
| ES PRD (Restore) | ✓ Yes (v1.7-DIFF-A1) | Both state-machine + allowed-actions appear aligned. |
| ES PRD (NBREC) | ✓ Yes | `AssigneeType` + `assignTask` already covers it. |
| Backend (Install) | ⚠ Partial | State machine ready; allowed-actions resolver filters it out. **One-line fix** at `TasCandidateQueryServiceImpl:118`. |
| Backend (Restore) | ⚠ Verify | State machine ready; allowed-actions resolver to be confirmed in tech-review. |
| Backend (NBREC) | ✓ Done | Reference implementation. |
| Surface contract (`sc_home`) | ⚠ Half | `can_reassign` field declared, never set. SC needs to either populate or replace with per-family allowed-actions. |
| Gateway | ✗ No | `can_reassign` passed as `null` in drilldown construction. |
| CSP App | ✗ No UX | No *"Change team member"* CTA in any drilldown today. |
| FPN to new technician | ⚠ Cross-link | Item 04 covers FPN on every assignment including re-assignments; this item depends on Item 04 shipping (or being co-shipped). |
| Prod | — | CSPs who want to swap a technician on Install have no in-app path today. |

Classification: **Gap.** Capability is partly present in code (NBREC fully, Install + Restore mostly), but the surface and the CSP-App UX are not consistent across families.

## 8. Spec — handed to tech

### Today

- **NBREC:** the CSP can change the team member via the existing `assignTask` endpoint. Works end-to-end. `reassignmentCount` is tracked.
- **Restore:** backend supports it (v1.7-DIFF-A1). Allowed-actions exposure to confirm; if confirmed, works.
- **Install:** backend supports it (state machine self-loop), **but the gateway hides it from the allowed-actions list** (`resolveAllowedActions` returns only `MARK_ARRIVED` for `TECHNICIAN_ASSIGNED`). The CSP App has no *"Change team member"* CTA on the install drilldown. Practical result: once a technician is assigned to an install, the CSP cannot swap them via the app.

### Want

For every task family where a team member is assigned to do a task (Install, Restore, NBREC):

- A *"Change team member"* (बदलें) CTA is present in the drilldown whenever a team member is currently assigned and the task is not in a terminal state.
- Tapping the CTA opens the same picker used for the initial assignment.
- Confirming the picker fires the same backend action used for the initial assignment, with the new team-member identifier.
- The new team member receives the standard technician-assignment FPN (per [[Item 04]] — *"every assignment incl. re-assignments"*).
- **No constraint on timing — the change is allowed anytime before the task reaches a terminal state, including mid-work.** PM-confirmed.
- Per-service vocabulary stays as-is — Install uses `ASSIGN_TECHNICIAN` + `executor_id`, Restore uses `ASSIGN_TECHNICIAN` + `assigned_technician_id`, NBREC uses `assignTask` + `assigned_member_id`. No unification migration in this item.
- Optional: each family records a `reassignmentCount` (or equivalent) for observability — NBREC already does. Install + Restore add similar counter columns. *(Confirm with PM whether this is a must-have or nice-to-have.)*

### Edge cases (business)

1. **CSP changes the team member after the assigned technician has already arrived at site (`ARRIVED_AT_SITE` for Install, `IN_PROGRESS` for Restore).** Allowed per PM — mid-work swap permitted. New team member gets the FPN; previously-on-site tech's app removes the booking from their active list on next refresh (same pattern as [[Item 04]] edge case 3). Practical caveat: any session state the previous tech accumulated (selfie taken, OTP entered, photos captured) needs to be either carried over or restarted — tech-design decision per family.
2. **CSP changes the team member while a customer call is in progress** (per [[IVR-Routing-Solutioning]] dual-PIN model). The IVR session is bound to the original technician's PIN. New tech gets the FPN; if they need to call the customer, they use their own PIN, which IVR routes to the new tech. Existing call doesn't migrate; this is consistent with the IVR design.
3. **CSP changes the team member back to themselves (SELF / un-assign from team member).** NBREC handles this via `AssigneeType.SELF`. Install + Restore: today no SELF / "unassign" concept — the picker only assigns to a person. PM to confirm whether self-unassign is in scope here or a separate item.
4. **CSP rapidly swaps team members multiple times in a row** (e.g. picks A, picks B 5 seconds later, picks C). Each swap fires a fresh FPN, increments the reassignment counter (if tracked). No rate limit — partner UI's responsibility to debounce if needed.
5. **The previously-assigned technician has already started doing some steps on the install wizard** (e.g. completed selfie + Aadhar in the install flow). On swap, the new tech sees the booking in its current state and can either continue from there or restart — depends on whether the prior tech's session state is per-task or per-technician. Tech-design decision; PM doesn't dictate.
6. **Booking is cancelled by customer / fails upstream while the CSP is mid-picker.** Cancellation wins (same as [[Item 04]] edge case 6). The picker closes; the task disappears from the drilldown.
7. **Task is in a non-assignable state** (e.g. `AWAITING_SLOT_PROPOSAL` for Install — there's no technician yet; `ARRIVED_AT_SITE` is post-arrival but per PM still allowed). The *"Change team member"* CTA is suppressed in states where no team member is assigned yet (use the existing *"Assign team member"* / *"ASSIGN_TECHNICIAN"* CTA instead). State-gate rule: CTA visible iff there's already an `executor_id` / `assigned_technician_id` / `assigned_member_id` AND state is not terminal.
8. **CSP App is offline when the CSP tries to change the team member.** Action queues like any other action; fires on next online window. Standard offline UX; no special handling.

### Out of scope

- **Complaints / support-resolution-service.** PM-confirmed Install + Restore + NBREC only.
- **Outage management.** Not audited; assume out of scope unless PM reopens.
- **Unifying the per-service models** (NBREC's `AssigneeType` / `assigned_member_id` everywhere). Per-family vocabulary preserved — tech can revisit later if engineering cost is justified.
- **System-initiated reassignment** (e.g. previous tech on leave / unavailable, system auto-picks another). Out of scope — this item is CSP-initiated only.
- **CSP-to-CSP reassignment** (the task moves from one CSP to a different CSP entirely). Different concept; covered by D&A reallocation flows.
- **Recall / un-assign as a separate action.** Restore has `RECALL_TASK`; Install does not. Out of scope here; if PM wants symmetric unassign across families, file separately.
- **Customer notification about team-member change.** Customer is unaware of which tech is on their booking; not in scope to add a "your installer has been changed" SMS/PN.

---

## 9. Risks / interactions

- **Hard dependency on Item 04 (technician-assignment FPN).** This item assumes the FPN-on-assignment treatment already extends to re-assignments. Item 04 explicitly captures *"every assignment incl. re-assignments"* — so Item 04 must ship before (or alongside) this item, otherwise the new team member won't be notified on a swap.
- **Install allowed-actions resolver is the smallest change.** Adding `ASSIGN_TECHNICIAN` to the `TECHNICIAN_ASSIGNED` state's allowed-actions in `TasCandidateQueryServiceImpl:118` is a one-line addition. The state machine already accepts it. The ES PRD needs the same one-line update in its allowed-actions table for parity.
- **Restore needs verification before any work.** If `AllowedActionsResolver` already includes `ASSIGN_TECHNICIAN` at `ASSIGNED_TECHNICIAN`, Restore is done backend-side and only needs CSP App UI work. If not, same one-line resolver fix as Install.
- **NBREC reference implementation should not be touched.** It works. Resist the urge to add behaviour to NBREC just for "consistency"; the only NBREC change worth considering is making `reassignmentCount` available on the home drilldown for observability parity, and even that's optional.
- **Mid-work swap carries product risk.** Allowing a swap after `ARRIVED_AT_SITE` (Install) or `IN_PROGRESS` (Restore) means the customer may see two different technicians showing up. The previous tech's already-on-site state has to be reconciled. PM accepted this risk explicitly; tech should sanity-check whether the wizard-step-state migration is non-trivial in any family. If it is, that's a follow-up Item, not a blocker for this one.
- **`can_reassign` flag fate.** Tech needs to decide: populate it correctly across all three families, or drop it and rely on `allowed_actions` carrying the action. The latter is cleaner — drop the dedicated flag, let the action's presence in `allowed_actions` be the signal.
- **CSP-App offline queue.** A queued *"change team member"* action that fires after the task has moved to a terminal state in the meantime: the backend rejects it cleanly (state machine guard). CSP App should surface a graceful failure.

## 10. References

- **Customer-side PRD:** none — this is a partner-side / CSP-App workflow.
- **OS:** silent (no OS-level concern).
- **ES PRDs:** `yaml-prd/es-installation-service-prd-v2.5.yaml` (Install — allowed-actions table for `TECHNICIAN_ASSIGNED` needs `ASSIGN_TECHNICIAN` added) · Restore PRD (v1.7-DIFF-A1 — already covers it) · NBREC PRD (already covers it).
- **Surface Contract:** `sc_home.md` §1.2 — `TaskDrilldown.can_reassign` flag definition.
- **Backend code (Install — verified):** `csp-tas-service/.../install/domain/service/InstallationStateMachine.java:182` (state-machine self-loop) · `application/impl/TasCandidateQueryServiceImpl.java:111-125` (`resolveAllowedActions` — the surfacing gap) · `application/impl/CandidateWorkflowServiceImpl.java:528-547` (`assignTechnician` workflow).
- **Backend code (Restore — to verify):** `csp-tas-service/.../restore/domain/service/RestoreCandidateStateMachine.java:68-73` (state-machine self-loop) · `restore/domain/service/AllowedActionsResolver.java:49,56` (likely already lists `ASSIGN_TECHNICIAN` for multiple states — confirm `ASSIGNED_TECHNICIAN` is one).
- **Backend code (NBREC — reference implementation, no change):** `csp-tas-service/.../netbox_recovery/application/impl/CandidateCommandServiceImpl.java:223-285` (`assignTask` handles initial + reassign).
- **Gateway:** `csp-gateway-service/.../home/dto/response/TaskDrilldown.java:26` (`can_reassign` field) · `home/service/HomeFacadeService.java:303` (always `null`).
- **CSP App:** `core/model/.../TaskDetail.kt:49` (`canReassign` field — wired in model, not in UI).
- **Related items:** [[Item 04]] (technician-assignment FPN — hard dependency for the FPN on swap) · [[IVR-Routing-Solutioning]] (call-routing implication during a swap, edge case 2).
- **Source MD:** `items/10-change-team-member-workflow.md`

## 11. Investigation log

- **2026-06-01 — filed.** PM asked for a unified change-team-member workflow across all services where a technician/team-member is assigned. Audited Install, Restore, NBREC, Recharge, Complaints. Findings: NBREC is the reference implementation (clean `assignTask` endpoint, `AssigneeType` + `reassignmentCount`); Install has the backend self-loop but the allowed-actions resolver hides it (`TasCandidateQueryServiceImpl:118` returns only `MARK_ARRIVED` for `TECHNICIAN_ASSIGNED`); Restore explicitly added the self-loop in v1.7-DIFF-A1 but gateway exposure to verify; Recharge has no technician-assignment concept (out of scope); Complaints uses an `executor_id` model with escalation paths (PM scoped out). PM confirmed scope (Install + Restore + NBREC), preferred per-service vocabulary (no unification migration), and allowed mid-work swap + FPN to new tech (cross-link to Item 04). `can_reassign` flag on `TaskDrilldown` is dead today (always `null`); tech can either populate or replace with allowed_actions-driven signal — left as a tech decision.
