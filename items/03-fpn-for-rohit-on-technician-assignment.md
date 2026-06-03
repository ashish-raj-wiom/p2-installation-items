# 04 — Full-page notification for Rohit (technician) on assignment

> **Type:** Gap (missing capability in technician-app notification UX)
> **Service(s) to update:** Technician app (FPN handler wired to the technician-assignment trigger) · CleverTap (campaign upgraded from standard PN to FPN) · No ES PRD change to behaviour (the underlying event already fires) · No TAS / DAS / CL code change
> **Owner (PM):** Ashis · **Filed:** 2026-05-29

---

## 1. Summary

Today, when a CSP assigns a booking to a technician (Rohit), Rohit receives a standard push notification. PM wants to upgrade this to a **full-page notification (FPN)** — the same heavy-hitting treatment the CSP gets when a booking is allocated to them — so that Rohit can't easily miss it and acts on the booking promptly.

---

## 2. What's happening today

**PM's description:**
> *"When the CSP assigns the booking to his technician, the technician is notified via push notification."*

**Observable behaviour:**
- CSP picks a technician (Rohit) and assigns the booking in the partner app.
- Backend records the assignment; the candidate transitions into `TECHNICIAN_ASSIGNED`.
- A standard CleverTap push notification fires to Rohit's device — appears as a notification-tray banner.
- Banner is easy to swipe away or miss; nothing forces the technician to engage with the booking.

---

## 3. What we want to happen

**PM's desired outcome:**
> *"In order to make sure the technician acts on the booking to avoid delays, a full-page notification (similar to what CSP receives)."*

In plain English:
- The technician should receive a **full-page notification (FPN)** instead of the current banner PN.
- The FPN should mirror the look-and-feel of the CSP's existing allocation FPN — full-screen takeover when the technician opens the technician app (or while it's open), with the booking essentials and a clear CTA to acknowledge / proceed.
- The FPN is **persistent until acknowledged** — if Rohit swipes it away or doesn't open the app, it re-appears the next time he opens the app. There is no SLA or auto-escalation in this item.
- The FPN **replaces** the current standard PN — only one notification per assignment, not both.

---

## 4. What the OS says

Notification UX is not in scope for any LOCKED OS file. The Connection Lifecycle, Demand & Allocation, and Quality OSes are silent on how the technician is notified. **No OS change is needed.**

## 5. What the Spec / PRD says

`yaml-prd/es-installation-service-prd-v2.5.yaml`:

- The state machine has the `TECHNICIAN_ASSIGNED` state and the `ASSIGN_TECHNICIAN` trigger (CSP picks a technician for the booking).
- The outbound event `ES_INSTALL_TECHNICIAN_ASSIGNED` already exists and is the canonical signal at the moment the candidate enters `TECHNICIAN_ASSIGNED`. The notification-service consumes this event to drive the existing PN.
- The PRD does not prescribe a notification treatment (PN vs FPN) — that lives downstream in the CleverTap configuration + the technician app's notification handler.

So the ES PRD itself does not need a behavioural change for this item. The change lives entirely in the notification configuration and the technician app.

## 6. What the Code does

For evidence only — tech will design the implementation.

- `csp-tas-service` already emits `ES_INSTALL_TECHNICIAN_ASSIGNED` on the `ASSIGN_TECHNICIAN` transition into `TECHNICIAN_ASSIGNED` (with the technician's identity in the payload).
- `csp-notification-service` consumes that event and dispatches a CleverTap event today configured as a **standard PN** to the technician's device.
- The Technician app (which is a fork of the CSP app) inherits FPN-capable infrastructure from the CSP app but does not currently wire an FPN handler for the technician-assignment trigger.

---

## 7. Where the gap / bug lives

| Layer | Defined? | Notes |
|---|---|---|
| OS | n/a | Notification UX is not an OS-level concern. |
| Spec (ES PRD v2.5) | Partial | The underlying event `ES_INSTALL_TECHNICIAN_ASSIGNED` is defined and fires today; the PRD does not prescribe notification treatment (PN vs FPN). |
| Backend (TAS) | n/a | No backend change — the event already fires correctly. |
| CleverTap config | ✗ No | Campaign for the technician-assignment event is currently a standard PN; needs FPN configuration. |
| Technician app | ✗ No | No FPN handler is wired for the assignment event today. (FPN capability exists in the codebase, inherited from CSP app — it just isn't connected for this trigger.) |
| CSP app | n/a | No change. |
| Prod today | — | Technicians get standard banner PN; observed behaviour: bookings sometimes sit before the technician engages. |

Classification: **Gap** — missing capability in the notification + technician-app layers. Not a bug; nothing is being violated.

---

## 8. Spec — handed to tech

### Today

- CSP assigns a technician via the partner app → backend records `TECHNICIAN_ASSIGNED` and emits `ES_INSTALL_TECHNICIAN_ASSIGNED`.
- Technician (Rohit) receives a **standard PN** as a notification-tray banner. He may or may not tap it; it can be swiped away and forgotten.

### Want

**Trigger:** every time a candidate transitions into `TECHNICIAN_ASSIGNED` — i.e. on the first technician assignment and on every subsequent re-assignment (when the CSP changes the technician mid-flow).

**What the technician sees:**

| When | Backend | Notification (CleverTap) | Technician app UI |
|---|---|---|---|
| Moment of assignment | Candidate enters `TECHNICIAN_ASSIGNED`; existing event fires | **Replaced** — campaign is now FPN-typed (not a standard PN) | If the app is open: full-page overlay appears immediately. If the app is closed: a heads-up notification opens the app to the FPN on next launch. |
| Technician acknowledges (taps the CTA on the FPN) | No state change | (no event) | FPN dismisses; the booking detail screen is shown. |
| Technician swipes the FPN away without acknowledging | No state change | (no re-trigger needed) | The FPN re-appears the next time the app opens, until acknowledged. **Persistent.** |

**FPN content (mirror the CSP allocation FPN):** the FPN shows the booking essentials — customer name, install address (or short locality), and the confirmed slot if one is already locked in — and a single primary CTA (label TBD by product copy, e.g. *"Got it"* / *"View booking"*).

**Replaces, not adds.** The standard PN that fires today must be removed from the campaign. Only one notification per assignment.

### Edge cases (well-scoped)

1. **Technician opens app after the assignment happens.** FPN fires immediately on open.
2. **Technician is offline (no network) at the moment of assignment.** The FPN is queued by CleverTap and is delivered when the device next reaches the network and opens the app. The FPN is **persistent** — even if the deliver moment is missed, the next app open shows it.
3. **CSP re-assigns the booking from technician A to technician B.** B gets a fresh FPN. A's existing FPN (if still pending acknowledgement on A's device) becomes invalid — A's app should clear it on next refresh because A is no longer the assigned technician for this booking. No new "you've been un-assigned" notification is sent to A.
4. **CSP changes the technician multiple times rapidly.** Each new technician gets an FPN; previously-assigned technicians' FPNs clear on next refresh.
5. **Customer cancels the booking before the technician acknowledges the FPN.** The booking is cancelled; the technician's FPN should clear on next app refresh (no booking to act on).
6. **Connection is cancelled or fails upstream** (CL deactivation, D&A reallocation, customer cancel) **before the technician acknowledges.** Same as cancellation — the FPN clears on next refresh.
7. **Technician acknowledges, then the booking is reassigned to a different technician** (CSP changes their mind). The FPN was acknowledged on the original technician but the assignment is now elsewhere; original technician's app should remove the booking from the active list on next refresh.
8. **Technician dismisses the FPN by tapping outside / back button** (without tapping the CTA). The FPN counts as not acknowledged — re-appears on next app open.

### Notes for tech

- **FPN CTA copy** (label + any subtitle): owned by the **design copy team**, not a dev blocker. Tech proceeds with a placeholder; copy team locks the final text in their normal track.
- **Acknowledgement reporting: fire-and-forget.** No backend event, no CleverTap event on FPN-ack in this item. Matches today's PN behaviour. If we later want ack-rate / time-to-ack tracking, that's a separate item.

### Out of scope

- **SLA / escalation when the technician doesn't acknowledge.** PM-confirmed: no SLA in this item. The FPN simply stays persistent. If we later want CSP-side escalation or auto-reassignment, that's a separate item.
- **FPN treatment for other technician-facing events** (customer slot confirmed, slot rescheduled, customer cancellation, day-of-install reminder). PM-confirmed: only the assignment event in this item.
- **Backend reporting of "FPN acknowledged."** PM-resolved: fire-and-forget. Not in scope.

---

## 9. Risks / dependencies

- **Technician app must have FPN-rendering capability.** The capability exists in the CSP app and the Technician app is a fork — tech needs to confirm the FPN UI shell is wired and not stripped out in the fork.
- **CleverTap campaign change is a config-only change.** Low-risk on its own, but the cutover from standard PN to FPN must be co-ordinated with the app release so devices on older builds (without FPN handler) don't silently miss the notification. Recommend rollout sequence: ship the technician-app update that handles FPNs → confirm rollout coverage → then flip the CleverTap campaign to FPN.
- **Re-assignment FPN clearing** (edge case 3) — the technician app must clear a stale FPN on refresh when the assignment is no longer theirs. Without this, the old technician sees a confusing FPN for a booking they no longer have.
- **No SLA today**, but if the technician routinely ignores FPNs and the bookings stall, we may need to add escalation later. Worth tracking acknowledgement rates after launch.

## 10. References

- **OS:** silent — notification UX is not an OS-level concern.
- **Spec:** `yaml-prd/es-installation-service-prd-v2.5.yaml` — state machine entry `TECHNICIAN_ASSIGNED` and outbound event `ES_INSTALL_TECHNICIAN_ASSIGNED`.
- **Backend (no change):** TAS emits the event today; notification-service forwards it to CleverTap.
- **Apps:** Technician app (fork of CSP app) — `technician-app-development` branch. CSP app's allocation FPN is the reference UX to mirror.
- **CleverTap:** existing campaign tied to `ES_INSTALL_TECHNICIAN_ASSIGNED` event (currently configured as standard PN).
- **Source MD (PM working notes):** `items/04-fpn-for-rohit-on-technician-assignment.md`

## 11. Investigation log

- **2026-05-29 — filed.** Gap in notification UX for technician on assignment. PM-confirmed all 4 behavioural questions: (1) no SLA — FPN persistent until acknowledged; (2) FPN replaces standard PN (not both); (3) every assignment including re-assignments; (4) only on the technician-assignment trigger (other events not in scope). Two remaining open questions flagged: FPN CTA copy (defer to product copy team) and whether to report acknowledgement to backend (default no). Spec is fully ES-/app-/CleverTap-side; no OS, no DAS, no TAS code, no CL code change.
- **2026-05-29 — removed Pre/post diff per surface section** (per PM: no longer needed). Spec structure is now: Pre-state · Post-state (with embedded comm timeline) · Edge cases · Open questions · Out of scope.
- **2026-05-29 — Open Questions closed.** PM resolved both: (1) CTA copy is owned by the design copy team, not a dev blocker; (2) FPN acknowledgement stays **fire-and-forget** — no backend event, no CleverTap event. Open Questions block removed; resolutions baked into a compact "Notes for tech" list. Item 04 is now spec-complete from PM's side.
