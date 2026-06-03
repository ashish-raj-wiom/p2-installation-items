# P2 Installation Items

**Owner:** Ashish Raj · **Started:** 2026-05-29 · **Target audience:** Wiom CSP tech for implementation

15 items on the installation journey, each classified as **Gap** or **Bug**, captured one per markdown file in `items/` and (at the end) rendered to a single human-readable `index.html` for handoff. The HTML groups the items into three ownership buckets (Go-ahead from Vaibhav / Working-hour dependency / Decision pending on Dhruv) so a wider audience can see the current waiting line at a glance.

## How the PM team writes items

These items are the PM team's hand-off to tech. The role split:

> *"The PM team merely provides a well-scoped, human-readable spec document. Well-scoped means **all edge cases are incorporated.** Tech owns the technical solution."*

In practice that means each item file follows these rules:

1. **Human-readable, no technicalities.** No code-line prescriptions, no field-name or migration dictation, no "remove this method" instructions. Describe the **behaviour change** and let tech design how. (Specific file/line references stay — but only as *evidence* of where the current behaviour lives, not as the fix.)
2. **Minimise OS changes.** OS amendments are heavy-weight. Reach for the **ES PRD** (`yaml-prd/es-installation-service-prd-v2.5.yaml` is the current latest) first. Only escalate to the LOCKED OS when the change genuinely lives at the OS layer (a cross-service invariant, a new SPR-registered global parameter, a state-machine change on a CL/D&A/Quality aggregate).
3. **Well-scoped means all genuine business edge cases.** Enumerate the unhappy paths that a customer or CSP could observe — what does the partner see if they propose just before SLA expiry, what does the customer see if they cancel, etc. **Do not include technical edge cases** (timer fire tolerance, dispatcher race, schema choice, refresh-lag, backfill at launch). Those are tech's domain.
4. **No assumptions — ask questions.** Where the PM hasn't decided something (a threshold value, a tie-break rule, copy text), the spec **must not silently fill in a default**. Mark it in an "Open questions for PM" callout inside the item, and surface the questions to the PM explicitly. Items must not ship to tech with hidden assumptions.
5. **Communication timeline is part of the spec, not a separate section.** If an item introduces new PN / CleverTap events or app-UI changes that the CSP/customer sees, fold the timeline (T+0 / T+Nh / T+expiry) into the spec's *Want* section. Don't break it out as its own H3 — it's not a separate concern.

## What gets investigated for every item

Every item starts from two PM-supplied sections — **What's happening today** and **What we want to happen** — and then we audit each authoritative source in order:

1. **PM's "today"** — observed behavior in plain English (PM-supplied), backed by **prod** evidence (CSP prod read-replica + Datadog logs/spans).
2. **PM's "want"** — the target behavior (PM-supplied), mapped to OS/Spec language by the investigator.
3. **OS** — what does the LOCKED Operating Specification say? (`C:\Users\ashis\csp-os-yaml\os\*_LOCKED.md` and `os\Amendments\`)
4. **Spec / PRD** — what does the YAML PRD or ES spec say? (`C:\Users\ashis\csp-os-yaml\yaml-prd\`, `C:\Users\ashis\installation-flow-execution-spec-yaml\`)
5. **Code** — what does the live service actually do? (`C:\Users\ashis\csp-os-yaml\services\*\src\main\`)

We then decide which surface the **gap / bug lives on**:

- **Gap** = a missing thing — could be OS-vs-Spec, Spec-vs-Code, Code-vs-Code-across-services, or just "not in any spec but should be." Gaps are by definition **PM-owned** — they need spec work before tech can build.
- **Bug** = a wrong thing — code/config/data does something different from what the OS or Spec mandates.

### Bugs get a second-level sub-classification — *spec gap* vs *implementation miss*

Once a bug is reproduced (via DB / Datadog MCPs), it must land in exactly one of these two buckets so the tech reviewer knows what's being handed over:

1. **Spec gap** — the spec itself is missing, wrong, or contradictory; the code is "honestly" implementing a broken spec. **PM owns** delivering an updated spec with a clear pre/post diff in a human-readable format; tech then implements against the new spec.
2. **Implementation miss** — the spec is correct; the code/config deviates from it. **Tech owns** the technical solution. The item's job is to point at the specific section of spec that was not implemented correctly + the deviation site in code as evidence — and stop there. We do not prescribe the technical approach.

Every BUG item's classification card carries this sub-type. GAP items don't need it (always PM-owned).

## Item file convention

- File name: `items/NN-<short-slug>.md` (NN = two-digit serial, e.g. `01-p74-not-enforced.md`)
- Each file follows `TEMPLATE.md` exactly so the eventual HTML render is uniform.
- DB query outputs / Datadog excerpts that are too long to inline live under `evidence/NN-<slug>/`.

## Index

| # | Title | Type | Bucket | Service(s) to update | Status |
|---|---|---|---|---|---|
| 01 | [Same CSP re-assigned in single-CSP zones (P51 bypass)](items/01-same-csp-loop-single-zone.md) | Bug | 3 · Dhruv decision | csp-demand-allocation-service (single behavioral fix) | Open |
| 02 | [Propose 2 slots + customer counter-proposal](items/02-two-slots-and-counter-proposal.md) | Gap | 3 · Dhruv decision | ES PRD, csp-tas-service (schema + DTO + handler), partner app, customer app | Open |
| 03 | [FPN for Rohit (technician) on assignment](items/03-fpn-for-rohit-on-technician-assignment.md) | Gap | 1 · Vaibhav go-ahead | Technician app, CleverTap campaign | Open |
| 04 | [Bifurcate cancel-by-customer vs cancel-by-system](items/04-cancel-bifurcation-customer-vs-system.md) | Gap | 1 · Vaibhav go-ahead | Customer backend (source), csp-tas-service (handler), ES PRD (sentence) | Open |
| 05 | [CLOS timeout scheduler unwired (P74/P75/P76/P77/P78 inert)](items/05-clos-scheduler-unwired.md) | Bug · Impl-miss | 2 · Working-hour dep | csp-connection-lifecycle-service (scheduler infra), csp-tas-service (T3 retry co-fix) | Open |
| 06 | [DAS allocation scheduler unwired (P41 + P191 inert)](items/06-das-scheduler-unwired.md) | Bug · Impl-miss | 2 · Working-hour dep | csp-demand-allocation-service (scheduler infra) — **hard-blocked on Item 07** | Open |
| 07 | [DAS allocation state never reaches ACCEPTED (AM-02 wiring orphan)](items/07-das-state-never-accepted.md) | Gap | 1 · Vaibhav go-ahead | csp-demand-allocation-service / csp-tas-service / csp-gateway-service (tech-picks mechanism); AMENDMENT-02 follow-up (PM) | Open |
| 08 | [Show address-locality + landmark + voice direction in the CSP App](items/08-voice-directions-csp-app.md) | Gap | 1 · Vaibhav go-ahead | CSP App (model + drilldown + FPN overlay), design team | Open |
| 09 | [Change-team-member workflow post technician assignment](items/09-change-team-member-workflow.md) | Gap | 1 · Vaibhav go-ahead | csp-tas-service (install allowed-actions · restore verify · nbrec parity), csp-gateway-service (SC `can_reassign`), CSP App (UI), csp-notification-service / CleverTap (FPN on swap — depends on Item 03) | Open |
| 10 | [IVR 2.0 integration for Cx ↔ Px interaction](https://ashish-raj-wiom.github.io/IVR-Routing-Solutioning/ivr-routing-design.html) | Gap | 2 · Working-hour dep | IVR routing-table refactor — external spec on `ashish-raj-wiom/IVR-Routing-Solutioning` | Open |
| 11 | Capacity OS code skips connection increment after installation | Bug · Impl-miss | 1 · Vaibhav go-ahead | csp-capacity-coverage-service (remove RESUME-only guard) + one-time backfill | Open |
| 12 | `CL_INSTALLATION_QUALITY_SIGNAL` — CL producer record drifted from CL OS S-10 contract (`signal_id` sent as `event_id`, `signal_type` sent as `event_type`, `previous_state=null`) → 53/53 (100%) rejected by Quality OS validation | Bug · Impl-miss | 1 · Vaibhav go-ahead | csp-connection-lifecycle-service producer record alignment to CL OS v1.7.1 §S-10 + Part 2 base schema | Open |
| 13 | CAEO `customer_id` column has CSP-ID for installation task | Bug · Impl-miss | 1 · Vaibhav go-ahead | CL OS (add `customer_id` to outbound contract), csp-connection-lifecycle-service (populate field in `CL_CONNECTION_ACTIVATED`), csp-customer-access-service (read & write) | Open |
| 14 | `failure_subreason_code` blank on `INSTALLATION_FAILED` | Gap | 1 · Vaibhav go-ahead | Partner App (sub-reason picker), csp-tas-service (handler enforcement), ES PRD | Open |
| 15 | DAS doesn't publish supply-side events when a zone has only one CSP | Gap | 1 · Vaibhav go-ahead | csp-demand-allocation-service (continuity-mode detection + 3 publisher call sites — Capacity OS receivers already built) | Open |

## Three ownership buckets (as of 2026-06-02)

The 15 items above are grouped into three buckets in the HTML, by who needs to weigh in next:

- **Bucket 1 — Go-ahead from Vaibhav** (no OS change, pure ES / app / backend): items **03, 04, 07, 08, 09, 11, 12, 13, 14, 15**
- **Bucket 2 — Working-hour dependency** (waiting on Vaibhav's working-hour governance): items **05, 06, 10**
- **Bucket 3 — Decision pending on Dhruv** (shared question: should a CSP who self-marked `INSTALLATION_FAILED` be re-eligible after P51 cooloff? Partner-complaint pattern: *"mujhe same booking baar baar bhejte ho jo maine decline kari hai"*): items **01, 02**

## On items 11–15

Items 11–16 surfaced from the end-to-end audit of connection `f285e07f-85d1-40f6-a6cd-f94ab7742789` and are filed here for tech tracking. Each one carries an important nuance the headline doesn't capture:

- **Item 11** — CSP-app's active-connection count is NOT affected by this bug; the partner-app reads CL directly, bypassing Capacity OS. The skip only affects Capacity OS's internal counter and the routing / cap-calibration decisions that read from it. Fleet-wide magnitude needs a separate audit.
- **Item 12** — root cause is a payload-contract drift in the CL producer record, not a dispatcher / infra issue. 53/53 emissions rejected by Quality OS validation with HTTP 400 `VALIDATION_FAILED` on three required fields: `signalId` ("must not be blank" — CL sends `event_id`), `signalType` ("must not be null" — CL sends `event_type`), `previousState` ("must not be null" — CL emits as `null` instead of `"PENDING_INSTALL"`). Quality OS receiver matches CL OS v1.7.1 §S-10 exactly; CL service producer record drifted. Fix lives entirely in `csp-connection-lifecycle-service / ClInstallationQualitySignal.java`.
- **Item 13** — `CL_CONNECTION_ACTIVATED` doesn't carry `customer_id` in its payload, so CAEO consumer line 82 plugs in the CSP-ID as a placeholder. Want: CL adds `customer_id` to the event payload (it's already on the CL `connections` row — trivial addition), CAEO writes the actual customer.
- **Item 14** — the *actual* installation-failure diagnostic gap. Without sub-reason, Quality OS cannot differentiate "CSP didn't bother" from "address infeasible" from "customer refused".
- **Item 15** — supply-side escalation loop dead end-to-end. Capacity OS receivers are production-quality; DAS trigger call sites just need to be added.

Single-source markdowns for items 11–15 will follow under `items/`; the HTML carries the full spec in the meantime.

## Cross-item rollout sequencing

Items 05, 07, 08 are wiring fixes that share scheduler/state-machine dependencies. **Recommended ship order:**

1. **Item 07** first — every allocation reaches `ACCEPTED` correctly.
2. **Item 06** next — turn on DAS P41 sweep (now safe; reads only genuine wiring-failure `ASSIGNED` rows).
3. **Item 05** last — turn on CLOS P74 / P75 / P76 / P77 sweeps. The TAS T3-retry co-fix must ship as part of Item 05 itself (don't activate the CLOS scheduler until the TAS-side T3 handling is live in prod).

Activating in any other order produces visible customer harm — e.g. P41 before Item 07 reclaims 274 live installs; P74 retry before TAS T3-handling orphans 50 install candidates.

## Related background already on file

These two prior investigations may overlap with some items — cross-link rather than re-derive:

- **CL Timer Enforcement Gap** (memory: `cl_timer_enforcement_gap.md`) — covers the unwired CL+DAS schedulers (`AWS_SCHEDULER_ENABLED: false`), P74/P75/P76/P77/P78 dead, DAS frozen at ASSIGNED, TAS expiry inert (DIFF I deferred), TAS T3 no-op, P74 anchor ambiguity, DAS single-CSP cooldown bypass (PR #184). 9 bugs identified.
- **Installation Flow Reference** (memory: `install_flow_reference.md`) — authoritative end-to-end state map (D&A → ES → CL → ACS → Quality → CAEO → RV → CS), 17-step happy path, event catalogue, constitutional invariants.

## Working agreement

- Investigate against **live code on `main`** (the qa-branch convention in CLAUDE.md is stale — pull `main` first).
- Prefer **prod DB** over Java code for "what is actually happening" claims (the repo can contain code that the deployed service doesn't exercise).
- Quote the OS / Spec / commit / line — never paraphrase the canonical text.
- Where a Code/OS contradiction is intentional but undocumented, flag it as a **deviation needing OS amendment**, not just a code fix.
