# 02 — Same CSP re-assigned in single-CSP zones (P51 cooldown bypass)

> **Type:** Bug — **Implementation miss** (the spec is correct; code deviates from it)
> **Ownership:** Tech owns the technical solution — this item just points at the violated spec + the deviation site. PM owns the PRD clarification (if any) once the bypass is removed.
> **Service(s) to update:** `csp-demand-allocation-service` (code fix at the deviation site)
> **Owner (PM):** Ashis · **Filed:** 2026-05-29

---

## 1. Summary

When a zone has only one eligible CSP and that CSP marks install failure, the DAS routing engine **deliberately bypasses the P51 cooldown** and re-routes the booking back to the same CSP — sometimes within seconds. The OS says this is forbidden; the code does it anyway under a tag called `SINGLE_CSP_ZONE_CONTINUITY` that has no spec, no amendment, and no decision-log entry.

This item carries **two coupled fixes** that must ship together:

1. **Remove the `SINGLE_CSP_ZONE_CONTINUITY` bypass** in the DAS routing engine (the original framing of this item).
2. **Wire the P195 ping-pong counter to increment on the install-failure path** in DAS. Today `InboundEventProcessingServiceImpl.handleClStateChanged` correctly applies P51 cooldown but **does not** call `incrementAssignmentCount`, so the P195 cap on "same CSP for the same connection" is silently never enforced. OS L572 explicitly mandates that P195 covers *"…or fail the same connection."* Value of P195 is read from AWS Parameter Store at runtime — see §1a.

Either fix in isolation leaves a loop open. Together: each CSP can be re-assigned the same connection up to the P195 cap, with 4h cooldown between attempts (P51); once the cap is reached they are permanently excluded from this connection's routing.

---

## 1a. Parameters used in this item

| Term | Meaning |
|---|---|
| **P51** | DAS **decline cooldown** — 4h. After a CSP declines or marks install failed on a connection, that CSP **cannot be re-assigned the same connection** for 4 hours. The absolute rule this item's bug violates. |
| **P46** | DAS **capacity cap** — CSP-level cap on concurrent active allocations. OS's CONTINUITY mode (L298–322) sanctions a relaxation of *this* (via `P_DA_CONTINUITY_CAP_RATIO`) in single-CSP zones. It does **not** sanction relaxing P51. |
| **P50** | DAS **routing retries** — 5 attempts. Max attempts the routing engine makes to find an eligible CSP for an unallocated connection before declaring routing-failure. The correct fall-through when P51 keeps the single CSP excluded. |
| **P75** | CL **request expiry** — 7d. The backstop: if a connection sits `REQUESTED` (no successful allocation) for 7 days, CLOS deactivates it. The OS-sanctioned final resolution when the supply problem genuinely can't be fixed. |
| **P195** | DAS **ping-pong cap** — value sourced from AWS Parameter Store (`P195_SAME_CONNECTION_REASSIGN_LIMIT`); current canonical value **3** (code default in `DemandAllocationParameters.java:100`; OS doc L572 still shows older `2` default — minor doc-drift, not blocking). Max number of times the same connection can be assigned to the same CSP across its lifecycle (includes retries and reallocations). Per OS L572: *"Prevents infinite ping-pong when limited CSPs repeatedly decline or fail the same connection."* Predicate logic at `RoutingEngineServiceImpl:333` is correctly wired; the counter-increment trigger is missing on the install-failure path — see §6. |
| **P78** | CL **install retry cap** — 3. Today, with P195 inert, this is the only thing bounding the rapid-reject loop. After 3 install-failure events on the same connection, CL fires T12 → PENDING_DEACTIVATION (RETRY_EXHAUSTION). |

---

## 2. What's happening today

**PM's description:**
> *"If there is only 1 CSP allocated by the DAS, and if he marks installation failure, the booking is again allocated to the same CSP immediately."*

**Evidence — prod DB (`csp_demand_allocation_service.connection_allocations`, last 7 days):**

| connection_id | zone | csp | declines in cooldown list | tightest gap | currently assigned |
|---|---|---|---|---|---|
| `a4a1aaeb-…` | zone_3167 | `a0b3l5` | **3** (today 00:07, 02:11, 02:18) | **7 min** | yes, `a0b3l5` |
| `d1e0bd49-…` | zone_3425 | `a0a7c1` | **3** (05-27 17:26, 17:27, 17:27) | **36 seconds** | yes, `a0a7c1` |
| `f5c17758-…` | zone_3372 | `a0a7b3` | 2 (05-28 05:24, 08:36) | 3h | yes, `a0a7b3` |
| `e6e3346b-…` | zone_3250 | `a0a7a7` | 3 (05-23 04:39, 04:43, 05-26 17:00) | 4 min | yes, `a0a7a7` |

`P51 = 4h`. Every "tightest gap" above is well *inside* P51 — the OS-mandated cooldown is being ignored. In the worst case (`d1e0bd49`) the same CSP was re-routed the same booking three times inside 68 seconds. `csp_id` on the row is *still* that CSP today.

**Query used:**
```sql
SELECT connection_id, zone_id, csp_id, retry_count,
       jsonb_array_length(decline_cooldown_csp_ids::jsonb) AS cooldown_len,
       decline_cooldown_csp_ids, updated_at
FROM csp_demand_allocation_service.connection_allocations
WHERE jsonb_array_length(decline_cooldown_csp_ids::jsonb) >= 2
  AND updated_at >= NOW() - INTERVAL '7 days'
ORDER BY updated_at DESC;
```

---

## 3. What we want to happen (per the OS)

The OS is unambiguous: **the same CSP cannot be re-assigned the same connection within the P51 cooldown — single-CSP zone or not.** The OS's only sanctioned single-CSP relaxation is the **P46 capacity cap**, not the P51 decline cooldown; and the OS explicitly contemplates *"ZERO allocation, service vacuum accepted"* (L540) as the right outcome when the only CSP in the zone is unavailable.

Expected behaviour when a CSP declines in a single-CSP zone:

1. The CSP enters **P51 cooldown (4h)** for this connection — already wired correctly (`InboundEventProcessingServiceImpl:429`).
2. Routing engine excludes the CSP under `P51_COOLDOWN` — already wired correctly (`RoutingEngineServiceImpl:99–100`).
3. `eligibleSet` becomes empty → routing returns FAILURE → allocation stays `UNASSIGNED`.
4. D&A applies its **P50 routing retries** (max 5) over time; each retry still excludes the cooled-down CSP.
5. After P50 exhaustion → emit `ALLOC_STATE_ROUTING_FAILURE`. (Per the OS this event is consumed by Exit OS S4; Exit OS isn't implemented today, so it's a no-op for now — separate matter, not a dependency for this fix.)
6. Once P51 expires (4h), the CSP becomes eligible again — a fresh routing attempt may re-select them.
7. Backstop: CL's `P75 = 7d REQUEST_EXPIRED` kills the request if still unfilled after a week.

In short: **wait, don't loop.** Single-CSP zones with a declining partner are expected to fail visibly so Capacity OS sees the supply deficit — not to be papered over by re-handing the booking to the same partner.

---

## 4. What the OS says

`Demand_Allocation_OS_v1_9_1_LOCKED.md`:

> **L176 (absolute rule):** *"Declined CSP is subject to P51 cooldown for that specific connection (cannot be re-assigned the same connection within cooldown)."*

> **L298–322 (Single-Provider Continuity Mode):** *"Active when eligible_csp_count ≤ 1 in zone AND Tier 3 would drive allocation to zero. … apply continuity rules: effective_cap = P46 × P_DA_CONTINUITY_CAP_RATIO; safety floor check."* — CONTINUITY mode relaxes the **P46 capacity cap**. The section does not mention P51.

> **L317:** *"On entry: emit `SINGLE_PROVIDER_CONTINUITY_ACTIVE` … emit `ZONE_SUPPLY_DEFICIT_SIGNAL` to Capacity OS. **This is a state transition trigger in Capacity OS, not a notification.** D&A detects. Capacity OS owns resolution."*

> **L540 (routing-outcome table):** *"Single-CSP zone, CSP is SUSPENDED/FPV → CONTINUITY killed → Fail → **ZERO allocation, service vacuum accepted**."* — Service vacuum is the OS-sanctioned outcome when the only CSP is ineligible.

So the OS sanctions exactly one single-CSP-zone relaxation (P46 cap), explicitly defines the escalation path (Capacity OS via `ZONE_SUPPLY_DEFICIT_SIGNAL`), and explicitly accepts zero-allocation as the correct fall-through. **There is no OS-sanctioned path for "in a single-CSP zone, re-include a cooled-down CSP."**

## 5. What the Spec / PRD says

`yaml-prd/demand-allocation-prd-v1.2.yaml` (DAS PRD) defines:

- **State machine (L394–429):** `ASSIGNED → DECLINED → UNASSIGNED` for re-routing; **no path for "DECLINED → ASSIGNED to the same CSP."**
- **CONTINUITY mode:** mirrors the OS — P46-cap relaxation only.

`yaml-prd/diff-demand-allocation-prd-v1.1-to-v1.2.yaml`:

- Defines change-ids `B-FLW-01` (csp_decline_flow.record_decline) and **`B-FLW-02`** (the change-id the code comment cites).
- `B-FLW-02`'s actual scope, however, is *"three flow edges that previously jumped directly to `eligibility_gate` must now route through the new pre-filter"* — the customer-app `candidate_csps[]` per-address feature shipped 2026-04-27. **`B-FLW-02` says nothing about cooldown, P51, or a single-CSP re-include.**

## 6. What the Code does

`services/csp-demand-allocation-service/src/main/java/io/wiom/csp/demand_allocation/application/impl/RoutingEngineServiceImpl.java:108–135`:

```java
// v1.5: Single-CSP fallback — continuity over starvation (B-FLW-02)
boolean cooldownBypassed = false;
String cooldownBypassReason = null;
if (eligibleSet.isEmpty() && !excludedCsps.isEmpty()) {
    // Check if exactly one CSP excluded solely due to P51 cooldown
    List<String> p51OnlyCsps = excludedCsps.entrySet().stream()
            .filter(e -> e.getValue() == CspExclusionReason.P51_COOLDOWN)
            .map(Map.Entry::getKey)
            .toList();
    boolean allExclusionsAreP51 = p51OnlyCsps.size() == excludedCsps.size();

    if (allExclusionsAreP51 && p51OnlyCsps.size() == 1) {
        // Re-include the single cooled CSP for THIS routing pass only
        ...
        eligibleSet.add(bypassedCsp);
        cooldownBypassed = true;
        cooldownBypassReason = "SINGLE_CSP_ZONE_CONTINUITY";
        log.info("Single-CSP fallback ACTIVATED: connectionId={} bypassedCsp={} — cooldown record persists", ...);
    }
}
```

**Provenance (git):**
- PR **#184** — *"Install failure reallocation: ES→CLS→DAS retry chain + P51 cooldown"* (branch `DAS-reallocation-logic-fix`, merged 2026-05-09).
- Commit `82d24be6` *"DAS v1.5 changes"* by Raushan Kapoor (commit body empty).
- That single commit added the P51 *write* on retry intake (correct) **and** the P51 *bypass* in routing (this bug), plus the `V17__cooldown_audit_columns.sql` migration (`cooldown_bypassed` / `cooldown_bypass_reason`).
- No companion OS amendment and no PRD update accompanied the code change.

**Second deviation site — P195 increment missing on install-failure path:**

`services/csp-demand-allocation-service/src/main/java/io/wiom/csp/demand_allocation/application/impl/InboundEventProcessingServiceImpl.java:418–441` is the DAS handler for `CL_STATE_CHANGED` with `entry_reason=RETRY` — i.e. the install-failure-driven reroute path. It correctly:

- Sets allocation to `UNASSIGNED`, records `previous_csp_id`
- Adds the failed CSP to P51 cooldown at line 429 (`AllocationServiceImpl.addDeclineCooldown`)
- Invokes `executeRoutingPipeline` to re-route

But it does **NOT** call `AllocationServiceImpl.incrementAssignmentCount(allocation, event.cspId())` before the re-route. As a result, the counter that the routing engine's P195 predicate reads (`RoutingEngineServiceImpl:333` — `count >= parameters.getP195SameConnectionReassignLimit()`) stays at zero forever.

Verified in prod against `d1e0bd49-b082-4817-ba81-400312be3c20`: `assignment_count_per_csp = {}` despite 4 install-failures from the same CSP within ~3 minutes. With the counter never advancing, P195 cannot exclude the CSP regardless of its configured value — every routing pass picks the same partner again, and the loop is bounded only by CL P78 = 3 (terminal at the 4th install-failure event via T12 → RETRY_EXHAUSTION).

The other two increment call sites (`AllocationServiceImpl.declineAllocation:71` and `BatchTriggerServiceImpl.runAllocationTimeoutSweep:48`) are themselves dead — the first has no upstream caller post-AMENDMENT-02, the second is gated on the unwired AWS scheduler (Item 07). So the missing wire on the install-failure path is the *only* thing keeping P195 from working in prod today.

This violates OS L572 / FM-DAO-12: *"Maximum number of times the same connection can be assigned to the same CSP across its lifecycle (includes retries and reallocations). … Prevents infinite ping-pong when limited CSPs repeatedly decline **or fail** the same connection."*

---

## 7. Where the gap / bug lives

| Layer | Defined? | Notes |
|---|---|---|
| OS (DAS) | ✓ Yes | L176 (absolute), L298–322 (CONTINUITY = P46 only), L540 (service vacuum accepted). |
| Spec (DAS PRD + diff) | ✓ Yes | State machine has no DECLINED→ASSIGNED-to-same-CSP path; `B-FLW-02` in PRD diff is unrelated. |
| Code (DAS) — bypass | ✗ Violates | `RoutingEngineServiceImpl:108–135` explicit `SINGLE_CSP_ZONE_CONTINUITY` re-include. Violates OS L176. |
| Code (DAS) — P195 increment | ✗ Missing | `InboundEventProcessingServiceImpl:418–441` doesn't call `incrementAssignmentCount` on install-failure reroute. Violates OS L572. |
| Prod | ✗ Wrong | Same CSP re-routed within seconds (4 install-failures in 3 min on `d1e0bd49`, 27 of 39 bypass-affected connections in last 14d ended retry-exhausted). |

Classification: **Bug — Implementation miss.** The OS *is* defined (L176), the PRD *is* consistent (no bypass anywhere), and the code *consciously* goes the other way under a misleading change-id citation. Per the project guideline, bugs that are implementation misses leave the technical solution to tech — this item's job is to identify the violated spec and the deviation site.

## 8. Spec — handed to tech

### Today

- When a CSP marks installation failed, the system correctly applies a **4-hour cooldown** for that CSP on that connection.
- The routing engine correctly excludes cooldowned CSPs from re-selection — except in zones with only one eligible CSP, where the **`SINGLE_CSP_ZONE_CONTINUITY` bypass** silently re-includes the cooled-down CSP and sends the booking right back to the same partner (sometimes within seconds).
- The **P195 ping-pong counter** that should cap "how many times the same CSP gets the same booking" silently doesn't increment on the install-failure path. So even outside the single-CSP-zone bypass, the system has no protection against a CSP being re-tried beyond the P195 cap. In prod today, `assignment_count_per_csp = {}` on every allocation row — the counter literally never advances.
- Net effect: a CSP can rapid-reject install-failures and have the booking come right back. The loop is bounded only by CL P78 = 3 (terminal at the 4th install-failure event), typically within minutes.

### Want

- When a CSP marks installation failed, the 4-hour cooldown applies **absolutely** — including in zones with only one eligible CSP. No exceptions.
- The **P195 ping-pong cap** applies absolutely on install-failure: once a CSP hits the P195 cap on a given connection, that CSP is permanently excluded from this connection's routing pool. This is what OS L572 mandates — *"Prevents infinite ping-pong when limited CSPs repeatedly decline or fail the same connection."* Combined with P51, each CSP gets up to the P195 cap's worth of attempts per connection-lifetime, with a 4-hour gap between them. The cap's exact value is read from AWS Parameter Store; tech does not hardcode it.
- If no other CSP is eligible (during the cooldown window, or after P195 exhaustion), the booking stays unallocated. The customer waits. This is consistent with OS L540 (*"service vacuum accepted"*) — the OS expects Capacity OS to address the supply problem, not for DAS to paper over it.

### Edge cases (business)

1. **Zone has ≥ 2 eligible CSPs, one is cooldowned.** Routing picks one of the others. (No change.)
2. **Zone has only 1 eligible CSP, who just failed install.** Booking stays unallocated for 4 hours. The customer is not assigned a new partner during the cooldown — intentional per OS.
3. **After the 4-hour cooldown expires (single-CSP zone, P195 count below cap).** CSP becomes eligible again; routing may re-select them. A subsequent install-failure applies a fresh 4-hour cooldown and bumps the P195 count.
4. **Once the P195 cap is reached.** P195 excludes the CSP permanently from this connection's routing pool. In a single-CSP zone, routing engine finds no eligible CSPs → `ALLOC_STATE_ROUTING_FAILURE` emitted → connection stays UNASSIGNED → CL P75 (7d) eventually deactivates. In a multi-CSP zone, the routing engine picks a different CSP.
5. **CSP fails install on multiple connections in the same zone.** Each connection has its own independent cooldown and P195 counter — both are scoped per *(CSP, connection)*, not per CSP.
6. **D&A's own P50 routing retries exhaust while the cooldown is still active.** The connection moves to `ROUTING_FAILURE` via the existing path. No new behaviour from this fix.

### Out of scope

- **Customer notification** that their booking is on hold during the cooldown.
- **CSP notification** that they declined and are on cooldown.
- **Exit OS S4 escalation** behaviour on routing failure (Exit OS not implemented today, separate matter).

---

## 9. Risks / interactions

- **Both fixes must ship together.** Removing the bypass without wiring P195 still leaves the rapid-reject vector partially open — a CSP can fail install, wait out 4h cooldown, then be re-selected, fail again, until CL P78 = 3 terminates the connection. Wiring P195 without removing the bypass is overridden by the bypass itself (which re-includes the cooled-down CSP regardless of the P195 predicate). Together: the P195 cap (value per AWS Parameter Store) actually bounds per-CSP attempts, with a 4h gap between them — the OS-intended behaviour at OS L572.
- **Single-CSP zones will see worse customer outcomes (visibly).** Once both fixes ship, low-supply zones where the lone CSP refuses installs will have bookings sit `UNASSIGNED` after the second install-failure rather than thrashing for ~3 minutes until P78 kills them. This is the OS-mandated behaviour (L540 *"service vacuum accepted"*) but it is a visible product change. The right response (per OS) is for **Capacity OS** to resolve the supply problem, not for DAS to paper over it.
- **Customer impact data.** In the last 14 days, **27 of 39 connections (69%)** that hit the `SINGLE_CSP_ZONE_CONTINUITY` bypass ended retry-exhausted (`PENDING_DEACTIVATION` with `retry_exhausted=true`). Median gap between consecutive install-failures on the same connection: **34 seconds**. Minimum gap: **7 seconds**. The bypass + missing P195 combination is actively killing bookings.
- **Closes the loop on Item 01 (single-CSP caveat).** Item 01 noted that retriggering an ignored CSP in a single-CSP zone would loop back to the same CSP because of this bug. Fixing this item removes that caveat — Item 01's retrigger then works correctly in single-CSP zones too.
- **No data migration / no schema change.** The `V17__cooldown_audit_columns.sql` columns (`cooldown_bypassed`, `cooldown_bypass_reason`) can stay — they'll just always be `false` / `null` after the fix. The `assignment_count_per_csp` column is already in place; the fix just starts populating it.
- **Test coverage.** Any DAS test that asserts `SINGLE_CSP_ZONE_CONTINUITY` fires must be updated/removed. Search `RoutingEngineServiceImplTest` / `BatchTriggerServiceImplTest` for `cooldownBypass` references. Also add tests that verify `assignment_count_per_csp` advances on every `handleClStateChanged` call with `entry_reason=RETRY`.

## 10. References

- **OS:** `os/Demand_Allocation_OS_v1_9_1_LOCKED.md` L176 (P51 absolute rule) · L298–322 (CONTINUITY = P46 only) · L317 (Capacity OS escalation) · L539–540 (service vacuum accepted) · **L572 (P195 ping-pong cap, "or fail the same connection")**.
- **Spec:** `yaml-prd/demand-allocation-prd-v1.2.yaml` (state machine L394–429, CONTINUITY routing) · `yaml-prd/diff-demand-allocation-prd-v1.1-to-v1.2.yaml` (B-FLW-02 — actually about `candidate_csps[]` pre-filter).
- **Code (DAS) — bypass deviation:** `RoutingEngineServiceImpl.java:108–135` · `:99–100` (the correct exclusion the bypass undoes).
- **Code (DAS) — P195 missing increment:** `InboundEventProcessingServiceImpl.java:418–441` (install-failure handler — needs `incrementAssignmentCount` call before re-route) · `AllocationServiceImpl.java:193–213` (`incrementAssignmentCount` helper — exists, just not called from this site) · `RoutingEngineServiceImpl.java:333` (the P195 predicate that's waiting for the counter to advance).
- **Code (correct, keep):** `InboundEventProcessingServiceImpl.java:429` (P51 cooldown write on install-failure path) · `AllocationServiceImpl.java:174–191` (`addDeclineCooldown` helper).
- **Provenance:** PR #184 `DAS-reallocation-logic-fix` · Commit `82d24be6` *"DAS v1.5 changes"* by Raushan Kapoor 2026-05-09 · Migration `V17__cooldown_audit_columns.sql`.
- **Related project notes:** [[cl-timer-enforcement-gap]] BUG-8 (the bypass finding) · Item 01 (slot-proposal retrigger — closes the single-CSP caveat once this fix lands).
- **Sample connection IDs for retesting:** `a4a1aaeb-4239-4a7f-9667-b6409433eddc` (csp `a0b3l5` ×3 in 2h) · `d1e0bd49-b082-4817-ba81-400312be3c20` (csp `a0a7c1` ×3 in 68 sec, deactivated at 4th attempt) · `f5c17758-a66f-4bad-bf57-74cb89831082` · `e6e3346b-9ce4-45cc-85b0-6ba28b221148`.

## 11. Investigation log

- **2026-05-29 — filed.** Investigated against `main` (`f671132a`); bypass code unchanged since PR #184. Re-pulled DB: 4 fresh same-CSP-repeat cases in last 7 days, including same CSP re-assigned **3 times in 68 seconds**. Classified as Bug — OS deviation in code, undocumented.
- **2026-05-29 — updated.** Per PM: dropped the optional NOTIF/communication step (out of scope) and the Exit OS observability step (Exit OS doesn't exist today). Fix plan is now 3 steps: DAS code removal, agent-decisions log entry, PRD clarification. Risks trimmed accordingly. Want-flow tag changed from "ALLOC_STATE_ROUTING_FAILURE → Exit OS S4" to just "ALLOC_STATE_ROUTING_FAILURE emitted" so the diagram doesn't imply a consumer that isn't there.
- **2026-05-29 — re-classified per new project guideline.** Bugs now carry a sub-type (Spec gap vs Implementation miss). This one is **Implementation miss** — the OS L176 + DAS PRD are both correct; the code consciously deviates. Reframed §8 from a prescriptive fix list into two owner blocks: (a) **Tech owns** the technical solution (handed the violated spec + deviation site + post-fix invariant + don't-touch list + test files; approach is tech's call), and (b) **PM owns** the docs (agent-decisions log + PRD clarification). HTML restyled with the matching tech/PM owner blocks and a sub-classification badge under the BUG label.
- **2026-05-29 — added human-readable spec.** Per PM, Item 02 was missing a clean human-readable spec (Pre-state / Post-state / Edge cases / Out of scope) — it had jumped straight from prod evidence to the tech/PM owner blocks. Added §8 spec section (renamed prior §8 to §8a). Spec describes the buggy behaviour today vs. what should happen per OS, with 5 business edge cases and an out-of-scope list. The tech/PM owner blocks now sit below it as implementation guidance.
- **2026-05-29 — removed the fix-split-by-owner block** (per PM: not needed). Also removed the inline "Code — the deviation" code-quote block from §6 / the HTML's source-quotes section. Code provenance + deviation site are still referenced in §10 (References). Net Item 02 structure: Spec is the deliverable; what-the-OS-and-spec-say-today section gives the OS quote + DAS PRD position as context, without the prescriptive code-fix details.
- **2026-05-29 — stripped all live agent-decisions references** (per PM: agent-decisions is a codegen-pipeline-internal artefact that doesn't belong in a PM-facing tech-handoff spec). Removed the "Agent decisions" row from §7's classification table; deleted the §5 paragraph about the DAS agent-decisions doc having zero matches for the deviation; tightened the front-matter Ownership / Service(s)-to-update lines to drop the PM-owns-agent-decisions-log clause; trimmed the §6 provenance bullet. Same cleanup applied to Items 06, 07, 08. The HTML's separate "Agent-decisions doc — bypass not logged" subsection (with the file path) is removed too.
- **2026-05-29 — added the P195-install-failure gap as a coupled second fix.** Deep-dive investigation of `d1e0bd49-…` revealed that `InboundEventProcessingServiceImpl.handleClStateChanged` (the install-failure-driven reroute path) correctly applies P51 cooldown but does **not** call `incrementAssignmentCount`. The P195 counter therefore never advances — verified in prod (`assignment_count_per_csp = {}` despite 4 install-failures from the same CSP in 3 min). The two other increment sites (`declineAllocation` and the P41 sweep) are themselves dead, so this missing wire is the *only* thing keeping P195 inert in prod. OS L572 explicitly says P195 covers *"…or fail the same connection,"* so the install-failure path must increment. Item 02's spec, §6 (added second deviation site), §7 (new code row), §8 (Today + Want + new edge case 4), and §9 (why the two fixes must ship together) all updated to cover this. Customer-harm data added: 27 of 39 bypass-affected connections in last 14d ended retry-exhausted (69%).
- **2026-05-29 — corrected P195 value handling.** Earlier draft baked `P195 = 2` (from OS doc L572) into the spec body. PM flagged this — the canonical value is **3** (code default in `DemandAllocationParameters.java:100`, read at runtime from AWS Parameter Store via `application.yml:84` env-var `P195_SAME_CONNECTION_REASSIGN_LIMIT`). OS doc L572 still shows the older `2` — minor doc-drift, same pattern as P77 (45d AWS vs 30d OS doc). Updated §1a Parameters table to show the value with the AWS-source note; rewrote §1, §6, §8 Today, §8 Want, §8 Edge cases 3 + 4, and §9 to refer to "the P195 cap" abstractly rather than hardcoding a number. The behavioural invariant (CSP permanently excluded once cap is reached) is what the spec commits to; the cap's value remains a runtime-configurable param tech reads from the env.
