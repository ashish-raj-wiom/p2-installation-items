# 05 — Bifurcate "Booking cancelled by customer" vs "Cancelled by system"

> **Type:** Gap (missing capability — bifurcation lost at the customer backend, install side can't distinguish)
> **Service(s) to update:** **Customer backend** (the source — emits a single cancellation signal today regardless of cause; needs to bifurcate) · **`csp-tas-service`** (handler must route the system-cancel branch to `CANCELLED_BY_UPSTREAM` instead of `CANCELLED_BY_CUSTOMER`) · ES PRD (sentence noting the system-initiated path) · No OS change · No DAS change · No partner-app change in this item (PN treatment is future work)
> **Owner (PM):** Ashis · **Filed:** 2026-05-29

---

## 1. Summary

Today, when a booking is cancelled — whether the customer actively cancels or the customer backend's watchdog gives up on a stalled booking — the customer backend sends out **the same** cancellation event. To make things worse, the cause CL records on its outbound `CL_DEACTIVATION_INITIATED` event is then **silently dropped at the TAS deserialization boundary** (TAS's inbound record doesn't include the reason field). The net result: every cancellation lands in `CANCELLED_BY_UPSTREAM` with reason `DEACTIVATION`. The `CANCELLED_BY_CUSTOMER` terminal exists in the spec but has never been reached in production. This item bifurcates at the source (customer backend) **and** stops the cause-loss at TAS, so customer-cancels and system-cancels land in different terminal states.

---

## 2. What's happening today

**PM's description:**
> *"Since no bifurcation, the CSP world does not know about it. The issue is at the customer backend sending out the same event."*

**Observable behaviour:**
- A booking can end up cancelled for two materially different reasons:
  - **Customer-initiated:** the customer actively cancels via the customer app.
  - **System-initiated** (from the customer backend's own watchdogs): the booking has been stuck or unfulfillable from the customer-backend perspective, e.g.
    - Customer didn't respond in time / booking auto-expired.
    - Booking has been sitting at *Technician Assigned* for ~5 days without progress.
    - All CSPs in the zone have declined the booking (no remaining supply).
    - Other lifecycle stalls the customer backend monitors for.
- In both cases, the customer backend emits **one and the same** cancellation signal toward the install/CSP side.
- The install side (TAS) currently lands the candidate in `CANCELLED_BY_CUSTOMER` for either kind of cancellation, because the inbound trigger looks identical.
- Result: no downstream consumer — TAS, partner app, the notification stack, ops dashboards — can tell whether the customer chose to cancel or the system gave up.

---

## 3. What we want to happen

**PM's desired outcome:**
> *"We need this bifurcation split at the source to enable varied types of PNs to be sent to the CSP in future. The change is to be made at customer backend and an appropriate handling is required here as well."*

In plain English:
1. The **customer backend** must emit a **bifurcated signal** — i.e. downstream services must be able to tell whether the cancellation was customer-initiated or system-initiated. (Whether that's two distinct events, or one event with a cause field, is tech's call.)
2. The **install (TAS) side** must consume the bifurcated signal and **land the candidate in the right terminal state**:
   - **Customer-initiated cancel → `CANCELLED_BY_CUSTOMER`** (the existing path).
   - **System-initiated cancel → `CANCELLED_BY_UPSTREAM`** (re-using the existing upstream terminal — which is already where CL T11/T12, D&A REALLOCATION_PENDING, Exit OS, Enforcement-driven cancels land).
3. No new TAS terminal state is needed — the bifurcated targets already exist in the state machine.
4. This item does **not** introduce any new PN, partner-app, or customer-app behaviour. Once the data is bifurcated end-to-end, future items can build differentiated PN treatments on top.

---

## 4. What the OS says

OS is silent on the source of the customer-backend cancellation signal. The Connection Lifecycle OS does distinguish between USER_CANCELLATION (T9 / T13) and SYSTEM_DEACTIVATION (T10 / T11) — but those CL transitions assume the **source** of the signal is itself identified correctly (customer-app vs Exit-OS / timeout-engine). The OS does not enforce or describe the customer-backend's own internal source-tagging. **No OS change is required for this item.**

## 5. What the Spec / PRD says

`yaml-prd/es-installation-service-prd-v2.5.yaml` already defines both terminal states cleanly:

- **`CANCELLED_BY_CUSTOMER`** (L818–822): *"TERMINAL. Customer cancelled the booking — observed via CL_STATE_CHANGED (new_state=PENDING_DEACTIVATION, trigger=USER_CANCELLATION) per CL OS §5.1 T13, or direct CL USER_CANCELLATION event."*
- **`CANCELLED_BY_UPSTREAM`** (L827–831): *"TERMINAL. D&A REALLOCATION_PENDING (non-customer-cancel path), CL T11/T12 retry-exhaustion, Exit S3/S4/R2, or Enforcement SUSPENDED/TERMINATED cancelled the in-flight candidate. Customer-initiated cancellation (CL T13) routes to CANCELLED_BY_CUSTOMER instead."*

And both outbound events are defined:
- `ES_INSTALL_CANCELLED_BY_CUSTOMER`
- `ES_INSTALL_CANCELLED_BY_UPSTREAM`

So the install-side state model already supports the bifurcation. **The gap is that the system-initiated cancellation coming from the customer backend is currently routed into the customer-initiated path** (because the inbound trigger from the customer backend looks the same for both cases). The PRD does not need new states — it needs the system-cancel-from-customer-backend cause routed to `CANCELLED_BY_UPSTREAM` (and a small documentation sentence noting this new upstream-cancel cause).

## 6. What the Code does — actual workflow (verified end-to-end)

For evidence only — tech will revise per the new spec.

**The cancellation workflow today, traced from customer app to TAS:**

1. Customer app → customer backend (booking-service / i2e1).
2. Customer backend → HTTP POST to CL `/events/user-cancellation` with `UserCancellation` payload.
3. CL `handleUserCancellation`:
   - transitions PENDING_INSTALL → PENDING_DEACTIVATION (T_CANCEL / T13) or REQUESTED → DEACTIVATED (T9);
   - sets `connection.deactivation_reason = "USER_CANCELLATION"`;
   - emits outbound `CL_DEACTIVATION_INITIATED` with payload including `connection_id`, `deactivation_reason = "USER_CANCELLATION"`, `actor_type = "USER_INITIATED"`, …
4. Routing-registry HTTP delivery → TAS.
5. **TAS `ClDeactivationInitiated` record only deserializes 4 fields:** `(eventId, correlationId, causationId, connectionId)`. The `deactivation_reason` and `actor_type` from CL are silently dropped at the TAS HTTP boundary.
6. TAS `ClDeactivationInitiated` handler hard-codes `reason = "DEACTIVATION"` and unconditionally calls `cancelByUpstream(...)`.
7. Candidate → `CANCELLED_BY_UPSTREAM` with `reason_code = "DEACTIVATION"`.

This explains the prod data exactly: in the last 14 days, **all 61** cancellations went to `CANCELLED_BY_UPSTREAM` with `reason_code = "DEACTIVATION"`. The `CANCELLED_BY_CUSTOMER` branch is **dead code** in practice — it's defined in the spec and the state machine, but the cause that would route the handler into it is dropped before the handler can see it.

The other upstream-driven cancellations (`ReallocationPending`, `ExitStageChanged`, `EnforcementPostureUpdated`) also flow into `cancelByUpstream(...)` through their own handlers — those are correct.

---

## 7. Where the gap / bug lives

| Layer | Defined? | Notes |
|---|---|---|
| OS | n/a | Cancellation-source tagging is not an OS-level concern. |
| Spec (ES PRD v2.5) | Partial | Both terminal states + outbound events exist; the spec does not currently document the customer-backend system-cancel as an upstream-cancel cause. |
| Customer backend | ✗ No | Routes customer-initiated and system-initiated cancellations through the same path (POST `/events/user-cancellation` on CL). Cause is collapsed at source. |
| CL service | Partial | Records `deactivation_reason` correctly and emits it on `CL_DEACTIVATION_INITIATED`. If the customer backend bifurcates upstream, CL is already capable of carrying the cause through. |
| TAS handler | ✗ No | `ClDeactivationInitiated` record only deserializes 4 fields — drops `deactivation_reason` and `actor_type`. Handler hard-codes `"DEACTIVATION"` and always calls `cancelByUpstream(...)`. |
| Partner app + notifications | n/a | No differentiated UX or PN today; not in scope. |
| Prod today | — | Last 14 days: **61 of 61** cancellations → `CANCELLED_BY_UPSTREAM` / reason `DEACTIVATION`. **0** candidates ever in `CANCELLED_BY_CUSTOMER` across the entire DB. |

Classification: **Gap — missing capability** across the customer-backend → CL → TAS pipeline. Two distinct sub-gaps need closing: the customer backend must distinguish the cause at source; TAS must stop dropping the cause field at deserialization.

---

## 8. Spec — handed to tech

### Today

- The customer backend routes **both** customer-initiated and system-initiated cancellations through the same path — HTTP POST to CL's `/events/user-cancellation` endpoint.
- CL correctly records the cancellation reason on the connection and emits `CL_DEACTIVATION_INITIATED` with the cause in the payload.
- **TAS's deserialized record drops the cause** — only `(eventId, correlationId, causationId, connectionId)` survive.
- TAS handler hard-codes `reason = "DEACTIVATION"` and always calls `cancelByUpstream(...)`. Every cancellation lands in `CANCELLED_BY_UPSTREAM`.
- The `CANCELLED_BY_CUSTOMER` terminal exists in the spec and in the state machine but is **never reached in production** (zero rows in the DB, ever).

### Want

- **Customer backend:** stops lumping system-cancels into the customer-cancel signal. Either uses distinct endpoints / events for customer-initiated vs system-initiated, or carries a cause flag the install side can read. *(Bifurcation mechanism: tech's call.)*
- **TAS:** stops dropping the cause. Extends the inbound `ClDeactivationInitiated` record to keep the `deactivation_reason` (and ideally `actor_type`) that CL is already emitting. Handler branches:
  - `deactivation_reason = USER_CANCELLATION` → `cancelByCustomer(...)` → `CANCELLED_BY_CUSTOMER`.
  - Anything else → `cancelByUpstream(...)` → `CANCELLED_BY_UPSTREAM` (with the cause carried through to `reason_code`).
- The candidate's `reason_code` carries enough detail for ops / dashboards to tell the system causes apart (auto-expiry, stage-stagnation, all-CSPs-declined, etc.) — the customer backend's existing taxonomy is the source of truth for those values.
- **No new TAS terminal states. No new state-machine transitions.** Both `CANCELLED_BY_CUSTOMER` and `CANCELLED_BY_UPSTREAM` already exist in the spec.
- **No PN / partner-app / customer-app change** in this item — bifurcated data simply becomes available for future PN work to consume.

The exhaustive list of scenarios that qualify as "system-initiated" is owned by — and already defined in — the **customer backend**. This spec only requires that whichever scenarios the customer backend already classifies as system-initiated route to `CANCELLED_BY_UPSTREAM` on the install side; the customer-initiated path continues to land in `CANCELLED_BY_CUSTOMER`.

### Edge cases (business)

1. **Customer cancels via the customer app.** Lands in `CANCELLED_BY_CUSTOMER`. *(NEW outcome — today this incorrectly lands in `CANCELLED_BY_UPSTREAM` because TAS drops the cause field at deserialization.)*
2. **Customer backend's watchdog cancels** (auto-expiry / stuck-at-stage / all-CSPs-declined / etc.). Lands in `CANCELLED_BY_UPSTREAM` with a system-cause `reason_code` matching whatever the customer backend already classifies it as. *(NEW reason granularity — today these also land in `CANCELLED_BY_UPSTREAM` but with the same generic `DEACTIVATION` reason as customer cancels.)*
3. **CSP-side cancel paths** (CL T11/T12 retry-exhaustion, D&A REALLOCATION_PENDING, Exit OS, Enforcement) continue to land in `CANCELLED_BY_UPSTREAM` as today. No change to those.
4. **Cancellation signal arrives without a recognisable cause** (malformed payload / unexpected source). Reject / log; **do not default to `CANCELLED_BY_CUSTOMER`** and **do not silently default to `CANCELLED_BY_UPSTREAM` with a generic reason either** — the whole point of this fix is to make the cause explicit, not to pick a fallback.

### Notes for tech

- **`reason_code` is a free-form string at the wire.** PM is **not** enumerating a canonical sub-reason taxonomy in this item. The customer backend sends whatever string it has (e.g. *"auto-expired"*, *"stalled-at-tech-assign-5d"*, *"all-csps-declined"*); TAS records it as-is on the `CANCELLED_BY_UPSTREAM` candidate. The customer-vs-system bifurcation (the actual goal of this item) is satisfied by the cause-tagged route, not by the sub-reason. If later we need a locked enum for dashboards / differentiated PNs, that's a separate item.

### Out of scope

- **Differentiated PN behaviour** for customer-cancel vs system-cancel. Future work; this item only plumbs the data through.
- **Partner-app UI changes** (e.g. labelling the cancellation cause in the partner's history view). Future work, not in this item.
- **Customer-app changes.** Customer-side experience is unchanged.
- **New TAS terminal states or state-machine transitions** — the existing `CANCELLED_BY_CUSTOMER` and `CANCELLED_BY_UPSTREAM` already cover the bifurcation.
- **Specific event names / payload shapes** at the customer-backend → install-side contract. Tech decides whether to use two distinct events, one event with a cause field, or another structure. The only requirement is that downstream can tell the two cases apart.

---

## 9. Risks / dependencies

- **Cross-team coordination with the customer-backend team.** The bifurcation has to be emitted at source — the install side can't infer it from the existing signal. Customer-backend team needs to identify (a) all system-cancel sites in their codebase, and (b) emit the distinguished signal at each.
- **Backfill / cutover.** Existing bookings cancelled before the bifurcation ships will continue to look like customer-cancels in TAS. Acceptable — historical data won't be retroactively re-classified.
- **Dashboards / ops queries.** Any internal dashboard that counts "customer cancellations" today is over-counting (because system-cancels are mis-classified as customer-cancels). After this fix the customer-cancel count will drop and the upstream-cancel count will rise — communicate this to ops so the swing isn't read as a customer-behaviour change.
- **Idempotency** between customer-app cancel and customer-backend system-cancel watchdog (when both fire close in time). Standard idempotency at the TAS layer should handle it; worth confirming during build.
- **No downstream PN / app change in this item** — but PM should track the follow-up items (differentiated PNs, partner-app UX) so the bifurcated data doesn't just sit unused.

## 10. References

- **OS:** silent — cancellation source-tagging at the customer-backend is not OS-level.
- **Spec:** `yaml-prd/es-installation-service-prd-v2.5.yaml` — `CANCELLED_BY_CUSTOMER` state (L818–822), `CANCELLED_BY_UPSTREAM` state (L827–831), outbound events `ES_INSTALL_CANCELLED_BY_CUSTOMER` and `ES_INSTALL_CANCELLED_BY_UPSTREAM` (L3409, L3449).
- **Code evidence (for tech context — not the fix):** `services/csp-tas-service/src/main/java/io/wiom/csp/tas/install/application/impl/InboundEventProcessingServiceImpl.java` — `CANCELLATION_TRIGGERS = Set.of("USER_CANCELLATION")` is the current trigger that routes to `cancelByCustomer(...)`. `ReallocationPending` / `ExitStageChanged` / `EnforcementPostureUpdated` handlers already call `cancelByUpstream(...)` for their respective causes.
- **Customer backend:** booking-service / i2e1. Cross-team change required.
- **Source MD (PM working notes):** `items/05-cancel-bifurcation-customer-vs-system.md`

## 11. Investigation log

- **2026-05-29 — Open Question closed.** PM resolved: **don't enumerate** a canonical reason-code taxonomy in this item. `reason_code` is a free-form string at the wire; TAS records whatever the customer backend sends. The customer-vs-system bifurcation is the goal — sub-reason enumeration is deferred to a future item if dashboards / PNs later require it. Block removed; resolution absorbed into a "Notes for tech" list.

- **2026-05-29 — filed.** Gap in cancellation-source bifurcation between customer backend and install side. PM-confirmed 4 things: (1) "System-initiated cancel" covers booking auto-expiry + stage-stagnation timeouts (e.g. stuck at technician-assigned for 5 days) + all-CSPs-declined + similar lifecycle stalls in the customer backend; (2) bifurcation mechanism (two events or one with cause) is tech's call; (3) TAS lands customer-cancels in `CANCELLED_BY_CUSTOMER` and system-cancels in `CANCELLED_BY_UPSTREAM` — both terminal states already exist in the spec; (4) no differentiated PN in this item — future work. One open question flagged for follow-up: canonical reason-code list for system-cancels.
- **2026-05-29 — removed the "Which scenarios count as system-initiated" enumeration** (per PM: this list is already well-defined in the customer backend; not our job to re-define here). The spec now simply states that whichever scenarios the customer backend already classifies as system-initiated must route to `CANCELLED_BY_UPSTREAM` on the install side. Customer backend owns the source-of-truth list.
- **2026-05-29 — validated and corrected the edge-case claims after a PM challenge.** I had claimed *"today this lands incorrectly in `CANCELLED_BY_CUSTOMER`"* — wrong. Checked prod and the live code path: in the last 14 days, **61 of 61** cancellations landed in `CANCELLED_BY_UPSTREAM` / reason `DEACTIVATION`; **0** candidates have ever reached `CANCELLED_BY_CUSTOMER` in the entire database. Traced the end-to-end workflow: customer app → customer backend → CL `/events/user-cancellation` → CL transitions and emits `CL_DEACTIVATION_INITIATED` with `deactivation_reason = "USER_CANCELLATION"` → TAS's `ClDeactivationInitiated` inbound record only deserializes 4 fields and drops the reason → handler hard-codes `"DEACTIVATION"` and always calls `cancelByUpstream(...)`. The `CANCELLED_BY_CUSTOMER` terminal is therefore **dead code** in practice. Updated §1 / §6 / §7 / §8 (Pre-state, Post-state, Edge cases) to reflect this. The fix is now explicit about two sub-gaps: customer backend bifurcates at source, **and** TAS stops dropping the cause field at deserialization.
