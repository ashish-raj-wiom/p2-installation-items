# P2 Installation Items

**Owner:** Ashis · **Started:** 2026-05-29 · **Target audience:** Wiom CSP tech for implementation

10 items on the installation journey, each classified as **Gap** or **Bug**, captured one per markdown file in `items/` and (at the end) rendered to a single human-readable `index.html` for handoff.

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

| # | Title | Type | Severity | Service(s) to update | Status |
|---|---|---|---|---|---|
| 01 | [Connection stuck when CSP doesn't propose a slot](items/01-no-slot-action-stuck.md) | Gap | — | csp-tas-service, OS, CLOS infra, csp-notification-service, partner app, CleverTap | Open |
| 02 | [Same CSP re-assigned in single-CSP zones (P51 bypass)](items/02-same-csp-loop-single-zone.md) | Bug | — | csp-demand-allocation-service (single behavioral fix) | Open |
| 03 | [Propose 2 slots + customer counter-proposal](items/03-two-slots-and-counter-proposal.md) | Gap | — | ES PRD, csp-tas-service (schema + DTO + handler), partner app, customer app | Open |
| 04 | [FPN for Rohit (technician) on assignment](items/04-fpn-for-rohit-on-technician-assignment.md) | Gap | — | Technician app, CleverTap campaign | Open |
| 05 | [Bifurcate cancel-by-customer vs cancel-by-system](items/05-cancel-bifurcation-customer-vs-system.md) | Gap | — | Customer backend (source), csp-tas-service (handler), ES PRD (sentence) | Open |
| 06 | [CLOS timeout scheduler unwired (P74/P75/P76/P77/P78 inert)](items/06-clos-scheduler-unwired.md) | Bug · Impl-miss | — | csp-connection-lifecycle-service (scheduler infra), csp-tas-service (T3 retry co-fix) | Open |
| 07 | [DAS allocation scheduler unwired (P41 + P191 inert)](items/07-das-scheduler-unwired.md) | Bug · Impl-miss | — | csp-demand-allocation-service (scheduler infra) — **hard-blocked on Item 08** | Open |
| 08 | [DAS allocation state never reaches ACCEPTED (AM-02 wiring orphan)](items/08-das-state-never-accepted.md) | Gap | — | csp-demand-allocation-service / csp-tas-service / csp-gateway-service (tech-picks mechanism); AMENDMENT-02 follow-up (PM) | Open |
| 09 | [Show address-locality + landmark + voice direction in the CSP App](items/09-voice-directions-csp-app.md) | Gap | — | CSP App (model + drilldown + FPN overlay), design team | Open |
| 10 | [Change-team-member workflow post technician assignment](items/10-change-team-member-workflow.md) | Gap | — | csp-tas-service (install allowed-actions · restore verify · nbrec parity), csp-gateway-service (SC `can_reassign`), CSP App (UI), csp-notification-service / CleverTap (FPN on swap — depends on Item 04) | Open |

## Cross-item rollout sequencing

Items 06, 07, 08 are wiring fixes that share scheduler/state-machine dependencies. **Recommended ship order:**

1. **Item 08** first — every allocation reaches `ACCEPTED` correctly.
2. **Item 07** next — turn on DAS P41 sweep (now safe; reads only genuine wiring-failure `ASSIGNED` rows).
3. **Item 06** last — turn on CLOS P74 / P75 / P76 / P77 sweeps. The TAS T3-retry co-fix must ship as part of Item 06 itself (don't activate the CLOS scheduler until the TAS-side T3 handling is live in prod).

Activating in any other order produces visible customer harm — e.g. P41 before Item 08 reclaims 274 live installs; P74 retry before TAS T3-handling orphans 50 install candidates.

## Related background already on file

These two prior investigations may overlap with some items — cross-link rather than re-derive:

- **CL Timer Enforcement Gap** (memory: `cl_timer_enforcement_gap.md`) — covers the unwired CL+DAS schedulers (`AWS_SCHEDULER_ENABLED: false`), P74/P75/P76/P77/P78 dead, DAS frozen at ASSIGNED, TAS expiry inert (DIFF I deferred), TAS T3 no-op, P74 anchor ambiguity, DAS single-CSP cooldown bypass (PR #184). 9 bugs identified.
- **Installation Flow Reference** (memory: `install_flow_reference.md`) — authoritative end-to-end state map (D&A → ES → CL → ACS → Quality → CAEO → RV → CS), 17-step happy path, event catalogue, constitutional invariants.

## Working agreement

- Investigate against **live code on `main`** (the qa-branch convention in CLAUDE.md is stale — pull `main` first).
- Prefer **prod DB** over Java code for "what is actually happening" claims (the repo can contain code that the deployed service doesn't exercise).
- Quote the OS / Spec / commit / line — never paraphrase the canonical text.
- Where a Code/OS contradiction is intentional but undocumented, flag it as a **deviation needing OS amendment**, not just a code fix.
