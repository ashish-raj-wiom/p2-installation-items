// Splits the 6 bug sections in installation-p2-bugs.html into 6 standalone
// HTML files (bug-01.html .. bug-06.html), each with a sidebar listing
// the other bugs + the 4 gap specs.
//
// Then rewrites installation-p2-bugs.html into a thin index page that
// links to all 6 bug HTMLs + 4 gap HTMLs.
//
// Run: node generate-bug-pages.js

const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;

// ----------------------------------------------------------------------------
// Manifest
// ----------------------------------------------------------------------------
const BUGS = [
  {
    id: 'bug-01',
    num: 'BUG-01',
    short: 'CLOS scheduler unwired',
    title: 'CLOS timeout scheduler unwired (P75 / P76 / P77 inert)',
    lede: 'CL OS defines four system-driven timeouts that must fire on background sweeps. The batch methods, endpoints, and scheduler hooks all exist in code — but the AWS EventBridge scheduler is disabled in prod (<code>AWS_SCHEDULER_ENABLED: false</code>) and nothing calls <code>scheduleRecurring(...)</code>. Zero system-driven CL transitions in 90 days. <strong>P74 is out of scope for this item</strong> — its start-time anchor is a separate PM decision.',
    sections: [
      { id: 'spec', label: 'Original spec' },
      { id: 'cases', label: 'Test cases' },
      { id: 'workflow', label: 'Workflow per parameter' },
      { id: 'wired', label: "What's wired / what's not" },
      { id: 'tas-cofix', label: 'TAS co-fix (T12)' },
      { id: 'evidence', label: 'Code evidence' },
    ],
    hasMermaid: true,
  },
  {
    id: 'bug-02',
    num: 'BUG-02',
    short: 'DAS scheduler unwired',
    title: 'DAS scheduler unwired (P191 held-allocation reroute inert)',
    lede: 'Same scheduler-wiring failure as <a href="./bug-01.html">BUG-01</a>, this time on DAS. P191\'s held-allocation reroute sweep is supposed to retry <code>UNASSIGNED</code> allocations periodically; instead 230 rows sit untouched. <strong>P41 (acceptance window) is out of scope for this item</strong> — its start-time anchor is a separate PM decision.',
    sections: [
      { id: 'spec', label: 'Original spec' },
      { id: 'cases', label: 'Test cases' },
      { id: 'workflow', label: 'Workflow — P191 reroute' },
      { id: 'wired', label: "What's wired / what's not" },
      { id: 'evidence', label: 'Code evidence' },
    ],
    hasMermaid: true,
  },
  {
    id: 'bug-03',
    num: 'BUG-03',
    short: 'DAS never reaches ACCEPTED',
    title: 'DAS allocation state never reaches <code>ACCEPTED</code> (DAS-internal atomic write required)',
    lede: 'AMENDMENT-02 (Apr 2026) deleted the explicit CSP-accept call and declared acceptance "automatic on assignment". DAS has the receiver fully wired (<code>POST /api/demand-allocation/csps/{cspId}/accept</code> + <code>AllocationServiceImpl.acceptAllocation(...)</code>); no service calls it. Result in prod: <strong>0 rows ever in <code>ACCEPTED</code>; 504 / 504 stuck at <code>ASSIGNED</code> / <code>UNASSIGNED</code>; <code>acceptance_timestamp</code> NULL on every row.</strong>',
    sections: [
      { id: 'direction', label: 'Direction (atomic write)' },
      { id: 'spec', label: 'Original spec' },
      { id: 'cases', label: 'Test cases' },
      { id: 'flow', label: 'Expected flow' },
      { id: 'evidence', label: 'Code evidence' },
    ],
    hasMermaid: true,
  },
  {
    id: 'bug-04',
    num: 'BUG-04',
    short: 'Capacity OS skips T2',
    title: 'Capacity OS skips connection-count increment after installation',
    lede: 'The OS prescribes "<strong>Capacity OS counts +1 on T2</strong>" in four explicit places. The code guards the increment with <code>if ("RESUME".equals(activationSource))</code> — so the normal happy-path <code>INITIAL</code> installs silently fall into an empty <code>else</code> branch and the counter doesn\'t move. <strong>Not CSP-app-visible</strong> — partner app reads CL directly. Affects internal routing decisions (load-ratio + zone-retire guard) only.',
    sections: [
      { id: 'spec', label: 'Original spec' },
      { id: 'cases', label: 'Test cases' },
      { id: 'backfill', label: 'Backfill' },
      { id: 'evidence', label: 'Code evidence' },
    ],
  },
  {
    id: 'bug-05',
    num: 'BUG-05',
    short: 'Quality signal contract drift',
    title: '<code>CL_INSTALLATION_QUALITY_SIGNAL</code> — producer-record contract drifted from CL OS §S-10',
    lede: 'CL emits the signal on every T2; <strong>Quality OS rejects every single one</strong> with HTTP 400 <code>VALIDATION_FAILED</code>. 53 emissions, 0 delivered, 100 % failure rate. Root cause: payload-contract drift in the CL producer record. Three required fields don\'t match the CL OS S-10 + base-schema contract.',
    sections: [
      { id: 'spec', label: 'Original spec' },
      { id: 'cases', label: 'Test cases' },
      { id: 'error', label: 'Verbatim prod error' },
      { id: 'evidence', label: 'Code evidence' },
    ],
  },
  {
    id: 'bug-06',
    num: 'BUG-06',
    short: 'CAEO customer_id wrong',
    title: 'CAEO <code>customer_id</code> column populated with CSP-ID for installation task',
    lede: '<code>CL_CONNECTION_ACTIVATED</code> doesn\'t carry <code>customer_id</code> in its payload, so the CAEO consumer plugs <code>cspId</code> in as a placeholder. Want: <code>customer_id</code> gets populated in the CL event so that CAEO\'s <code>customer_id</code> column carries the actual customer.',
    sections: [
      { id: 'spec', label: 'Original spec + fix' },
      { id: 'cases', label: 'Test cases' },
      { id: 'source', label: 'Source of truth' },
      { id: 'evidence', label: 'Code evidence' },
    ],
  },
];

const GAPS = [
  { id: 'gap-01', num: 'GAP-01', short: 'Cancel bifurcation' },
  { id: 'gap-02', num: 'GAP-02', short: 'Change team member (install)' },
  { id: 'gap-03', num: 'GAP-03', short: 'Failure sub-reason (OS-aligned)' },
  { id: 'gap-04', num: 'GAP-04', short: 'DAS single-CSP zone events' },
];

// ----------------------------------------------------------------------------
// Shared CSS — same palette as installation-p2-bugs.html
// ----------------------------------------------------------------------------
const CSS = `
  :root {
    --bg: #fafaf9; --surface: #ffffff;
    --ink: #1a1a1a; --muted: #6b6b6b; --rule: #e5e5e2;
    --bug: #b91c1c; --bug-bg: #fee2e2;
    --gap: #b45309; --gap-bg: #fef3c7;
    --ok:  #0b6b3a; --ok-bg:  #e9f5ee;
    --what: #1f3c6e; --what-bg: #e8eef8;
    --how:  #5b2a86; --how-bg:  #efe6f7;
    --hint-bg: #ecfeff; --hint-rule: #0e7490; --hint-ink: #155e75;
    --code-bg: #f6f8fa;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 14.5px; line-height: 1.55; color: var(--ink); background: var(--bg);
  }
  .layout { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
  nav.toc {
    position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto;
    padding: 22px 18px; border-right: 1px solid var(--rule); background: var(--surface); font-size: 13px;
  }
  nav.toc h2 {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted);
    margin: 18px 0 6px;
  }
  nav.toc h2:first-of-type { margin-top: 0; }
  nav.toc h2.this  { color: var(--bug); border-left: 3px solid var(--bug); padding-left: 8px; }
  nav.toc h2.other { color: var(--muted); border-left: 3px solid var(--muted); padding-left: 8px; }
  nav.toc h2.gap   { color: var(--gap); border-left: 3px solid var(--gap); padding-left: 8px; }
  nav.toc ol { list-style: none; padding: 0; margin: 0; }
  nav.toc li { margin: 4px 0; }
  nav.toc li a {
    text-decoration: none; color: var(--ink); display: flex; gap: 8px; align-items: baseline;
    padding: 4px 6px; border-radius: 4px; font-size: 12.5px;
  }
  nav.toc li a:hover { background: var(--bg); }
  nav.toc li a .ix { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 56px; font-weight: 600; }
  nav.toc li.current a { background: var(--bug-bg); color: var(--bug); font-weight: 600; }
  nav.toc .back { display: block; margin-top: 24px; padding: 8px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--rule); padding-top: 14px; text-decoration: none; }
  nav.toc .back:hover { color: var(--ink); }

  main { padding: 32px 56px 120px; max-width: 1040px; }
  header.doc { border-bottom: 2px solid var(--ink); padding-bottom: 20px; margin-bottom: 28px; }
  header.doc .eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
  header.doc h1 { font-size: 26px; margin: 6px 0 10px; line-height: 1.25; }
  header.doc p.lede { color: var(--muted); font-size: 14.5px; margin: 0; max-width: 75ch; }
  header.doc .meta-row { display: flex; gap: 24px; margin-top: 12px; font-size: 13px; color: var(--muted); flex-wrap: wrap; }

  h2 { font-size: 20px; margin: 36px 0 12px; scroll-margin-top: 24px; }
  h3 { font-size: 16px; margin: 22px 0 8px; }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.86em;
    background: var(--code-bg); padding: 0.08em 0.32em; border-radius: 3px; border: 1px solid var(--rule);
  }
  pre {
    background: var(--code-bg); padding: 0.75rem 0.9rem; border-radius: 6px; border: 1px solid var(--rule);
    overflow-x: auto; line-height: 1.4; font-size: 12.5px;
  }
  pre code { background: none; border: none; padding: 0; }

  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 13px; }
  th, td { border: 1px solid var(--rule); padding: 0.5rem 0.7rem; text-align: left; vertical-align: top; }
  th { background: var(--bg); font-weight: 600; }

  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  }
  .pill.bug { background: var(--bug-bg); color: var(--bug); }
  .pill.gap { background: var(--gap-bg); color: var(--gap); }
  .pill.ok  { background: var(--ok-bg);  color: var(--ok);  }

  .spec-ref {
    background: var(--what-bg); border-left: 4px solid var(--what); padding: 10px 14px;
    border-radius: 0 4px 4px 0; margin: 10px 0 16px; font-size: 13px;
  }
  .spec-ref strong { color: var(--what); margin-right: 6px; }
  .spec-ref code { background: rgba(255,255,255,0.7); }

  .tc-table th:nth-child(1) { width: 32%; }
  .tc-table th:nth-child(2) { width: 32%; }
  .tc-table th:nth-child(3) { width: 36%; }
  .tc-table td.expected { background: var(--ok-bg); }
  .tc-table td.observed { background: var(--bug-bg); }
  .tc-table tr.tc-verify td {
    background: #fef9c3; font-size: 12.5px; border-top: none;
    padding: 8px 14px 10px; color: #1a1a1a; line-height: 1.5;
  }
  .tc-table tr.tc-verify td strong.v-label { color: #92400e; }
  .tc-table tr.tc-verify td code { background: rgba(255,255,255,0.7); }
  .tc-table tr.tc-verify td ul { margin: 4px 0 0 0; padding-left: 18px; }
  .tc-table tr.tc-verify td li { margin: 3px 0; }

  .mermaid {
    background: var(--bg); border: 1px solid var(--rule); border-radius: 6px;
    padding: 16px; margin: 12px 0; text-align: center;
  }

  .hint {
    background: var(--hint-bg); border-left: 3px solid var(--hint-rule); padding: 10px 14px;
    font-size: 13px; color: var(--hint-ink); margin: 10px 0 14px; border-radius: 0 4px 4px 0;
  }

  details { margin: 12px 0; }
  details summary {
    cursor: pointer; padding: 6px 10px; background: var(--bg); border: 1px solid var(--rule);
    border-radius: 4px; font-size: 12.5px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.04em; list-style: none;
  }
  details summary::before { content: "▸ "; }
  details[open] summary::before { content: "▾ "; }
  details > div { padding: 10px 14px; border: 1px solid var(--rule); border-top: none; border-radius: 0 0 4px 4px; }

  .muted { color: var(--muted); }

  /* Index page card grid */
  .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; margin: 14px 0 28px; }
  .card { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; transition: border-color 0.15s; }
  .card:hover { border-color: var(--ink); }
  .card .id { font-family: ui-monospace, monospace; font-weight: 700; font-size: 12px; color: var(--muted); }
  .card h3 { margin: 0; font-size: 16px; line-height: 1.3; }
  .card p { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.5; }
  .card a.open { margin-top: 6px; font-size: 12.5px; font-weight: 600; text-decoration: none; align-self: flex-start; }
  .card.bug a.open { color: var(--bug); }
  .card.gap a.open { color: var(--gap); }
  .card a.open:hover { text-decoration: underline; }

  @media print {
    .layout { grid-template-columns: 1fr; }
    nav.toc { display: none; }
    main { padding: 0 1cm; max-width: none; }
    section { page-break-inside: avoid; }
  }
  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    nav.toc { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--rule); }
    main { padding: 24px; }
  }
`;

// ----------------------------------------------------------------------------
// Sidebar nav — builds for a given bug page
// ----------------------------------------------------------------------------
function navHtml(currentBugId, sections) {
  const sectionList = sections.map(
    (s) => `    <li><a href="#${s.id}">${s.label}</a></li>`
  ).join('\n');

  const otherBugs = BUGS.filter(b => b.id !== currentBugId).map(b =>
    `    <li><a href="./${b.id}.html"><span class="ix">${b.num}</span>${b.short}</a></li>`
  ).join('\n');

  const gapList = GAPS.map(g =>
    `    <li><a href="./${g.id}.html"><span class="ix">${g.num}</span>${g.short}</a></li>`
  ).join('\n');

  return `<nav class="toc">
  <h2 class="this">On this page</h2>
  <ol>
${sectionList}
  </ol>
  <h2 class="other">Other bugs</h2>
  <ol>
${otherBugs}
  </ol>
  <h2 class="gap">Related gap specs</h2>
  <ol>
${gapList}
  </ol>
  <a class="back" href="./installation-p2-bugs.html">← Bugs &amp; gaps index</a>
</nav>`;
}

// ----------------------------------------------------------------------------
// Per-bug body content (the inner H2 sections only — header is built separately)
// ----------------------------------------------------------------------------
const BUG_BODY = {

  // ---------------- BUG-01 ----------------
  'bug-01': `
<h2 id="spec">Original spec</h2>
<div class="spec-ref">
  <strong>Source:</strong>
  <code>os/Connection_Lifecycle_OS_v1_7_1_LOCKED.md</code> &middot;
  <strong>§5 State Machine</strong> (transitions T9, T12 + timeout edges) &middot;
  <strong>SPR params:</strong> P75 (7d REQUESTED expiry), P76 (90d PAUSE limit), P77 (45d PENDING_DEACTIVATION).
  <br>
  <strong>PRD:</strong> <code>yaml-prd/connection-lifecycle-prd-v1.6.yaml</code> — state machine + system-source transitions all defined.
</div>

<h2 id="cases">Test cases — expected vs observed</h2>
<table class="tc-table">
  <thead><tr><th>Acceptance criterion</th><th>Expected per spec</th><th>Observed in prod</th></tr></thead>
  <tbody>
    <tr>
      <td><strong>TC-1.</strong> When a connection sits in <code>REQUESTED</code> for &gt; P75 (7d), then the P75 sweep transitions it to <code>DEACTIVATED</code> via T9.</td>
      <td class="expected">CL emits <code>CL_STATE_CHANGED</code> with <code>transition_type = T9</code>, source = SYSTEM, <code>new_state = DEACTIVATED</code>.</td>
      <td class="observed">No T9 transitions emitted in 90d. Stale <code>REQUESTED</code> rows accumulate indefinitely.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>DB</strong> — <code>csp_connection_lifecycle_service.connection_state_transition_log</code> WHERE <code>transition_type = 'T9'</code> AND <code>source = 'SYSTEM'</code> AND <code>created_at &gt; &lt;deploy timestamp&gt;</code> → expect rows for stale REQUESTED candidates</li>
        <li><strong>DB</strong> — <code>connections</code> WHERE <code>current_state = 'REQUESTED'</code> AND <code>created_at &lt; now() - interval '7 days'</code> → expect 0 rows after the sweep runs</li>
        <li><strong>Outbox</strong> — <code>outbox_record</code> WHERE record_type ends in <code>ClConnectionDeactivated</code> AND status = 'DELIVERED' → row per deactivated candidate</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-2.</strong> When a connection sits in <code>PAUSED</code> for &gt; P76 (90d), then the P76 sweep transitions it to <code>PENDING_DEACTIVATION</code> via <code>PAUSE_DURATION_EXCEEDED</code>.</td>
      <td class="expected">CL emits <code>CL_DEACTIVATION_INITIATED</code>; downstream Exit OS / RECHARGE_VALIDATOR receive the signal.</td>
      <td class="observed">No such transitions. 11k+ <code>PAUSED</code> rows past 90d sit untouched.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>DB</strong> — <code>connection_state_transition_log</code> WHERE <code>transition_type = 'T7'</code> AND <code>reason = 'PAUSE_DURATION_EXCEEDED'</code> AND <code>created_at &gt; &lt;deploy timestamp&gt;</code> → expect rows present</li>
        <li><strong>DB</strong> — <code>connections</code> WHERE <code>current_state = 'PAUSED'</code> AND <code>p76_timer_start &lt; now() - interval '90 days'</code> → expect count drops as sweeps run</li>
        <li><strong>Outbox</strong> — <code>outbox_record</code> WHERE record_type ends in <code>ClDeactivationInitiated</code> AND status = 'DELIVERED' → row per row transitioned</li>
        <li><strong>Custody OS</strong> — corresponding device records transition <code>DEPLOYED → CUSTOMER_RECOVERY_PENDING</code> (proves the fanout reached downstream)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-3.</strong> When a connection sits in <code>PENDING_DEACTIVATION</code> for &gt; P77 (45d), then the P77 sweep transitions it to <code>DEACTIVATED</code> via <code>DEACTIVATION_COMPLETE</code>.</td>
      <td class="expected">CL emits <code>CL_STATE_CHANGED</code> with <code>new_state = DEACTIVATED</code>, source = SYSTEM.</td>
      <td class="observed">No such transitions. Stale <code>PENDING_DEACTIVATION</code> rows accumulate.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>DB</strong> — <code>connection_state_transition_log</code> WHERE <code>transition_type = 'T8'</code> AND <code>reason = 'DEACTIVATION_COMPLETE'</code> AND <code>created_at &gt; &lt;deploy timestamp&gt;</code> → expect rows present</li>
        <li><strong>DB</strong> — <code>connections</code> WHERE <code>current_state = 'PENDING_DEACTIVATION'</code> AND <code>state_timestamp &lt; now() - interval '45 days'</code> → expect count drops as sweeps run</li>
        <li><strong>Outbox</strong> — <code>outbox_record</code> WHERE record_type ends in <code>ClConnectionDeactivated</code> AND status = 'DELIVERED' → row per finalised candidate</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-4.</strong> When the sweep cadence runs (15-minute granularity is acceptable; finer is fine), then sweep methods are invoked from a recurring schedule.</td>
      <td class="expected"><code>EventBridgeTaskScheduler.scheduleRecurring(...)</code> is called at service-startup with the four sweep batches registered. <code>AWS_SCHEDULER_ENABLED: true</code> in <code>application-prod.yml</code>.</td>
      <td class="observed"><code>AWS_SCHEDULER_ENABLED: false</code> at <code>application-prod.yml:18</code>. <code>scheduleRecurring(...)</code> never called. Sweep methods reachable only via internal endpoints, which nothing calls.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Config</strong> — <code>application-prod.yml</code> + <code>application-qa.yml</code> → <code>AWS_SCHEDULER_ENABLED: true</code></li>
        <li><strong>Startup logs</strong> — CL service boot logs include <code>scheduleRecurring(...)</code> entries for the 5 sweep batches (P75 / P76 / P77 / install timeout / retry exhaustion)</li>
        <li><strong>AWS Console</strong> — EventBridge schedule group exists; 5 schedules visible and enabled</li>
        <li><strong>Interim path</strong> — until AWS infra ships, <code>curl POST</code> to <code>InternalTaskController</code> endpoints from an external cron (Lambda / GitHub Actions / k8s CronJob); HTTP 200 confirms sweep ran</li>
      </ul>
    </td></tr>
  </tbody>
</table>

<h2 id="workflow">Workflow — state flow per parameter</h2>
<p>The three sweeps each drive a single CL state-machine transition. The diagram below is the full CL state machine; the three transitions BUG-01 wires up are labelled <code>P75 / T9</code>, <code>P76 / T7</code>, <code>P77 / T8</code>.</p>
<div class="mermaid">
stateDiagram-v2
    [*] --> REQUESTED: CONNECTION_REQUEST
    REQUESTED --> PENDING_INSTALL: ALLOCATION_ACCEPTED (T1)
    REQUESTED --> DEACTIVATED: P75 sweep 7d (T9)
    PENDING_INSTALL --> ACTIVE: install complete (T2)
    PENDING_INSTALL --> REQUESTED: install failed retry (T3)
    PENDING_INSTALL --> PENDING_DEACTIVATION: P78 retry exhausted (T12)
    ACTIVE --> PAUSED: recharge expired (T4)
    PAUSED --> ACTIVE: recharge confirmed
    PAUSED --> PENDING_DEACTIVATION: P76 sweep 90d (T7)
    ACTIVE --> PENDING_DEACTIVATION: user cancel / exit (T5/T6)
    PENDING_DEACTIVATION --> DEACTIVATED: P77 sweep 45d (T8)
    DEACTIVATED --> [*]
</div>

<h3>P75 — <code>REQUESTED → DEACTIVATED</code> (T9, 7d)</h3>
<p>Connection sits in REQUESTED for 7+ days without an <code>ALLOCATION_ACCEPTED</code> arriving (DAS couldn't route, or downstream wiring broke). Sweep fires T9 → emits <code>CL_CONNECTION_DEACTIVATED</code> with <code>reason = REQUEST_EXPIRED</code> (terminal, no PENDING_DEACTIVATION middle step).</p>
<p><strong>Downstream:</strong> D&amp;A OS releases pending allocation holds and resets retry counters for this <code>connection_id</code>; customer must submit a fresh request (FM-CLO-01 — new <code>connection_id</code>, no retry-counter bleed). No router recovery (no device was bound). No compensation reversal (no CSP was paid).</p>

<h3>P76 — <code>PAUSED → PENDING_DEACTIVATION</code> (T7, 90d)</h3>
<p>Connection sits in PAUSED for 90+ days (no recharge restored ACTIVE). Sweep fires T7 → emits <code>CL_DEACTIVATION_INITIATED</code> with <code>reason = PAUSE_DURATION_EXCEEDED</code>. This is the heavy fanout:</p>
<ul>
  <li><strong>Asset Custody OS</strong>: device <code>DEPLOYED → CUSTOMER_RECOVERY_PENDING</code> (T_REC_1, ACO L189). Triggers PUT flow / R15 / R17 framework; Support creates router-recovery task; security-deposit refund pipeline arms.</li>
  <li><strong>D&amp;A OS</strong>: allocation released for this <code>connection_id</code>.</li>
  <li><strong>Capacity OS</strong>: <code>active_connection_count -= 1</code> in the zone.</li>
  <li><strong>Compensation OS</strong>: per-event entitlement ledger closure.</li>
</ul>
<p>The 45-day P77 timer now starts on this <code>PENDING_DEACTIVATION</code> row — finalisation requires the third sweep.</p>

<h3>P77 — <code>PENDING_DEACTIVATION → DEACTIVATED</code> (T8, 45d)</h3>
<p>Catches <strong>all</strong> paths into <code>PENDING_DEACTIVATION</code>, not just P76. Entries also include T5 (user cancellation), T6 (Exit OS / Enforcement OS), T11 (system kill from REQUESTED / PENDING_INSTALL) and T12 (P78 retry exhaustion). Per <strong>TRD-CLO-05 (v1.3)</strong>: P77 timeout is the SOLE completion trigger — even if Custody and Compensation finish in 5 days, CL waits 45 days. Sweep fires T8 → emits <code>CL_CONNECTION_DEACTIVATED</code> with <code>reason = DEACTIVATION_COMPLETE</code>. All OSes archive. <strong>INV-CLO-05</strong>: terminal, immutable, <code>connection_id</code> never reused.</p>
<p><em>Implication: P77 isn't a niche cron. It's the finaliser for every deactivation that goes through <code>PENDING_DEACTIVATION</code>, which is most of them. Without it, every deactivation hangs indefinitely.</em></p>

<h2 id="wired">What's wired, what's not (8 layers)</h2>
<p>Audited against <code>services/csp-connection-lifecycle-service</code> source. Layers 1–6 are in place and reachable; the bug sits in layers 7–8.</p>
<table>
  <thead><tr><th style="width:6%">#</th><th style="width:13%">Status</th><th style="width:24%">Layer</th><th>Where it is (or isn't)</th></tr></thead>
  <tbody>
    <tr><td>1</td><td><span class="pill ok">Wired</span></td><td>State machine (T7, T8, T9 transitions)</td><td><code>domain/service/ConnectionStateMachine.java</code>, <code>ConnectionGuards.java</code></td></tr>
    <tr><td>2</td><td><span class="pill ok">Wired</span></td><td>Sweep batch methods</td><td><code>application/impl/SchedulingServiceImpl.java</code>: <code>processRequestExpiryBatch</code> (P75, L30), <code>processPauseExpiryBatch</code> (P76, L72), <code>processDeactivationTimeoutBatch</code> (P77, L94). Each queries <code>findByStateOlderThan(state, cutoff)</code> + invokes the right handler.</td></tr>
    <tr><td>3</td><td><span class="pill ok">Wired</span></td><td>Internal HTTP wrappers</td><td><code>api/InternalTaskController.java</code>: <code>POST /process-request-expiry</code> · <code>/process-pause-expiry</code> · <code>/process-deactivation-timeout</code>. <strong><code>curl</code> against these works today.</strong></td></tr>
    <tr><td>4</td><td><span class="pill ok">Wired</span></td><td>Transition handlers</td><td><code>InboundEventProcessingServiceImpl.handleRequestExpired</code> / <code>handlePauseDurationExceeded</code> / <code>handleDeactivationComplete</code> — write state, write transition log, emit outbound event.</td></tr>
    <tr><td>5</td><td><span class="pill ok">Wired</span></td><td>Outbound event emission</td><td>Producer records for <code>CL_DEACTIVATION_INITIATED</code> and <code>CL_CONNECTION_DEACTIVATED</code> + outbox dispatch — identical path to any manually-driven CL transition today.</td></tr>
    <tr><td>6</td><td><span class="pill ok">Wired</span></td><td>Downstream consumers</td><td>Custody OS: <code>handleClDeactivationInitiated</code> (<code>InboundEventController.java:19</code>, processor <code>InboundEventProcessingServiceImpl.java:40-87</code> does the <code>DEPLOYED → CUSTOMER_RECOVERY_PENDING</code> write). D&amp;A OS: <code>InboundEventController.java:168, 207</code>. Capacity OS: <code>InboundEventController.java:270</code>. <strong>All three sit idle waiting for events that never come.</strong></td></tr>
    <tr><td>7</td><td><span class="pill bug">Missing</span></td><td>Service-side scheduler wiring</td><td><code>EventBridgeTaskScheduler.scheduleRecurring(...)</code> exists as a class but is <strong>never called</strong>. Grep across the whole service returns ONE match — the method definition itself. No <code>@PostConstruct</code> / <code>CommandLineRunner</code> / <code>ApplicationRunner</code> in <code>ConnectionLifecycleApplication.java</code> registers the five sweep batches. The scheduler abstraction also defensively short-circuits when the flag is off (<code>EventBridgeTaskScheduler.java:65</code> — <code>log.info("Scheduler disabled, skipping scheduleRecurring: {}"); return;</code>).</td></tr>
    <tr><td>8</td><td><span class="pill bug">Missing</span></td><td>Environment + AWS infrastructure</td><td><code>AWS_SCHEDULER_ENABLED: false</code> in <code>application-prod.yml:18</code> and <code>application-qa.yml:21</code>. <code>application.yml:175-184</code> reads <code>schedule-group</code>, <code>role-arn</code>, <code>api-destination-arn</code> from env vars that default to placeholders (<code>arn:aws:iam::000000000000:role/connection-lifecycle-scheduler-role</code>). No IaC (CDK / Terraform) in this repo provisions those AWS resources. <strong>This is the "no proper workflow exists" gap tech raised — shared by every microservice that needs crons.</strong></td></tr>
  </tbody>
</table>

<div class="hint">
  <strong>Interim path that ships value before AWS infra lands:</strong> the <code>InternalTaskController</code> POST endpoints already work (layer 3). An external Lambda / GitHub Actions cron / k8s CronJob can <code>curl</code> the four endpoints every 15 min and drive the full downstream chain (Custody router recovery, Capacity reclaim, D&amp;A allocation release) without waiting for the AWS EventBridge workflow to be built. Same business outcome, different transport. Worth proposing to tech as a stop-gap.
</div>

<h2 id="tas-cofix">TAS co-fix — handle the <code>T12</code> retry-exhaustion transition</h2>
<p>When CL emits <code>CL_STATE_CHANGED</code> with <code>transitionType=T12</code> (the retry-exhaustion transition, <code>PENDING_INSTALL → PENDING_DEACTIVATION</code>), TAS today doesn't handle it. The <code>UPSTREAM_RETRY_TRIGGERS</code> set in <code>ClStateChangedHandler.java</code> only contains <code>T11</code>; <code>T12</code> is missing. Without this co-fix, retried-and-exhausted connections orphan TAS install candidates. Independent of the scheduler wiring above, but engineering should ship them together so the orphan symptom doesn't surface when the sweeps start firing.</p>
<table class="tc-table">
  <thead><tr><th>Acceptance criterion</th><th>Expected per spec</th><th>Observed in prod</th></tr></thead>
  <tbody>
    <tr>
      <td><strong>TC-5.</strong> When CL emits <code>T12</code>, then TAS closes any open install candidate for that connection.</td>
      <td class="expected">TAS marks candidate <code>CANCELLED_BY_UPSTREAM</code> reason <code>RETRY_EXHAUSTED</code>.</td>
      <td class="observed">Handler logs "no action required"; candidate stays OPEN. Tech must add T12 to the trigger set.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Code</strong> — <code>csp-tas-service/.../ClStateChangedHandler.java</code> → <code>UPSTREAM_RETRY_TRIGGERS</code> set contains both <code>T11</code> and <code>T12</code></li>
        <li><strong>TAS DB</strong> — <code>csp_tas_service.install_execution_candidates</code> for connections that hit P78 retry exhaustion → <code>current_state = 'CANCELLED_BY_UPSTREAM'</code>, reason = <code>'RETRY_EXHAUSTED'</code></li>
        <li><strong>TAS DB</strong> — <code>install_state_transition_log</code> → transition row with <code>trigger_source = 'CL_STATE_CHANGED'</code> and <code>transition_type = 'T12'</code></li>
      </ul>
    </td></tr>
  </tbody>
</table>

<h2 id="evidence">Code evidence</h2>
<ul>
  <li><strong>Scheduler config:</strong> <code>services/csp-connection-lifecycle-service/.../application-prod.yml:18</code> (<code>AWS_SCHEDULER_ENABLED: false</code>).</li>
  <li><strong>Scheduler hook (unwired):</strong> <code>EventBridgeTaskScheduler.scheduleRecurring(...)</code> — defined, never called.</li>
  <li><strong>Sweep batches (correct, reachable):</strong> <code>SchedulingServiceImpl</code> (the four batch methods) &middot; <code>InternalTaskController</code> (their endpoints).</li>
  <li><strong>TAS T12 co-fix site:</strong> <code>services/csp-tas-service/.../ClStateChangedHandler.java</code> — <code>UPSTREAM_RETRY_TRIGGERS</code> set.</li>
</ul>
`,

  // ---------------- BUG-02 ----------------
  'bug-02': `
<h2 id="spec">Original spec</h2>
<div class="spec-ref">
  <strong>Source:</strong>
  <code>os/Demand_Allocation_OS_v1_9_1_LOCKED.md</code> &middot;
  <strong>P191</strong> (held-allocation reroute cadence — <code>UNASSIGNED</code> allocations past P50 retry-exhaustion get re-attempted on this schedule).
  <br>
  <strong>PRD:</strong> <code>yaml-prd/demand-allocation-prd-v1.2.yaml</code> — state machine includes held-state reroute; <code>trigger_source = SYSTEM</code>.
</div>

<h2 id="cases">Test cases — expected vs observed</h2>
<table class="tc-table">
  <thead><tr><th>Acceptance criterion</th><th>Expected per spec</th><th>Observed in prod</th></tr></thead>
  <tbody>
    <tr>
      <td><strong>TC-1.</strong> When an allocation exhausts P50 routing retries (5 attempts), then it lands in <code>UNASSIGNED</code> held state.</td>
      <td class="expected">DAS writes <code>UNASSIGNED</code> + <code>p50_exhausted_at = now()</code>.</td>
      <td class="observed">This step works correctly in code — allocations do land in <code>UNASSIGNED</code>.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify (baseline still holds after fix):</strong>
      <ul>
        <li><strong>DB</strong> — <code>csp_demand_allocation_service.connection_allocations</code> WHERE <code>retry_count &gt;= 5</code> → expect <code>state = 'UNASSIGNED'</code> and <code>p50_exhausted_at IS NOT NULL</code> (existing behaviour preserved)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-2.</strong> When the P191 sweep cadence fires, then it re-enters routing for all <code>UNASSIGNED</code> rows past their held-state max.</td>
      <td class="expected">Held rows re-attempt routing. If a previously-cooled-down CSP becomes eligible, they're re-assigned. Otherwise extend held-state.</td>
      <td class="observed">Sweep never fires. 230 <code>UNASSIGNED</code> rows in prod, oldest &gt; 24h, never re-routed.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>DB</strong> — <code>connection_allocations</code> WHERE <code>state = 'UNASSIGNED'</code> AND <code>retry_count &lt; 5</code> → count drops as sweeps run (some get re-routed and move to <code>ASSIGNED</code> → <code>ACCEPTED</code>)</li>
        <li><strong>DAS service logs</strong> — grep for <code>"Held allocation sweep: re-routing connectionId="</code> → expect entries on each sweep run</li>
        <li><strong>Outbox</strong> — when re-routing succeeds, <code>outbox_record</code> contains <code>ALLOCATION_ACCEPTED</code> events, status = 'DELIVERED'</li>
        <li><strong>Cross-service</strong> — CL side: <code>connections</code> with these <code>connection_id</code>s transition <code>REQUESTED → PENDING_INSTALL</code> (CL T1 fires)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-3.</strong> When a P191 sweep finds no eligible CSPs after re-attempt, then routing-failure is recorded.</td>
      <td class="expected">DAS writes <code>routing_failure_count++</code> on the allocation row. After sustained failure, allocation eventually transitions to expired.</td>
      <td class="observed">Counter never advances; rows sit indefinitely.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>DB</strong> — <code>connection_allocations.routing_failure_count</code> increments per failed re-route attempt</li>
        <li><strong>DB</strong> — once a row reaches the failure threshold, expect terminal transition (existing rule preserved post-sweep wiring)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-4.</strong> When the scheduler config is set correctly at service startup, then <code>scheduleRecurring(...)</code> registers the P191 batch.</td>
      <td class="expected"><code>AWS_SCHEDULER_ENABLED: true</code> in DAS <code>application-prod.yml</code>; <code>scheduleRecurring</code> called with the P191 batch (and the other 5 DAS sweep batches, which are out of scope for PM but co-wired by tech).</td>
      <td class="observed"><code>AWS_SCHEDULER_ENABLED: false</code> in DAS <code>application-prod.yml</code>. Same root cause as <a href="./bug-01.html">BUG-01</a>.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Config</strong> — DAS <code>application-prod.yml</code> + <code>application-qa.yml</code> → <code>AWS_SCHEDULER_ENABLED: true</code></li>
        <li><strong>Startup logs</strong> — DAS service boot logs show the 6 sweep batches registered (P191 + 5 siblings)</li>
        <li><strong>AWS Console</strong> — EventBridge schedule group provisioned for DAS; 6 schedules visible and enabled</li>
        <li><strong>Interim path</strong> — <code>curl POST</code> to <code>BatchTriggerController</code> endpoints from external cron; HTTP 200 confirms sweep ran</li>
      </ul>
    </td></tr>
  </tbody>
</table>

<h2 id="workflow">Workflow — P191 held-allocation reroute</h2>
<p>P191 is the periodic sweep that retries routing for allocations stuck in <code>UNASSIGNED</code> (CSP not yet found, P50 retry cap not yet exhausted). Diagram below is the DAS allocation state machine; the dead-cron edge is the self-loop on UNASSIGNED.</p>
<div class="mermaid">
stateDiagram-v2
    [*] --> UNASSIGNED: ALLOCATION_REQUESTED
    UNASSIGNED --> ASSIGNED: routing picks a CSP
    UNASSIGNED --> UNASSIGNED: P191 sweep — re-attempt routing
    ASSIGNED --> ACCEPTED: auto-accept (AMENDMENT-02)
    ASSIGNED --> UNASSIGNED: P41 timeout (anchor TBD)
    ACCEPTED --> ACTIVE: install complete (downstream)
    ACCEPTED --> REALLOCATION_PENDING: system-structural trigger
    REALLOCATION_PENDING --> REASSIGNED: new CSP found
    REASSIGNED --> ACTIVE: install complete
</div>

<h3>P191 sweep behaviour</h3>
<p>For each <code>UNASSIGNED</code> allocation row, every 15 minutes:</p>
<ul>
  <li>If <code>retry_count &gt;= P50</code> (5 attempts) → skip (held permanently, OS-sanctioned service-vacuum).</li>
  <li>Else → call <code>allocationServiceImpl.rerouteAllocation(allocation, RETRY)</code> — routing engine re-attempts CSP pick.</li>
</ul>
<ul>
  <li><strong>Success:</strong> state → <code>ASSIGNED</code> → auto-accept → <code>ACCEPTED</code> → emits <code>ALLOCATION_ACCEPTED</code> → CL T1 fires (<code>REQUESTED → PENDING_INSTALL</code>) → TAS creates the install candidate.</li>
  <li><strong>Failure:</strong> stays <code>UNASSIGNED</code>, <code>retry_count++</code>. Next sweep retries until <code>retry_count == P50</code>, then held permanently.</li>
</ul>
<p><strong>Today:</strong> 230 UNASSIGNED rows in prod, oldest &gt; 24h, never re-routed. Every row is a customer whose request didn't find a CSP on the first attempt and is now invisible to the routing pipeline.</p>

<p><strong>Five sibling sweeps</strong> share the same root cause and co-ship (out of PM scope individually): <code>runAllocationTimeoutSweep</code> (P41 — anchor decision pending), <code>runConversionEval</code>, <code>runExposureRecalculation</code>, <code>runOverrideWatchdog</code>, <code>runReallocationDwellSweep</code>.</p>

<h2 id="wired">What's wired, what's not (8 layers)</h2>
<p>Audited against <code>services/csp-demand-allocation-service</code> source. The DAS layer-7 gap is actually <em>deeper</em> than CL's: CL has an <code>EventBridgeTaskScheduler</code> scaffold class. DAS has no scheduler abstraction at all.</p>
<table>
  <thead><tr><th style="width:6%">#</th><th style="width:13%">Status</th><th style="width:24%">Layer</th><th>Where it is (or isn't)</th></tr></thead>
  <tbody>
    <tr><td>1</td><td><span class="pill ok">Wired</span></td><td>Allocation state machine</td><td><code>AllocationServiceImpl</code> + <code>AllocationState</code> enum + transition validation</td></tr>
    <tr><td>2</td><td><span class="pill ok">Wired</span></td><td>Sweep batch methods (6)</td><td><code>application/impl/BatchTriggerServiceImpl.java</code>: <code>runHeldAllocationSweep</code> (P191, L83) · <code>runAllocationTimeoutSweep</code> (P41, L31) · <code>runConversionEval</code> (L66) · <code>runExposureRecalculation</code> (L76) · <code>runOverrideWatchdog</code> (L101) · <code>runReallocationDwellSweep</code> (L121). Each is <code>@Transactional</code> with correct query logic.</td></tr>
    <tr><td>3</td><td><span class="pill ok">Wired</span></td><td>Internal HTTP wrappers (6)</td><td><code>api/BatchTriggerController.java</code>: <code>POST /held-allocation-sweep</code> · <code>/allocation-timeout-sweep</code> · <code>/conversion-eval</code> · <code>/exposure-recalculation</code> · <code>/override-watchdog</code> · <code>/reallocation-dwell-sweep</code>. <strong><code>curl</code> against these works today.</strong></td></tr>
    <tr><td>4</td><td><span class="pill ok">Wired</span></td><td>Re-routing logic invoked by sweep</td><td><code>allocationServiceImpl.rerouteAllocation(allocation, RETRY)</code> — full routing engine including CSP candidate enumeration, eligibility filters, etc.</td></tr>
    <tr><td>5</td><td><span class="pill ok">Wired</span></td><td>Outbound event emission</td><td>Standard allocation event producers + outbox dispatch (<code>ALLOCATION_ACCEPTED</code>, allocation state changes).</td></tr>
    <tr><td>6</td><td><span class="pill ok">Wired</span></td><td>Downstream consumers</td><td>CL OS receives <code>ALLOCATION_ACCEPTED</code> → T1 fires. TAS creates install candidate on the same signal. <strong>Both wait idle for routing successes that never happen for the 230 stuck rows.</strong></td></tr>
    <tr><td>7</td><td><span class="pill bug">Missing</span></td><td>Service-side scheduler wiring</td><td><strong>No <code>EventBridgeTaskScheduler</code> class in DAS source at all</strong> (CL has one — see <a href="./bug-01.html#wired">BUG-01 layer 7</a>). DAS is one layer barer than CL. Grep for <code>scheduleRecurring</code> in DAS returns ZERO results. Even if the scheduler class were added, no startup hook would call it. The 6 sweep batches remain unregistered.</td></tr>
    <tr><td>8</td><td><span class="pill bug">Missing</span></td><td>Environment + AWS infrastructure</td><td><code>AWS_SCHEDULER_ENABLED: false</code> in <code>application-prod.yml:15</code> and <code>application-qa.yml:19</code> (and <code>application.yml:210</code> default also <code>false</code>). Placeholder <code>role-arn: arn:aws:iam::000000000000:role/demand-allocation-scheduler-role</code> in <code>application.yml:212</code>. No IaC in repo. <strong>Same cross-service gap as <a href="./bug-01.html#wired">BUG-01 layer 8</a>.</strong></td></tr>
  </tbody>
</table>

<div class="hint">
  <strong>Interim path that ships value before AWS infra lands:</strong> identical pattern to <a href="./bug-01.html">BUG-01</a> — the <code>BatchTriggerController</code> POST endpoints already work. External Lambda / GitHub Actions cron / k8s CronJob can <code>curl</code> the 6 endpoints on appropriate cadences (P191 every 15 min, others per spec) and unblock the 230 UNASSIGNED rows immediately.
</div>

<h2 id="evidence">Code evidence</h2>
<ul>
  <li><strong>Scheduler config:</strong> DAS <code>application-prod.yml</code> — <code>AWS_SCHEDULER_ENABLED: false</code>.</li>
  <li><strong>Sweep batches (correct, reachable):</strong> <code>BatchTriggerServiceImpl</code> (six sweep methods) &middot; <code>BatchTriggerController</code> (their endpoints).</li>
  <li><strong>Other DAS sweeps co-wired by tech (out of PM scope):</strong> <code>reallocation_dwell</code>, <code>override_watchdog</code>, <code>conversion_eval</code>, <code>exposure_recalc</code>. Share the same root cause; tech wires them together.</li>
</ul>
`,

  // ---------------- BUG-03 ----------------
  'bug-03': `
<h2 id="direction">Direction (per PM)</h2>
<div class="hint">
  The fix is a <strong>DAS-internal atomic write</strong>. When DAS routes an allocation to <code>ASSIGNED</code>, it transitions to <code>ACCEPTED</code> in the same database transaction — no cross-service call, no auto-accept sender to define. AMENDMENT-02's "automatic on assignment" phrasing matches this when read as <em>same-service atomic</em> rather than <em>cross-service deferred</em>. Removes the "who calls who" question entirely.
</div>

<h2 id="spec">Original spec</h2>
<div class="spec-ref">
  <strong>Source:</strong>
  <code>os/Demand_Allocation_OS_v1_9_1_LOCKED.md</code> &middot;
  <strong>§4.1, §4.3</strong> (allocation state machine — <code>ASSIGNED</code> → <code>ACCEPTED</code> transition) &middot;
  <strong>INV-DAO-03</strong> (stickiness post-<code>ACCEPTED</code>).
  <br>
  <strong>AMENDMENT-02</strong> (Installation Flow, Apr 2026) — declares acceptance "automatic on assignment" but does not name the sender; this item is the disambiguation.
  <br>
  <strong>PRD:</strong> <code>yaml-prd/demand-allocation-prd-v1.2.yaml</code> — state + field + transition validation all present.
</div>

<h2 id="cases">Test cases — expected vs observed</h2>
<table class="tc-table">
  <thead><tr><th>Acceptance criterion</th><th>Expected per spec</th><th>Observed in prod</th></tr></thead>
  <tbody>
    <tr>
      <td><strong>TC-1.</strong> When DAS routes an allocation to a CSP, then the allocation row transitions to <code>ACCEPTED</code> with <code>acceptance_timestamp = now()</code>.</td>
      <td class="expected">Allocation row: <code>state = ACCEPTED</code>, <code>acceptance_timestamp</code> set. INV-DAO-03 stickiness now applies — subsequent re-routes blocked.</td>
      <td class="observed">Allocation row: <code>state = ASSIGNED</code>, <code>acceptance_timestamp = NULL</code>. 504 / 504 rows in this state across prod history.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>DB</strong> — <code>csp_demand_allocation_service.connection_allocations</code> WHERE <code>created_at &gt; &lt;deploy timestamp&gt;</code> → expect <code>state = 'ACCEPTED'</code> and <code>acceptance_timestamp IS NOT NULL</code> on newly-created rows</li>
        <li><strong>DB</strong> — same table, GROUP BY state → expect ACCEPTED count rising, ASSIGNED count near 0 going forward</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-2.</strong> When TAS reads the allocation to drive install candidate creation, then it observes <code>ACCEPTED</code> state.</td>
      <td class="expected">TAS reads <code>state = ACCEPTED</code>; install candidate created with confirmed allocation.</td>
      <td class="observed">TAS still creates the install candidate (via the parallel <code>ALLOCATION_ACCEPTED</code> event path), but reads <code>state = ASSIGNED</code> on the allocation row. State and event are out of sync.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Cross-DB join</strong> — TAS <code>install_execution_candidates</code> WHERE <code>created_at &gt; &lt;deploy timestamp&gt;</code> JOIN DAS <code>connection_allocations</code> on allocation_id → expect every row pairs to a DAS row with <code>state = 'ACCEPTED'</code></li>
        <li><strong>TAS logs</strong> — handler logs at candidate creation reference the allocation state as ACCEPTED (not ASSIGNED)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-3.</strong> When the same connection is reallocated after CSP install-failure, then INV-DAO-03 stickiness has already terminated for the prior allocation.</td>
      <td class="expected">Prior allocation row stays in <code>ACCEPTED</code> until install completes or fails. After failure, INV-DAO-03 releases stickiness and the new allocation enters the pipeline.</td>
      <td class="observed">INV-DAO-03 stickiness is inert because nothing reaches <code>ACCEPTED</code>. Re-allocation works by accident, but the guard isn't actually guarding anything.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Negative test</strong> — try to manually reallocate a connection whose existing allocation row is in <code>ACCEPTED</code> → expect INV-DAO-03 guard to reject (existing rule, now actually exercised)</li>
        <li><strong>DB</strong> — after a CSP install-failure, the prior ACCEPTED row stays ACCEPTED until terminal; new allocation row appears for the retry</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-4.</strong> When the routing happy-path completes (DAS picks CSP-A successfully), then the database state-transition <code>ASSIGNED → ACCEPTED</code> happens in a single atomic write.</td>
      <td class="expected">DAS routing engine writes <code>state = ACCEPTED</code> in the same SQL transaction as the initial allocation write. No cross-service call, no auto-accept event. Atomic.</td>
      <td class="observed">Routing engine writes <code>state = ASSIGNED</code> and stops. AMENDMENT-02 deleted the prior cross-service call; the replacement atomic-write was never added.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Code</strong> — <code>RoutingEngineServiceImpl</code> diff shows the atomic write: INSERT (ASSIGNED) + UPDATE (ACCEPTED, acceptance_timestamp) + outbox row, all inside a single <code>@Transactional</code> method</li>
        <li><strong>DB</strong> — for a routing event, <code>connection_allocations</code> + <code>outbox_record</code> rows share the same transaction commit boundary (created_at within microseconds)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-5.</strong> When the integration-spec mentions <code>InstallDasClient.notifyAccepted()</code>, then that class either exists in code OR the integration spec is updated to reflect the atomic-write approach.</td>
      <td class="expected">Integration spec is internally consistent — either the named sender exists, or the spec describes the atomic-write fix.</td>
      <td class="observed">Integration spec at <code>app-specs/das-install-integration-flow.md</code> names <code>InstallDasClient.notifyAccepted()</code> — a class that does not exist in any service. Spec is stale.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Doc</strong> — <code>app-specs/das-install-integration-flow.md</code> no longer references <code>InstallDasClient.notifyAccepted()</code></li>
        <li><strong>Doc</strong> — spec describes the atomic-write approach inside DAS routing engine</li>
      </ul>
    </td></tr>
  </tbody>
</table>

<h2 id="flow">Expected behaviour — flow (after fix)</h2>
<div class="mermaid">
sequenceDiagram
    participant Cust as Customer App
    participant CL as CL Service
    participant DAS as DAS Service
    participant TAS as TAS Service
    Cust->>CL: CONNECTION_REQUEST
    CL->>DAS: ALLOCATION_REQUESTED (via event)
    Note over DAS: Routing engine picks CSP-A
    Note over DAS: SAME DB TRANSACTION:<br/>1. INSERT allocation (state=ASSIGNED)<br/>2. UPDATE allocation (state=ACCEPTED, acceptance_ts=now)<br/>3. INSERT outbox event ALLOCATION_ACCEPTED
    DAS->>TAS: ALLOCATION_ACCEPTED event
    TAS->>TAS: Create install candidate
    Note over DAS: INV-DAO-03 stickiness now ENFORCED on this row
</div>

<h2 id="evidence">Code evidence</h2>
<ul>
  <li><strong>Receiver (already wired, won't be needed after atomic-write fix):</strong> <code>services/csp-demand-allocation-service/.../AllocationServiceImpl.acceptAllocation(...)</code> &middot; <code>POST /api/demand-allocation/csps/{cspId}/accept</code>.</li>
  <li><strong>Routing engine (the atomic-write site):</strong> <code>services/csp-demand-allocation-service/.../RoutingEngineServiceImpl</code> — where the allocation write happens; the fix adds the <code>state = ACCEPTED</code> transition in the same transaction.</li>
  <li><strong>Stale integration-spec reference (to update):</strong> <code>app-specs/das-install-integration-flow.md</code> — names <code>InstallDasClient.notifyAccepted()</code> (does not exist). Either delete or rewrite to reflect atomic-write.</li>
  <li><strong>Prod evidence:</strong> 504 / 504 rows in <code>ASSIGNED</code> / <code>UNASSIGNED</code> across prod; zero in <code>ACCEPTED</code>; every <code>acceptance_timestamp</code> NULL.</li>
</ul>
`,

  // ---------------- BUG-04 ----------------
  'bug-04': `
<h2 id="spec">Original spec</h2>
<div class="spec-ref">
  <strong>Source:</strong>
  <code>os/Connection_Lifecycle_OS_v1_7_1_LOCKED.md</code> &middot;
  <strong>§4.3 T2 (L250):</strong> "Consumers: Capacity OS (active count +1), Quality OS (measurement begins), D&amp;A OS (allocation confirmed)…"
  <strong>§4.1 (L202)</strong> &middot;
  <strong>§6.3 (L508):</strong> identical wording.
  <br>
  <code>os/Capacity_Coverage_OS_LOCKED.md</code> &middot; <strong>§2.5:</strong> "Counter reflects all ACTIVE connections in the zone, regardless of how they entered ACTIVE state."
</div>

<h2 id="cases">Test cases — expected vs observed</h2>
<table class="tc-table">
  <thead><tr><th>Acceptance criterion</th><th>Expected per spec</th><th>Observed in prod</th></tr></thead>
  <tbody>
    <tr>
      <td><strong>TC-1.</strong> When a connection completes T2 (<code>PENDING_INSTALL → ACTIVE</code>, <code>activation_source = INITIAL</code>), then Capacity OS increments <code>zones.active_connection_count</code> for the zone by 1.</td>
      <td class="expected">Counter advances by 1 per <code>INITIAL</code> T2 event.</td>
      <td class="observed">Code at <code>InboundEventProcessingServiceImpl.java:446-461</code> gates increment to <code>if ("RESUME".equals(activationSource))</code>. <code>INITIAL</code> hits the <code>else</code> branch with debug log <code>LOG_CONNECTION_ACTIVATION_SKIP</code>. Counter unchanged.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>DB</strong> — <code>csp_capacity_coverage_service.zones.active_connection_count</code> snapshot before vs after an <code>INITIAL</code> T2 event for the same zone → expect +1</li>
        <li><strong>Capacity service logs</strong> — <code>LOG_CONNECTION_COUNT_INCREMENT</code> entry with the zone_id + new count for the test INITIAL event</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-2.</strong> When a connection transitions <code>PAUSED → ACTIVE</code> (<code>activation_source = RESUME</code>), then Capacity OS increments the counter.</td>
      <td class="expected">Counter advances by 1.</td>
      <td class="observed">This path works — RESUME hits the <code>if</code> branch correctly.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify (regression — must keep working after fix):</strong>
      <ul>
        <li><strong>DB</strong> — <code>zones.active_connection_count</code> snapshot before vs after a <code>RESUME</code> event → expect +1 (unchanged from today)</li>
        <li><strong>Capacity service logs</strong> — RESUME path still hits the <code>LOG_CONNECTION_COUNT_INCREMENT</code> entry</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-3.</strong> When the load-ratio is computed in the batch-evaluation cycle, then it reads accurate <code>active_connection_count</code>.</td>
      <td class="expected">Load ratio at <code>BatchEvaluationServiceImpl:105</code> = real ACTIVE / cap. Cap-calibration cycles compute correctly.</td>
      <td class="observed">Load ratio reads stale counter (under-counted for zones with high INITIAL throughput). Cap-calibration cycles miscalibrate.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Cross-DB check</strong> — for each zone: <code>zones.active_connection_count</code> in Capacity OS DB = <code>SELECT COUNT(*) FROM csp_connection_lifecycle_service.connections WHERE current_state = 'ACTIVE' AND zone_id = &lt;zone&gt;</code> → totals should match (or differ by &lt; in-flight tolerance)</li>
        <li><strong>Logs</strong> — <code>BatchEvaluationServiceImpl</code> cap-calibration cycle logs show load_ratio computed from the post-fix counter</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-4.</strong> When a zone's last ACTIVE connection deactivates, then <code>guardActiveConnectionCountZeroForRetire</code> allows the zone to retire.</td>
      <td class="expected">Counter reaches 0; retire-guard at <code>ZoneServiceImpl:136</code> allows zone retirement.</td>
      <td class="observed">If the zone had INITIAL activations that never incremented, the counter may report 0 prematurely (when ACTIVE connections still exist) — or remain stuck at 0 if it was never advanced. Direction of drift depends on RESUME / INITIAL mix.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Test</strong> — pick a zone with 1 ACTIVE connection; deactivate it; <code>zones.active_connection_count</code> reaches 0; call zone-retire → expect retire-guard at <code>ZoneServiceImpl:136</code> to allow retirement</li>
        <li><strong>Negative test</strong> — same with 2 ACTIVE connections; deactivate 1 → counter = 1; attempt retire → guard rejects (counter &gt; 0)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-5.</strong> When the CSP partner views their active-connection count on the partner app, then the number matches CL truth.</td>
      <td class="expected">Partner app count = CL <code>connections</code> table count for <code>(csp_id, state=ACTIVE)</code>.</td>
      <td class="observed">Already correct — partner app reads CL directly via <code>gateway → CspConnectionQueryController.countByCspIdAndCurrentState</code>. <strong>Bypasses Capacity OS entirely.</strong> Capacity OS bug doesn't affect this surface.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify (baseline still holds; unaffected by this fix):</strong>
      <ul>
        <li><strong>API</strong> — partner-app active-count GET endpoint → returns the same value as <code>SELECT COUNT(*) FROM csp_connection_lifecycle_service.connections WHERE csp_id = &lt;csp&gt; AND current_state = 'ACTIVE'</code></li>
        <li><strong>Note</strong> — this is independent of <code>zones.active_connection_count</code>; partner app reads CL directly</li>
      </ul>
    </td></tr>
  </tbody>
</table>

<h2 id="backfill">Backfill</h2>
<p>Once the guard is removed, future T2 events increment correctly. Historical drift requires a one-shot reconciliation: <code>UPDATE zones SET active_connection_count = (SELECT count(*) FROM csp_connection_lifecycle_service.connections WHERE current_state='ACTIVE' AND zone_id = zones.zone_id)</code>. Run during a window with cap-calibration paused.</p>

<h2 id="evidence">Code evidence</h2>
<ul>
  <li><strong>Bug site:</strong> <code>services/csp-capacity-coverage-service/.../InboundEventProcessingServiceImpl.java:446-461</code> — remove the RESUME-only guard.</li>
  <li><strong>Reader sites (where the drift matters):</strong> <code>BatchEvaluationServiceImpl:105</code> (load-ratio for cap-calibration) &middot; <code>ZoneServiceImpl:136</code> (<code>guardActiveConnectionCountZeroForRetire</code>).</li>
  <li><strong>Proof bug doesn't affect CSP app:</strong> <code>services/csp-connection-lifecycle-service/.../CspConnectionQueryController.java:62</code> &middot; <code>services/csp-gateway-service/.../AssuranceStripFacadeService.java:520-525</code>.</li>
</ul>
`,

  // ---------------- BUG-05 ----------------
  'bug-05': `
<h2 id="spec">Original spec</h2>
<div class="spec-ref">
  <strong>Source:</strong>
  <code>os/Connection_Lifecycle_OS_v1_7_1_LOCKED.md</code> &middot;
  <strong>§7.2 Signal Schema (Outbound) — base schema</strong> &middot;
  <strong>§7.4 Outbound Signal Types catalogue (L512)</strong> &middot;
  <strong>Appendix A S-10 (L1305-1326):</strong> full payload spec for <code>CL_INSTALLATION_QUALITY_SIGNAL</code> &middot;
  <strong>Idempotency rule (L1325):</strong> <code>connection_id + activation_event_ref</code> &middot;
  <strong>Emit rule (L1504):</strong> on successful T2 (<code>activation_source = INITIAL</code>) only.
  <br>
  <code>os/esr/ESR_v2_27_LOCKED.md</code> &middot; <strong>EVENT: CL_INSTALLATION_QUALITY_SIGNAL (L448)</strong> — registered as FACT event from CLS.
</div>

<h2 id="cases">Test cases — expected vs observed</h2>
<table class="tc-table">
  <thead><tr><th>Acceptance criterion</th><th>Expected per spec</th><th>Observed in prod</th></tr></thead>
  <tbody>
    <tr>
      <td><strong>TC-1.</strong> When T2 fires (<code>PENDING_INSTALL → ACTIVE</code>, source INITIAL), then CL emits a payload with field name <code>signal_id</code> (per §7.2 base schema).</td>
      <td class="expected">JSON payload contains <code>"signal_id": "&lt;UUID&gt;"</code>.</td>
      <td class="observed">JSON payload contains <code>"event_id": "&lt;UUID&gt;"</code> — wrong field name. Quality OS validates <code>@NotBlank signalId</code>, gets blank, rejects. Producer record at <code>ClInstallationQualitySignal.java</code> inherits <code>eventId</code> from <code>DomainEvent</code> envelope.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Outbox</strong> — <code>csp_connection_lifecycle_service.outbox_record</code> WHERE record_type ends in <code>ClInstallationQualitySignal</code> AND <code>created_at &gt; &lt;deploy timestamp&gt;</code> → payload JSON contains key <code>"signal_id"</code> (not <code>"event_id"</code>)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-2.</strong> When CL emits the payload, then field <code>signal_type</code> carries the §7.4 enum entry for this signal.</td>
      <td class="expected">JSON contains <code>"signal_type": "CL_INSTALLATION_QUALITY_SIGNAL"</code> (string-typed enum entry).</td>
      <td class="observed">JSON contains <code>"event_type": "CL_INSTALLATION_QUALITY_SIGNAL"</code> — wrong field name. Producer record has no <code>signalType</code> field; relies on base <code>getEventType()</code>.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Outbox</strong> — same query as TC-1 → payload contains key <code>"signal_type"</code> with value <code>"CL_INSTALLATION_QUALITY_SIGNAL"</code></li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-3.</strong> When T2 fires, then field <code>previous_state</code> is populated.</td>
      <td class="expected">JSON contains <code>"previous_state": "PENDING_INSTALL"</code> (per §7.2 — required for state transitions, and T2 is one).</td>
      <td class="observed">JSON contains <code>"previous_state": null</code>. Producer code passes <code>null</code> at the T2 emit site instead of <code>"PENDING_INSTALL"</code>.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Outbox</strong> — same outbox query → payload contains <code>"previous_state": "PENDING_INSTALL"</code> (not null)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-4.</strong> When the payload reaches Quality OS, then it passes the receiver's <code>@NotBlank</code> / <code>@NotNull</code> validation.</td>
      <td class="expected">HTTP 200; <code>install_maturation_ledger</code> row written.</td>
      <td class="observed">HTTP 400 <code>VALIDATION_FAILED</code> on three fields (<code>signalId</code>, <code>signalType</code>, <code>previousState</code>). 53 / 53 outbox rows marked FAILED. Receiver matches the OS exactly — the producer is the side that drifted.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Outbox</strong> — <code>csp_connection_lifecycle_service.outbox_record</code> WHERE record_type ends in <code>ClInstallationQualitySignal</code> AND <code>created_at &gt; &lt;deploy timestamp&gt;</code> → expect status = 'DELIVERED' (not 'FAILED')</li>
        <li><strong>Quality OS DB</strong> — <code>csp_quality_service.install_maturation_ledger</code> → new rows per successful signal</li>
        <li><strong>Replay</strong> — replay the 53 historical FAILED outbox rows → all deliver successfully (assuming producer fix is in place)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-5.</strong> When CL re-emits an existing signal (e.g. on retry), then Quality OS dedupes by <code>(connection_id, activation_event_ref)</code> per the OS idempotency rule.</td>
      <td class="expected">Duplicate signals don't create duplicate <code>install_maturation_ledger</code> rows.</td>
      <td class="observed">Receiver-side idempotency works correctly (already implemented). Once the producer is fixed and historical FAILED rows are replayed, dedupe handles it cleanly.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Replay test</strong> — re-emit the same <code>ClInstallationQualitySignal</code> twice for the same connection</li>
        <li><strong>Quality OS DB</strong> — <code>install_maturation_ledger</code> WHERE connection_id = &lt;test&gt; → expect exactly 1 row (not 2), dedupe key is <code>(connection_id, activation_event_ref)</code></li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-6.</strong> When the signal is emitted, then the payload does <strong>not</strong> include fields not in the OS contract.</td>
      <td class="expected">Payload contains only the base schema + S-10 specific fields. No <code>correlation_id</code>, no <code>causation_id</code>.</td>
      <td class="observed">Payload contains <code>correlation_id: null</code> and <code>causation_id: &lt;UUID&gt;</code>. Receiver tolerates unknown fields (Jackson default), so these are noise — but the producer record should be trimmed to S-10.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Outbox</strong> — same payload check → no <code>correlation_id</code> or <code>causation_id</code> keys (only S-10 + base-schema fields)</li>
        <li><strong>Code</strong> — <code>ClInstallationQualitySignal.java</code> producer record fields match S-10 spec verbatim</li>
      </ul>
    </td></tr>
  </tbody>
</table>

<h2 id="error">Verbatim validation error from prod (captured by the dispatcher into <code>failure_reason</code>)</h2>
<pre><code>400 Bad Request: {
  "field_errors": [
    {"field": "signalId",      "message": "must not be blank"},
    {"field": "signalType",    "message": "must not be null"},
    {"field": "previousState", "message": "must not be null"}
  ],
  "error_code": "VALIDATION_FAILED",
  "message":    "Request validation failed"
}</code></pre>

<h2 id="evidence">Code evidence — side-by-side</h2>
<p><strong>Producer (drifted) — <code>services/csp-connection-lifecycle-service/.../domain/event/outbound/ClInstallationQualitySignal.java</code>:</strong></p>
<pre><code>public record ClInstallationQualitySignal(
    String eventId,            // ← should be signalId
    String correlationId,      // ← not in S-10
    String causationId,        // ← not in S-10
    String connectionId,
    Instant timestamp,
    String previousState,      // ← populated as null at emit
    String newState,
    String cspId,
    ...
) implements DomainEvent {
    @Override public String getEventType() {        // ← serializes as event_type
        return "CL_INSTALLATION_QUALITY_SIGNAL";
    }
}</code></pre>
<p><strong>Receiver (OS-aligned) — <code>services/csp-quality-service/.../domain/event/inbound/ClInstallationQualitySignal.java</code>:</strong></p>
<pre><code>public record ClInstallationQualitySignal(
    @NotBlank String signalId,
    @NotNull  String signalType,
    @NotBlank String connectionId,
    @NotNull  Instant timestamp,
    @NotNull  String previousState,
    @NotNull  String newState,
    @NotBlank String cspId,
    ...
) {}</code></pre>
<p><strong>Reproducing the evidence in prod:</strong></p>
<pre><code>SELECT failure_reason FROM csp_connection_lifecycle_service.outbox_record
WHERE record_type = 'io.wiom.csp.connection_lifecycle.domain.event.outbound.ClInstallationQualitySignal'
  AND status = 'FAILED';
-- 53 rows, every one with the same 3 field_errors.</code></pre>
`,

  // ---------------- BUG-06 ----------------
  'bug-06': `
<h2 id="spec">Original spec + fix</h2>
<div class="spec-ref">
  <strong>Source:</strong>
  <code>os/Connection_Lifecycle_OS_v1_7_1_LOCKED.md</code> &middot;
  <strong>S-03: <code>CL_CONNECTION_ACTIVATED</code></strong> payload definition (L1195-1213). The CL <code>connections</code> table holds <code>customer_id</code> on every row (it's where CL reads <code>csp_id</code>, <code>zone_id</code>, etc. from at emit time).
  <br><br>
  <strong>The fix is in two places — no OS amendment needed:</strong>
  <br>
  1. <strong>CL service:</strong> add <code>customerId</code> to the <code>ClConnectionActivated</code> record and populate from the same <code>connections</code> row that supplies the existing fields. CL already emits additive fields beyond what S-03 lists (e.g. <code>correlationId</code>, <code>causationId</code>, <code>activatedAt</code>) without OS amendments — adding one more is the same pattern.
  <br>
  2. <strong>CAEO consumer:</strong> read <code>customerId</code> from the event and write it to the <code>customer_access_entitlement.customer_id</code> column. Replace the placeholder write at <code>InboundEventProcessingServiceImpl.java:82</code>.
  <br><br>
  <strong>S-03 documentation update</strong> is a paperwork pass — recommended for hygiene, not a blocker for build. The existing consumers (Compensation, Quality, Capacity, CAEO) ignore unknown fields, so the additive change ships unilaterally on CL's side.
</div>

<h2 id="cases">Test cases — expected vs observed</h2>
<table class="tc-table">
  <thead><tr><th>Acceptance criterion</th><th>Expected per spec</th><th>Observed in prod</th></tr></thead>
  <tbody>
    <tr>
      <td><strong>TC-1.</strong> When CL emits <code>CL_CONNECTION_ACTIVATED</code> on T2, then the payload contains <code>customer_id</code>.</td>
      <td class="expected">JSON contains <code>"customer_id": "&lt;UUID&gt;"</code> — the customer the connection serves, read directly from the CL <code>connections</code> table (same row that supplies <code>csp_id</code>, <code>zone_id</code>, etc.).</td>
      <td class="observed">Payload has no <code>customer_id</code> field. The CL service producer record (<code>ClConnectionActivated.java</code>) doesn't include it.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>Outbox</strong> — <code>csp_connection_lifecycle_service.outbox_record</code> WHERE record_type ends in <code>ClConnectionActivated</code> AND <code>created_at &gt; &lt;deploy timestamp&gt;</code> → payload JSON contains key <code>"customer_id"</code> with a non-null UUID</li>
        <li><strong>Code</strong> — <code>ClConnectionActivated.java</code> record now has a <code>customerId</code> field</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-2.</strong> When CAEO consumes <code>CL_CONNECTION_ACTIVATED</code>, then it writes <code>customer_access_entitlement.customer_id</code> from the event's <code>customer_id</code> field.</td>
      <td class="expected"><code>customer_id</code> column = real customer's UUID.</td>
      <td class="observed">CAEO at <code>InboundEventProcessingServiceImpl.java:82</code> writes <code>.customerId(event.cspId() != null ? event.cspId() : null)</code> — the CSP-ID lands in the customer-id column. Author: Aryan Gaurav, Apr 10 2026.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>DB</strong> — <code>csp_customer_access_service.customer_access_entitlement</code> WHERE <code>created_at &gt; &lt;deploy timestamp&gt;</code> → <code>customer_id</code> = real customer UUID</li>
        <li><strong>Cross-check</strong> — for sampled CAEO rows: <code>customer_id</code> matches <code>csp_connection_lifecycle_service.connections.customer_id</code> for the same <code>connection_id</code></li>
        <li><strong>Code</strong> — CAEO <code>InboundEventProcessingServiceImpl.java:82</code> reads <code>event.customerId()</code> (not <code>event.cspId()</code>)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-3.</strong> When a downstream consumer queries CAEO by <code>customer_id</code>, then it finds entitlement rows for the matching customer.</td>
      <td class="expected">A query like <code>findByCustomerId("&lt;real-customer-uuid&gt;")</code> returns rows.</td>
      <td class="observed">Method exists in the repository (<code>findByCustomerId</code>) but is never called anywhere in the monorepo today — because the column has the wrong value. Once fixed, the column becomes queryable.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after fix:</strong>
      <ul>
        <li><strong>DB</strong> — <code>SELECT * FROM csp_customer_access_service.customer_access_entitlement WHERE customer_id = '&lt;real customer UUID&gt;'</code> → expect rows matching the customer's connections</li>
        <li><strong>API</strong> — call any downstream endpoint that uses <code>findByCustomerId</code> → returns non-empty results for real customers</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-4.</strong> When sibling <code>CL_CONNECTION_*</code> events fire (PAUSED, RESCUED, DEACTIVATED), then their payloads also include <code>customer_id</code> if any consumer needs it.</td>
      <td class="expected">Sibling-event contract uniformity. Engineering audits which sibling events have downstream consumers that would benefit from <code>customer_id</code> and adds the field to those producer records together.</td>
      <td class="observed">Sibling events also lack <code>customer_id</code>. Out of scope for this item if no downstream consumer needs them — only <code>CL_CONNECTION_ACTIVATED</code> is required to unblock CAEO.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify (out-of-scope check):</strong>
      <ul>
        <li><strong>Code diff</strong> — confirm no changes to <code>ClConnectionPaused.java</code>, <code>ClConnectionRescued.java</code>, <code>ClConnectionDeactivated.java</code> in this release</li>
        <li><strong>Outbox</strong> — payloads for sibling events still lack <code>customer_id</code> (intentionally out of scope; only ACTIVATED is fixed)</li>
      </ul>
    </td></tr>
    <tr>
      <td><strong>TC-5.</strong> When the historical backfill runs (one-shot), then existing CAEO rows with <code>customer_id = &lt;some-CSP-ID&gt;</code> get corrected.</td>
      <td class="expected"><code>UPDATE customer_access_entitlement SET customer_id = c.customer_id FROM csp_connection_lifecycle_service.connections c WHERE customer_access_entitlement.connection_id = c.connection_id</code>. Join via <code>connection_id</code> (always present on both sides).</td>
      <td class="observed">Backfill not yet run. ~50 of 19,573 CAEO rows currently have CSP-IDs in <code>customer_id</code> column.</td>
    </tr>
    <tr class="tc-verify"><td colspan="3">
      <strong class="v-label">Verify after backfill:</strong>
      <ul>
        <li><strong>DB (pre-backfill)</strong> — <code>SELECT COUNT(*) FROM csp_customer_access_service.customer_access_entitlement cae JOIN csp_connection_lifecycle_service.connections c ON cae.connection_id = c.connection_id WHERE cae.customer_id != c.customer_id</code> → count of rows needing correction (~50)</li>
        <li><strong>Run</strong> the backfill UPDATE</li>
        <li><strong>DB (post-backfill)</strong> — same query → expect 0 rows</li>
      </ul>
    </td></tr>
  </tbody>
</table>

<h2 id="source">Source of truth — already in place</h2>
<p>The CL <code>connections</code> table holds the <code>connection_id → customer_id</code> mapping on every row. CL has the value at T2 emit time — adding it to the event payload is a column read on the same row. No new upstream lookup needed. Backfill is similarly trivial via the connection-id join.</p>

<h2 id="evidence">Code evidence</h2>
<ul>
  <li><strong>Bug site:</strong> <code>services/csp-customer-access-service/.../InboundEventProcessingServiceImpl.java:82</code> — the placeholder write.</li>
  <li><strong>CL emit site (to update):</strong> <code>services/csp-connection-lifecycle-service/...</code> — <code>CL_CONNECTION_ACTIVATED</code> producer.</li>
  <li><strong>Source-of-truth column:</strong> <code>csp_connection_lifecycle_service.connections.customer_id</code>.</li>
  <li><strong>Prod evidence:</strong> connection audit for <code>f285e07f-…</code> — CAEO row created, <code>customer_id = a0a7b6</code> (the CSP-ID).</li>
</ul>
`,
};

// ----------------------------------------------------------------------------
// Build a bug page
// ----------------------------------------------------------------------------
function buildBugPage(bug) {
  const mermaidScript = bug.hasMermaid
    ? `\n<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>\n<script>\n  if (typeof mermaid !== 'undefined') {\n    mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose', flowchart: { curve: 'basis' } });\n  }\n</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${bug.num} — ${stripHtml(bug.short)} · Installation Flow</title>
<style>${CSS}</style>
</head>
<body>
<div class="layout">
${navHtml(bug.id, bug.sections)}
<main>
  <header class="doc">
    <div class="eyebrow">Installation Flow — Tech Handover · ${bug.num}</div>
    <h1>${bug.title}</h1>
    <p class="lede">${bug.lede}</p>
    <div class="meta-row">
      <div><strong>Owner:</strong> Ashish Raj</div>
      <div><strong>Date:</strong> 2026-06-04</div>
      <div><span class="pill bug">Bug</span></div>
    </div>
  </header>
${BUG_BODY[bug.id]}

  <div style="margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 12px;">
    <p>Installation Flow — Tech Handover · ${bug.num} · Owner: Ashish Raj</p>
  </div>
</main>
</div>${mermaidScript}
</body>
</html>
`;
}

// Helper to strip simple HTML tags from short strings (for <title>)
function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '');
}

// ----------------------------------------------------------------------------
// Build the index page (replaces installation-p2-bugs.html)
// ----------------------------------------------------------------------------
function buildIndexPage() {
  const bugCards = BUGS.map(b => `      <div class="card bug">
        <span class="id">${b.num}</span>
        <h3>${b.title}</h3>
        <p>${b.lede}</p>
        <a class="open" href="./${b.id}.html">Open spec →</a>
      </div>`).join('\n');

  const gapCards = GAPS.map(g => `      <div class="card gap">
        <span class="id">${g.num}</span>
        <h3>${g.short}</h3>
        <a class="open" href="./${g.id}.html">Open spec →</a>
      </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Installation Flow — Bugs &amp; Gaps · Tech Handover</title>
<style>${CSS}
  main.index { max-width: 1100px; padding: 40px 56px 80px; margin: 0 auto; }
  main.index header.doc { margin-bottom: 32px; }
  main.index h2 { margin: 36px 0 12px; font-size: 18px; text-transform: uppercase; letter-spacing: 0.08em; }
  main.index h2.bugs { color: var(--bug); }
  main.index h2.gaps { color: var(--gap); }
</style>
</head>
<body>
<main class="index">
  <header class="doc">
    <div class="eyebrow">Installation Flow — Tech Handover</div>
    <h1>Installation P2 items — bugs &amp; gap specs</h1>
    <p class="lede">Each item below is a standalone document, hosted as its own page. Bugs follow the test-case format (original spec + expected-vs-observed + code evidence). Gap specs follow the Wiom Change Spec Template v1.0 at Light tier.</p>
    <div class="meta-row">
      <div><strong>Owner:</strong> Ashish Raj</div>
      <div><strong>Date:</strong> 2026-06-04</div>
      <div><strong>Items:</strong> ${BUGS.length} bugs · ${GAPS.length} gaps</div>
    </div>
  </header>

  <h2 class="bugs">Bugs (${BUGS.length})</h2>
  <div class="card-grid">
${bugCards}
  </div>

  <h2 class="gaps">Gap specs (${GAPS.length})</h2>
  <div class="card-grid">
${gapCards}
  </div>

  <div style="margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 12px;">
    <p>Installation Flow — Tech Handover · Owner: Ashish Raj</p>
  </div>
</main>
</body>
</html>
`;
}

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------
BUGS.forEach(bug => {
  const outPath = path.join(OUT_DIR, bug.id + '.html');
  fs.writeFileSync(outPath, buildBugPage(bug));
  console.log('Wrote', outPath);
});

const indexPath = path.join(OUT_DIR, 'installation-p2-bugs.html');
fs.writeFileSync(indexPath, buildIndexPage());
console.log('Wrote', indexPath);
