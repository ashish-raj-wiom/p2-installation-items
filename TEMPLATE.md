# NN — <Item title>

> **Type:** Gap | Bug
> **Bug sub-type** (BUG items only): Spec gap (PM owns updated spec + pre/post diff) **OR** Implementation miss (tech owns the technical solution; this item just points at the violated spec section + deviation site)
> **Service(s) to update:** csp-connection-lifecycle-service | csp-demand-allocation-service | csp-tas-service | …
> **Owner (PM):** Ashis · **Filed:** YYYY-MM-DD

---

## 1. Summary

One sentence: what's wrong / missing, who's affected, observable symptom. No jargon.

---

## 2. What's happening today

*(PM describes the observed behavior; investigator backs it with prod evidence.)*

**PM's description (plain English):**
> _e.g. "When a CSP declines an install, the same CSP is getting reassigned the same booking up to 3 times in a row."_

**Evidence — DB / Datadog:**
- Sample affected `connection_id`s and what their rows look like.
- Counts over a clean recent window (default last 5 days).
- The query / Datadog filter used (so anyone can re-run).
- Bulky outputs → `evidence/NN-<slug>/`.

---

## 3. What we want to happen

*(PM-supplied. The target behavior in plain English; investigator then maps it to OS / Spec language.)*

**PM's desired outcome:**
> _e.g. "After a CSP declines, that connection must not be re-routed back to the same CSP within P51 (4h). If only that one CSP is eligible, the connection should fail rather than loop on the same partner."_

**Mapped to OS / Spec language (if applicable):**
- Which OS rule this is enforcing / restoring / changing.
- Whether this is consistent with the existing OS or implies an OS amendment.

---

## 4. What the OS says

Quote the LOCKED OS section, line numbers included.

> *file:line* — exact text.

If the OS is silent, say so and cite the section that **should** have covered it.

## 5. What the Spec / PRD says

Quote the relevant `yaml-prd/*.yaml`, ES spec, amendment, or agent-decision doc. Same provenance discipline.

If the OS and Spec disagree, flag it here.

## 6. What the Code does

`<service>/<package>/<File>.java:<line>` — quote the relevant block. If behavior is config-driven, also cite the config file + key (e.g. `application-prod.yml:<line>`) or the AWS Parameter Store path.

For ES vs CLOS vs DAS vs TAS contradictions, show **both sides** with their refs.

---

## 7. Where the gap / bug lives

Pick one and justify:

- **OS ↔ Spec gap** — the OS and PRD disagree.
- **Spec ↔ Code gap** — the PRD says X, the code does Y.
- **Code-only bug** — the code has an internal defect (typo, regex, race, off-by-one).
- **Config / infra bug** — a flag, env var, AWS Parameter Store value, or missing infra (e.g. EventBridge schedule never registered).
- **Cross-service contract bug** — one service emits/expects X, another reads Y.
- **OS deviation in code, undocumented** — code consciously diverges from OS, no amendment/decision logs it.
- **Pure missing capability** — the behavior isn't in OS, Spec, or Code at all; PM is asking to add it.

## 8. Spec — handed to tech

This is the PM deliverable. **Human-readable behaviour spec, no code prescription.** Tech owns the technical solution.

Standard structure:

- **Today** — short description of current observable behaviour.
- **Want** — observable behaviour we want, written so a non-developer can read it. **If the item introduces new PN / CleverTap events or app-UI changes the CSP/customer sees, fold the communication timeline (T+0 / T+Nh / T+expiry) inside this section** — don't break it out as a separate "Communication timeline" section.
- **Edge cases** — numbered list of **genuine business edge cases only**. What does the CSP / customer observe in this unhappy path? Don't include technical concerns (timer fire tolerance, dispatcher race, refresh-lag, backfill, schema choice) — those are tech's domain.
- **Open questions for PM** — anywhere I made an assumption (threshold value, tie-break rule, copy text), list it here as a question with my best guess so the PM can confirm before tech receives the spec. **No silent defaults.**
- **Out of scope** — what this spec deliberately does NOT cover, so tech doesn't accidentally pull adjacent work in.

If the item is a BUG with sub-type **Implementation miss**, this section instead points at: (i) the violated spec section, (ii) the deviation site in code (as evidence), (iii) the post-fix invariant that must hold. The technical approach is tech's call.

**Minimise OS changes.** Default to ES PRD (`yaml-prd/es-installation-service-prd-v2.5.yaml` is current latest); escalate to LOCKED OS only when the change is genuinely a cross-service invariant or a new SPR-registered global parameter.

## 9. Risks / interactions

Anything that breaks adjacent behavior or requires coordinated rollout (e.g. "fixing this will start firing event X which downstream service Y currently no-ops on — fix that first / together"). Link to the other P2 item if relevant.

## 10. References

- OS: `os/<file>.md#<section>`
- Spec: `yaml-prd/<file>.yaml`
- Code: `services/<service>/<path>:<line>`
- Commit / PR: `<sha>` / `#PR`
- Memory: `[[memory-name]]`
- Prior project notes: `<folder>/<file>`

## 11. Investigation log

Datestamped notes as the item is worked. Useful when a question reopens an item.
