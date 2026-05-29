# 09 — Show address-locality + landmark + voice direction in the CSP App

> **Type:** Gap (capture is live on customer side; CSP-side display surface not yet wired)
> **Service(s) to update:** CSP App (`TaskDetail` model · drilldown `InstallDrilldownContent` §4 Location card · `FpnOverlay` + `FpnPayload`) · Design team (voice-playback UX) · **No customer-backend / booking-service work here** — that's tracked by the upstream "Address + Landmark + Voice Onboarding" PRD ("Backend persistence + Partner sync pending") · **Wire-format / API-schema decisions** for the new fields are tech's call, not part of this PM spec.
> **Owner (PM):** Ashis · **Filed:** 2026-05-29
> **Upstream reference:** `C:\Users\ashis\Downloads\PRD_ Address + Landmark + Voice Onboarding.pdf` (Customer App, feature/chat — PR 1 + PR 2 shipped)

---

## 1. Summary

The customer app's address-capture flow has been replaced (Customer App, feature/chat — PR 1 + PR 2 shipped) with a 3-field structured address + type-driven landmark + optional 30-second voice direction. The CSP App today carries the structured address (AMENDMENT-03 fields: `addressHome`, `addressStreet`, `addressCity`, `addressPincode`, `addressLat/Lng`) but is **missing** the landmark type, landmark name, voice clip, and locality input. Net effect for the CSP / technician: the partner sees only the bare address — they cannot see *"opposite Shiv Mandir"* or play the customer's *"घर के पीछे वाली गली"* audio note, both of which were the explicit purpose of the customer-side upgrade.

This item scopes only the **CSP-side surface and rendering**. Backend persistence (booking-service / customer-backend) is the customer-side PRD's responsibility and is tracked there.

---

## 2. What's happening today

**PM's description:**
> *"Showing Voice Directions on the CSP app. Please find the changes done with this regard in the customer app PRD … Expected is that we show these details in the csp app correctly."*

**Observable behaviour:**

- **Customer side (already shipped):** The customer app's chat-onboarding (and wrong-address recovery flow) captures the 3-field address, the landmark type + name, and the optional voice clip. UI is live; backend persistence and partner sync are pending per the upstream PRD's ship status.
- **CSP side (today):** The install drilldown's Customer Details section renders only the structured address via `streetHomeAddress()` (Street + Home), city, pincode — no landmark name, no landmark type / icon, no voice playback control. The FPN allocation overlay shows even less — the partner sees a stripped address summary only.
- **Net effect:** A customer who has carefully captured *"opposite Shiv Mandir, 2nd floor blue gate"* + a 25-second voice clip describing the lane has shared all of that with the customer backend, but the CSP / Rohit who actually has to find the house never sees a single new field.

**Evidence — code (verified against `wiom-csp-app-apr09`, `development` branch, current HEAD):**

- **Model** — `core/model/src/main/java/com/wiom/csp/core/model/TaskDetail.kt:100–109` — the AMENDMENT-03 block: `addressLine`, `addressHome`, `addressStreet`, `addressPincode`, `addressCity`, `addressLat`, `addressLng`. Comment: *"All nullable while BE backfills."* No landmark-related field.
- **Drilldown — Location SectionCard** — `feature/home/.../drilldowns/install/InstallDrilldownContent.kt:233-289` — `SectionCard(title=drilldown.location_question, leadingIcon=Place)` renders `task.streetHomeAddress()` stacked on two lines + a "View on map" link (uses `addressLat / addressLng` when present, else geocodes the address text). On empty address: shows `WiomLabels.get("location.not_available")`. **No landmark, no locality, no voice clip in this card today.**
- **FPN overlay** — `feature/home/.../FpnOverlay.kt:59,282` — `FpnOverlayData.landmark: String` is **already a field**, with the example comment *"Bhairo baba Mandir"*. Rendered as a dedicated row (`titleSm`, 16sp bold, max 1 line, ellipsis) above the address row. **Sourced today from `FpnPayload.landMark()` → FCM `task.extraData.landMark`** (free-text legacy field). The customer-app's new structured fields are not threaded through here yet.
- **CustomerDetailsScreen (install wizard)** — `feature/installation/.../CustomerDetailsScreen.kt:162-169` — also uses `streetHomeAddress().orEmpty()`. Also lacks landmark / locality / voice.
- **`TaskDetail.locality: String`** (line 16) — top-level field used for the home-feed card preview. Might or might not be the same semantic field as the PRD's `localityInput` (see Open Q1).
- **Customer-side fields** (`landmarkType` enum, `landmarkInput` string, `voiceFilePath`, `voiceDurationSeconds`) — **zero matches** anywhere in the CSP App tree. Even the existing `FpnOverlayData.landmark` is a single string, not the new structured type+name.

---

## 3. What we want to happen

**Behavioural invariant:**

> When the customer has provided address-locality / landmark / voice information through the new capture flow, the CSP / technician must see and be able to use that information at the two surfaces where it materially affects their job — the FPN allocation overlay (so they can judge the find-the-house difficulty before tapping accept) and the install task drilldown (so they have the full info while planning the visit and en-route). Bookings that pre-date the new capture flow (so all four new fields are null) must render exactly as they do today — no empty placeholders, no "not provided" noise.

In plain English, the CSP / Rohit's view should now include:

1. **Locality** — the area/colony name the customer typed.
2. **Landmark** — the type (Temple / Mosque / School / Hospital / Bank / Petrol Pump / Other) **as an icon / pill** plus the place name. Same enum values the customer chose from.
3. **Voice direction** — when present, a playback control that lets the partner listen to the customer's audio note. Design team owns the exact UX (inline play button / dedicated row with duration / modal — design's call).

These surface in two places:

- **Install task drilldown** — Customer Details section, immediately under the existing address block.
- **FPN allocation overlay** — added to the address block the overlay already renders.

---

## 4. What the OS says

Address / landmark / voice-direction capture and presentation is not in scope for any LOCKED OS file. The CL, D&A, Quality OSes are silent on customer address-data format. **No OS change is needed.**

## 5. What the Spec / PRD says

- **`yaml-prd/es-installation-service-prd-v2.5.yaml`** — the install state machine has no concept of address/landmark; it carries an opaque `service_address` blob. No state-machine change is needed.
- **Surface Contract (CSP-OS Home / install drilldown):** existing `/home/tasks/{id}/detail.install_details` schema carries the AMENDMENT-03 address fields. The four new fields (locality input, landmark type, landmark name, voice file path + duration) need to be added to this contract — see §8.
- **Upstream PRD (Customer side):** `C:\Users\ashis\Downloads\PRD_ Address + Landmark + Voice Onboarding.pdf` — §9 explicitly states *"Also sync same schema to Wiom Partner App"* and §12 acceptance criteria includes *"Partner App receives same data."* So the cross-app sync is already an acknowledged requirement; this item is the PM-facing spec for the partner-side render.

## 6. What the Code does

For evidence — tech (CSP App team + design team) will design the implementation.

- `core/model/src/main/java/com/wiom/csp/core/model/TaskDetail.kt` — needs four new fields under the AMENDMENT-03 block. All nullable while BE backfills, same pattern as the existing fields.
- `feature/home/src/main/java/com/wiom/csp/feature/home/ui/drilldowns/install/InstallDrilldownContent.kt:233-289` — the install drilldown's §4 Location `SectionCard`; needs landmark + locality + voice rendered inside the existing card (not a new card).
- `feature/home/src/main/java/com/wiom/csp/feature/home/ui/FpnOverlay.kt` — `FpnOverlayData` (line 54-71) already has `landmark: String`; the render rows (line 280-300) need a voice slot added and the landmark wire updated to carry the new structured type + name.
- `app/src/main/java/com/wiom/csp/fpn/FpnPayload.kt:64-92` — existing `landMark()` extractor for FCM `task.extraData.landMark`; reuse-vs-extend is Open Q5.
- `feature/installation/src/main/java/com/wiom/csp/feature/installation/ui/screens/CustomerDetailsScreen.kt:162-169` — third surface that also uses `streetHomeAddress()`; outside PM's stated scope but worth consistency consideration (Open Q3).
- `streetHomeAddress()` helper — out-of-scope to extend (it deliberately stays a one-line street + home composition for the WhatsApp share text). A separate compose-helper for the landmark line is cleaner.

---

## 7. Where the gap / bug lives

| Layer | Defined? | Notes |
|---|---|---|
| OS | n/a | Address/landmark UX is not an OS-level concern. |
| Customer-side PRD | ✓ Yes | The 4 new fields, validation rules, enum values, recording rules are all defined in the upstream PRD §6–§9. |
| Customer App (UI) | ✓ Shipped | PR 1 + PR 2 on `feature/chat`. UI is live. |
| Customer backend / booking-service persistence | ⏳ Pending | Tracked by the upstream PRD's ship status. **Out of scope for this item** — the customer-side team owns it. |
| CSP App (`TaskDetail` model) | ✗ Missing 4 fields | `landmarkType`, `landmarkInput`, `voiceFilePath`, `voiceDurationSeconds` are absent. Possibly also `localityInput` (Open Q1). |
| CSP App (drilldown render) | ✗ Missing | `InstallDrilldownContent.kt:233-289` renders only `streetHomeAddress()` + "View on map". No landmark, no locality, no voice. |
| CSP App (FPN overlay render) | ⚠ Partial | `FpnOverlayData.landmark: String` already exists (line 59), fed from FCM `task.extraData.landMark` (free text) via `FpnPayload.landMark()`. New structured type+name need to flow through this slot — reuse-or-extend is Open Q5. No voice slot today. |
| Design team | ⏳ Pending | Voice-playback UX shape is design-team-owned per PM. |
| Prod | ✗ Wrong (forthcoming) | Partner doesn't see what the customer captured. |

Classification: **Gap.** Missing capability across the SC, the CSP-OS API, and the CSP App. Customer-side PRD provides the data; the partner side has no plan to render it yet.

## 8. Spec — handed to tech

### Today

- Install drilldown's §4 Location `SectionCard` (`InstallDrilldownContent.kt:233-289`) shows only the stacked `streetHomeAddress()` (street on one line, home on the next) plus a "View on map" link. No landmark, no locality, no voice.
- FPN allocation overlay (`FpnOverlay.kt`) already has a `landmark: String` field (line 59), rendered as a dedicated row above the address (line 282). Today it's fed from FCM `task.extraData.landMark` — a free-text legacy field, not the new structured type + name. No voice control.
- Even for bookings where the customer has already captured a landmark via the new flow or recorded a voice direction, the partner does not see them.

### Want

**What the CSP / technician sees:**

| Surface | When | Today | Want |
|---|---|---|---|
| **FPN allocation overlay** (`FpnOverlay`) | The moment a booking is allocated, before the partner taps accept | Address (3 lines max) + a single free-text landmark row already exists (today fed from FCM `task.extraData.landMark`). No locality. No voice. | Same overlay extended so the landmark row carries the customer-typed `landmarkInput` (with a type-driven icon ahead of it) and a new voice-direction control appears when `voiceFilePath` is non-null. Locality line above or below the address — design's call. |
| **Install drilldown** — §4 Location `SectionCard` (`InstallDrilldownContent.kt:233-289`) | Whenever the partner opens the booking detail | `streetHomeAddress()` stacked + "View on map" link. **No landmark, no locality, no voice.** | Inside the same SectionCard (no new card), add: locality line · landmark line (type icon + name) · voice-direction control (when present). All collapsed gracefully when the underlying fields are null (backfill mode). |

**Landmark display:**
- Landmark type maps to an icon. Mapping (illustrative, not pixel-binding): TempleMosque → 🕌 / mandir icon · School → 🏫 · Hospital → 🏥 · Bank → 🏦 · PetrolPump → ⛽ · Other → 📍. Final iconset is design's call.
- Composition: *"{icon} {landmarkInput}"* in one line; or *"{icon} {type label} · {landmarkInput}"* in two lines if the type label is informative. Design's call.
- Localisation: same Hindi/English toggle pattern the app already supports.

**Voice playback:**
- UX shape (inline play button / dedicated row with duration / modal player) — **design team owns**.
- Behavioural requirements that the design must satisfy:
  - Tap to play, tap again to pause; on play-end the control returns to idle.
  - Must work on slow networks — either pre-cache on drilldown open or stream gracefully (design + tech choice).
  - Must work offline at the install site — once played (or pre-cached) the audio should be available even when the partner is at a low-coverage site. Tech designs the cache lifecycle.
  - On download / playback failure, fall back to a retry CTA + skip option (per PRD §5).
  - Audio format is `.m4a` / AAC (PRD §6); ≤ 30 sec; ≤ 200 KB expected.

**Backfill rule:**

> **If `landmark_type`, `landmark_input`, `voice_file_path`, `voice_duration_seconds` are all null (or the API doesn't yet serve them — pre-rollout bookings), the CSP App renders the address exactly as it does today: structured address, city, pincode. No "Landmark: not provided" text. No empty voice tile. No new section heading. The partner's view of an old booking is byte-for-byte identical to today.**

This is critical because backend persistence is rolling out independently (per the upstream PRD's ship status), so the CSP App will see a long tail of bookings where these fields stay null even after this item ships.

### Edge cases (well-scoped)

1. **Customer captured landmark but skipped voice recording.** Voice fields are null / 0; landmark fields are populated. CSP App renders landmark; voice control is hidden. Backfill rule does **not** kick in (partial data is genuine data).
2. **Customer recorded voice but did not pick a landmark type (e.g. went "Other" with blank name).** Voice plays; landmark renders as `OTHER` icon + empty name (or just the icon if name is blank). Backfill rule does not kick in.
3. **Customer used the wrong-address recovery flow mid-install.** The address / landmark / voice can change after the booking has already been allocated to a CSP. The CSP App should pick up the updated values on the next drilldown refresh. No live-push requirement in this item (eventual consistency is acceptable).
4. **Voice file URL returns 404 / network failure.** Playback control shows a small error state with a retry icon; partner can still see all the text fields. Tech / design pick the exact error treatment.
5. **Voice file URL returns slowly on a 2G network.** Per the upstream PRD's acceptance criteria *"Voice upload works on slow networks"* — playback should either show a buffering indicator or pre-cache when the drilldown opens. Design picks the right pattern.
6. **Customer language is set to English in the customer app; the CSP / Rohit's language is Hindi (or vice-versa).** Labels follow the CSP App's existing pattern — the customer's chosen language does not leak to the CSP-side render. Landmark *name* (free text) is shown as-typed by the customer; landmark *type label* is rendered in the CSP App's locale.
7. **Voice file path is present but `voice_duration_seconds` is 0 (data inconsistency).** Treat the same as voice absent — hide the playback control. Defensive.
8. **Landmark type is a value the CSP App doesn't recognise (forward-compat — future enum value).** Fall back to the `OTHER` icon and render the landmark name as-is. Don't crash on the unknown enum value.
9. **Two technicians on the same booking** (e.g. CSP self + assigned Rohit each open the drilldown). Both see the same data. No coordination requirement.
10. **Partner attempts to share the customer details via WhatsApp** (existing share UX). The share text uses `streetHomeAddress()` today and intentionally stays that way — landmark / voice clip are **not** added to the share text in this item. Sharing audio over WhatsApp is its own scope.

### Notes for tech

- **`localityInput` vs existing `locality`** — PM-deferred: tech / customer-backend team to confirm whether the customer's typed `localityInput` (PRD §7, Required) is the *same* semantic field as the CSP-App's existing top-level `TaskDetail.locality` (today used for the home-card preview), or a *different* one (e.g. server-derived from lat/lng). If same → drop a new locality field, the existing one carries it. If different → add the customer-typed value to the address block and keep the existing top-level field for the card. **PM doesn't need to pre-decide.**
- **FPN overlay landmark + voice density** — PM-deferred to the **design team**. The spec mandates that both surfaces (FPN overlay + drilldown) carry the new fields; how densely the FPN renders them (full vs condensed) is a design call.
- **`CustomerDetailsScreen` (install wizard, third surface that also renders address)** — **strictly out of scope.** Only drilldown + FPN overlay in this item. The partner has typically already arrived at the address by the time they see CustomerDetailsScreen; consistency on landmark / voice there is not worth this item's scope. If it becomes an issue later, a separate item.
- **CleverTap instrumentation on voice playback — emit play / pause / complete events.** PM-confirmed: add a small CT event family (one event, three actions) on voice clip play / pause / completion. Lets us measure later whether the feature reduces "couldn't find the house" install delays. Lightweight; folds into the existing CT pipeline.
- **FPN landmark wire — reuse single `landmark` String vs extend the schema** — PM-deferred. Tech picks once the customer-backend team's actual FCM payload shape is visible. Spec records both options:
  - **Extend** (separate `landmarkType` + `landmarkInput` fields end-to-end) — type→icon decision stays client-side, icon catalogue evolves without server churn. More plumbing.
  - **Reuse** (server composes the display string into the existing single field) — less plumbing, but couples icon decisions to server output.

### Out of scope

- **Customer-side capture UX.** Already shipped (PR 1 + PR 2 on feature/chat).
- **Customer-backend / booking-service persistence.** Tracked by the upstream PRD's ship status ("Backend persistence + Partner sync pending"). Not duplicated here.
- **C2 nudge audio** (PRD §10 — short Hindi audio that auto-plays on the voice capture screen). That's a customer-side surface, not partner-side.
- **WhatsApp share text augmentation.** Existing share helper stays as-is; sharing audio over WhatsApp is its own scope.
- **Voice playback UX details** (inline button vs dedicated row vs modal). **Design team owns.** This item gives design the behavioural requirements (play/pause, offline, retry, slow-network); design picks the shape.
- **Pre-loaded nearby places by category at chat-flow entry** (PRD §9 last bullet). Customer-side concern.
- **Landmark normalisation / deduplication on the backend** (e.g. matching free-text *"Sai Mandir"* against a place database). Backend / future-improvement, not partner-side.
- **Wrong-address recovery flow's customer-side UI** (PRD's "Address Confirm" screen). Customer-side scope.

---

## 9. Risks / dependencies

- **Hard dependency on backend persistence rollout.** The CSP App's new fields stay null until the customer-backend persists the new schema and the CSP-OS gateway echoes them. The backfill rule (§8) is what keeps the rollout safe — without it the partner would see "not provided" on every existing booking for weeks.
- **Surface contract sign-off is the binding step.** The four new fields need to be locked into the CSP-OS task-detail SC before the CSP App and the gateway both code against it. Suggest landing the SC amendment first, then frontend + backend in parallel.
- **Voice file storage + auth.** The customer-side team will pick the storage backend (S3 + pre-signed URLs is the natural fit). The CSP App needs an auth pattern that works the same way as the existing image-asset auth (e.g. NetBox photos). Worth confirming with the customer-side team before SC freeze.
- **Audio cache lifecycle.** Tech / design need to decide how long a voice clip is cached on the device (e.g. until the booking is terminal, or for 24h after first play). Affects storage footprint on low-end devices.
- **Design-team latency.** This item lists the behavioural requirements but leaves the voice-control UX shape to design. Tech can build the data plumbing in parallel; the final compose tree depends on design's call.
- **Language toggle (Hindi / English).** The PRD §11 says strings are added in `ChatStrings.kt` (customer app). The CSP App has its own labels file pattern; mirror the type-label strings there. Free-text place names are shown verbatim.

## 10. References

- **Upstream PRD:** `C:\Users\ashis\Downloads\PRD_ Address + Landmark + Voice Onboarding.pdf` — §6 recording rules, §7 input schema, §9 data model + cross-app sync, §12 acceptance criteria.
- **Reference design (customer side):** `https://abhishekgarg-wiom.github.io/Onboarding_customer/v3/`
- **Customer-side PRs:** PR 1 + PR 2 on `feature/chat` (Customer App).
- **CSP App — exact render sites (verified against `development` branch):**
  - `core/model/src/main/java/com/wiom/csp/core/model/TaskDetail.kt:100-145` — AMENDMENT-03 model block to extend with the 4 new fields.
  - `feature/home/src/main/java/com/wiom/csp/feature/home/ui/drilldowns/install/InstallDrilldownContent.kt:233-289` — §4 Location `SectionCard`, current render site for the address.
  - `feature/home/src/main/java/com/wiom/csp/feature/home/ui/FpnOverlay.kt:54-71` — `FpnOverlayData` data class (already has `landmark: String`).
  - `feature/home/src/main/java/com/wiom/csp/feature/home/ui/FpnOverlay.kt:280-300` — landmark and address render rows.
  - `app/src/main/java/com/wiom/csp/fpn/FpnPayload.kt:64-92` — `landMark()` extractor (the existing wire from FCM `task.extraData.landMark`).
  - `feature/installation/src/main/java/com/wiom/csp/feature/installation/ui/screens/CustomerDetailsScreen.kt:162-169` — third surface (install wizard); see Open Q3 for whether to extend.
- **AMENDMENT-03 precedent:** the existing structured-address fields are the template — same pattern (all-nullable while BE backfills, surfaced on `install_details`).
- **Helper to keep in mind:** `TaskDetail.streetHomeAddress()` — stays as-is; do NOT extend it to include landmark.
- **Related project notes:** [[install-flow-reference]] for the upstream-event consumer map.

## 11. Investigation log

- **2026-05-29 — filed.** Pulled the upstream PRD from Downloads (`PRD_ Address + Landmark + Voice Onboarding.pdf`). Verified against current CSP App (`wiom-csp-app-apr09`, release-01 reference): AMENDMENT-03 already wired the structured address but the four new fields had zero matches in the tree. Classified as **Gap.** PM-confirmed four scoping decisions: (a) scope is CSP-side only; (b) surface on Install drilldown + FPN overlay; (c) voice-playback UX is design-team-owned; (d) backfill rule = hide all new sections if all 4 new fields are null.
- **2026-05-29 — re-verified against the live `development` branch.** Pulled `wiom-tech/wiom-csp-app-apr09@development` (18 commits ahead of local) and located the actual address-rendering sites: (1) **Install drilldown's §4 Location `SectionCard`** at `InstallDrilldownContent.kt:233-289` — stacked `streetHomeAddress()` + "View on map" link, no landmark/locality/voice; (2) **FPN overlay's `FpnOverlayData`** at `FpnOverlay.kt:59,282` — **already has a `landmark: String` field** (today populated from FCM `task.extraData.landMark` via `FpnPayload.landMark()`) — the new structured landmark needs to either reuse this slot (reformat upstream) or extend the schema (separate type + name); (3) `CustomerDetailsScreen.kt:162-169` — a third surface that also renders the address via `streetHomeAddress().orEmpty()` and lacks landmark/voice, but is outside PM's stated scope. Spec updated accordingly: §6 now references the exact render sites; the "today vs want" comparison includes both PM-scoped surfaces with their existing state; the `landmark` precedent on the FPN side is flagged so tech doesn't accidentally introduce a parallel field.
- **2026-05-29 — PM edits.** Removed the "Surface contract additions" section (PM: SC is tech's concern, not the PM spec). Dropped the "Home-feed task card" and "WhatsApp share text" rows from the today-vs-want table — both were no-change rows that added noise. Added Open Q3 (CustomerDetailsScreen extend-for-consistency) and Open Q5 (FPN landmark wire reuse vs extend) to surface the new findings from the dev-branch re-verification.
- **2026-05-29 — All 5 Open Questions closed.** PM answers: (Q1) `localityInput` vs `locality` — **deferred to tech / customer-backend team** to confirm same-vs-different. (Q2) FPN density — **deferred to design team**. (Q3) `CustomerDetailsScreen` consistency — **strictly out of scope**; only drilldown + FPN overlay in this item. (Q4) CleverTap on voice — **yes**, emit play / pause / complete events. (Q5) FPN landmark wire reuse-vs-extend — **deferred to tech** once FCM payload shape is visible. Open Questions block removed; resolutions absorbed into "Notes for tech" list. Item 09 spec-complete from PM's side.
