---
name: agent-config-consistency-audit
description: Deterministically audit configuration consistency for a single agent, a team of agents, all agents reporting to an orchestrator, or all agents assigned to a project. A bundled engine (scripts/audit.js) selects the scope, measures every source, runs the mechanical checks (models, sizes, duplicates, hierarchy, and skills: missing, suggested, overhead, broken descriptions) and renders a fixed-layout offline HTML report; the agent only adds judgment findings (contradictions, paraphrased duplicates, ownership gaps, skill fit) in a validated JSON file. Same inputs give a byte-identical report. Read-only.
metadata:
  version: "2.2"
---

# Agent Configuration Consistency Audit

Audit the identity docs, DB memory rules, skills, config and provider/model assignments of one or more Timon agents. Produce **one** self-contained HTML report.

**Strictly read-only.** Never modify identity docs, DB rules, skills, `config.json` or settings during an audit.

---

## 0. Determinism contract (read first)

The report must have the same checks, thresholds, structure, order and numbering on every run. To get this, the work is split:

| Who | Does what |
|---|---|
| **Engine** `scripts/audit.js` | Scope selection, file measurement, token estimate, the mechanical checks (`M1`, `M2` tier rule, `M3`, `S1`–`S3`, `S4` import size, `K1`–`K3` skill heuristics, `K4`, `R1`/`R3` exact duplicates, `H1` pieges.md, `H3`, `H4`, `H5`), severity defaults, sorting, finding IDs, the HTML, the KPIs, the self-check. |
| **You (the agent)** | Copy raw MCP outputs into `mcp.json`. Read `digest.md`. Write `judgment.json` with the judgment findings and one note for each judgment check. |

Rules:
1. **Never write the HTML yourself.** Never edit the generated HTML. If the engine refuses your input, fix the input and run it again.
2. **Never author an engine-only check** (`M1`, `M3`, `S1`, `S2`, `S3`, `K4`, `H3`, `H4`, `H5`). The engine refuses it. To reject a heuristic engine finding (`K1`, `K2`, `R1`, `R3` only), add a `dismiss` entry with a reason. The report shows it as "Dismissed: … — reason". A dismiss that matches nothing is refused.
3. **Paste MCP outputs raw.** Do not summarize, filter or reorder them. When a tool fails, put `{"status":"not accessible","reason":"<error>"}` for that key. Never leave the key out.
4. **Each judgment check needs one finding or more, or a note** in `checkNotes` that states what you compared and why you found nothing. The engine refuses a check that has neither.
5. **Each quote must be verbatim.** The engine looks for each `doc`, `config` and `file` quote in the collected text (whitespace collapsed; `…` marks a gap). An invented or paraphrased quote stops the render.
6. **Do not change the engine for one audit.** A change to `audit.js` is a new skill version. Bump `VERSION` and the changelog in `README.md`.

---

## 1. Workflow (always these 6 steps, in this order)

Work directory: `<cwd>\audits\.work\<scope-slug>-<YYYY-MM-DD>\` (call it `<work>`). Keep it after the run: it is the evidence trail.
Engine: `node "<TIMON_HOME>\skills\agent-config-consistency-audit\scripts\audit.js"`.

### Step 1 — Phase A MCP calls → `<work>\mcp.json`
Run `date` first. Call `agent_list`, `backends_list`, `project_list`, and `project_roles(slug)` for the target project. For the other scope modes, also call `project_roles` for each project the selected agents belong to. Write:

```json
{
  "scope": { "mode": "single|team|orchestrator|project", "target": "<agent name or project slug>", "targets": ["<team mode only>"] },
  "asOf": "YYYY-MM-DD HH:MM +HH:MM",
  "auditor": "<your agent name>",
  "agentList": <raw agent_list output>,
  "backends": <raw backends_list output>,
  "projects": <raw project_list output>,
  "projectRoles": { "<slug>": <raw project_roles output> },
  "envNotes": ["<optional: MCP servers that failed to connect, etc.>"]
}
```

### Step 2 — Collect
```
node audit.js collect --home <TIMON_HOME> --work <work>
```
The engine selects the agents. The selection rule is fixed:
- `single`: the target agent.
- `team`: the agents in `targets`.
- `orchestrator`: the target and every agent below it in the `reports_to` chain, direct or transitive.
- `project`: every agent whose `config.project` equals the slug, or whose name starts with `<slug>.`, or that `project_roles` lists.

The engine sorts the agents in code-point order. It reads every `*.md` file at each agent's root, `config.json`, the memory folder, `global-instructions.md`, and the workspace CLI files (`AGENTS.md`, `CLAUDE.md`, `.github\copilot-instructions.md`, `.github\instructions\*.instructions.md`). It writes `collected.json` and `digest.md`, and prints the selected agents.

### Step 3 — Phase B MCP calls → add these keys to `mcp.json`
For **each** selected agent and each distinct project:
```json
"rules": {
  "global": <raw memory_rule_list(scope:"global")>,
  "role": <raw memory_rule_list(scope:"role")>,
  "project": { "<slug>": <raw memory_rule_list(scope:"project", project:slug)> },
  "agent": { "<name>": <raw memory_rule_list(scope:"agent", agent:name)> }
},
"projectMemory": { "<slug>": <raw memory_show(scope:"project", id:slug)> },
"skills": { "<name>": <raw skill_resolve(agent:name)> },
"skillReads": { "<name>": <raw skill_reads(agent:name)> },
"importSkillChars": { "<skill id>": <character count of skill_get(id) body, for every import-mode skill> },
"skillList": <raw skill_list output>,
"skillAttachments": <raw skill_attachment_list output, no filter>
```
Then **run `collect` again**. This adds the installed-skills section to `digest.md`: every installed skill with its size and description, and each agent's resolved skills and reads.

### Step 4 — Judgment → `<work>\judgment.json`
Read `digest.md` from start to end: every doc with line numbers, every config, and the list of exact duplicates. Then apply the **Judgment protocol** (Section 3) and write:

```json
{
  "findings": [
    {
      "check": "C1",
      "agents": ["<exact names>"],
      "title": "<one line, states the defect>",
      "sev": "<optional; only to change the default>",
      "severityJustification": "<required when sev differs from the default>",
      "evidence": [
        { "doc":    { "agent": "<name>", "file": "rules.md", "quote": "<verbatim>" } },
        { "config": { "agent": "<name>", "quote": "\"model\": \"x\"" } },
        { "file":   { "path": "<absolute path of global-instructions.md or a workspace file>", "quote": "<verbatim>" } },
        { "rule": 101 },
        { "source": "Timon built-in preamble", "quote": "<text; shown as not machine-verified>" },
        { "note": "<plain text, `code` allowed>" },
        { "table": { "head": ["…"], "rows": [["…"]] } }
      ],
      "impact": "<what goes wrong>",
      "rec": "<which source wins and what to change>",
      "fix": "<exact MCP call or doc edit, one per line>",
      "ghost": { "label": "<missing target>", "sub": "<where it is named>", "from": ["<agents>"] }
    }
  ],
  "checkNotes": { "C3": "<what was compared and why 0>", "…": "…" },
  "dismiss": [ { "check": "K2", "titleContains": "<substring of the engine title>", "reason": "<why it does not apply>" } ]
}
```
Use `ghost` only for C4 and C5 findings that name an escalation target that does not exist or that contradicts `reports_to`. The diagram draws it as a ghost node with dashed edges.

### Step 5 — Render
```
node audit.js render --work <work> --out-dir <cwd>\audits
```
The engine validates all inputs, merges your findings with its own, and sorts them by severity, then category (`M`→`C`→`S`→`K`→`R`→`H`), then first affected agent, then check ID, then title. It numbers them `F01…`, writes `<cwd>\audits\agent-config-audit-<scope-slug>-<YYYY-MM-DD>.html`, and verifies the file: no external URLs, tile count equals findings, KPIs equal findings, 9 sections, diagram present. It then prints a JSON summary. If you get `ERROR`, nothing was written: fix the input it names and run again.

### Step 6 — Deliver
Call `ui_render(title: "Agent Config Consistency Audit — <scope-slug>", path: "<absolute html path>")` when the summary says `uiRenderOk: true`. Then give a short chat summary: the file path, the counts per severity, and the top 3 actions (F01–F03 in order). End it with one line: "Indicative screening: verify each finding before acting; this audit reads configuration only and does not necessarily show the root cause."

---

## 2. Check catalog (fixed; the engine applies these defaults)

| ID | Check | Default | Owner |
|---|---|---|---|
| `M1` | Model absent from the live catalog of its effective backend; backend unknown; backend `signedIn: false` | critical | engine |
| `M2` | Tier rule: light model (`/haiku\|flash\|mini\|nano\|lite\|small/`) on a reasoning role (orchestrator, coder, reviewer, research, doc/librarian/writer, ops), or top model (`/opus\|fable\|astra\|ultra/`) on a mechanical role (merger, chore). **Judgment adds:** a `permissionModel` that conflicts with the role's workflow. | medium | both |
| `M3` | Coder and reviewer of the same project on the same backend + model | medium | engine |
| `C1` | Conflict inside one agent: in one file (tag the title `[intra-file]`) or between two of its docs, or between a doc and an agent DB rule | critical | judgment |
| `C2` | Agent doc or agent rule contradicts global-instructions, a global/role/project rule, an import skill, AGENTS.md/CLAUDE.md, or the built-in preamble | critical | judgment |
| `C3` | Prose needs a tool in `disallowed_tools`, an MCP server that is not attached or is excluded, memory when `memory_scope` is NONE/SESSION, or interactive approval on a sandbox backend | critical | judgment |
| `C4` | Two charters claim the same domain, or a handoff names an owner that is not in scope or does not exist | high | judgment |
| `C5` | Escalation target in prose differs from `reports_to`, or teammates hold incompatible pipeline rules | critical | judgment |
| `S1` | Single `.md` > 4096 B (medium) / > 10240 B (high) | medium | engine |
| `S2` | Total identity `.md` per agent > 12288 B (medium) / > 24576 B (high) | medium | engine |
| `S3` | `global-instructions.md` > 3072 B (medium) / > 6144 B (high) | medium | engine |
| `S4` | Import-mode skill > 4096 chars (engine). **Judgment adds:** large templates or reference tables in always-on docs. | high | both |
| `R1` | Same rule twice inside one agent. Engine: exact sentences. **Judgment:** paraphrases only. | medium | both |
| `R2` | Agent doc or agent rule repeats a global/role/project rule, global-instructions, an import skill, a workspace file, the built-in preamble, or the role prompt | medium | judgment |
| `R3` | Same text in ≥ 2 agents. Engine: exact sentences. **Judgment:** near-duplicates only. | medium | both |
| `R4` | Two DB rules restate the same constraint | low | judgment |
| `H1` | `pieges.md` present (engine). **Judgment adds:** a doc that expects `memory/*.md` to be injected. | low | both |
| `H2` | DB rule that names a deleted or renamed agent, an obsolete model, or a closed one-off incident | low | judgment |
| `H3` | Catalogue skill with 0 reads in 30 days (`timon-task`, `timon-worktree` excluded) | info | engine |
| `H4` | `<slug>.*` agent without that project in config; `reports_to` target missing; `reports_to` cycle; non-orchestrator project agent without `reports_to`; agent whose role maps to a project slot (code/review/merge/research/doc/chore) but holds no slot in `project_roles` | high | engine |
| `H5` | Standard doc (SOUL, system-prompt, charter, rules, style, directives) missing while a peer has it | low | engine |
| `K1` | **Missing skill.** Engine: an attachment points to a skill that is not in `skill_list` (high); an installed skill id (hyphenated, ≥ 6 chars) appears in a doc or in an applying DB rule but is not resolved for the agent. **Judgment:** prose names a skill that is not installed. | medium | both |
| `K2` | **Suggested skill.** Engine: read with `skill_get` ≥ 2 times in 30 days but not attached (low); attached to ≥ 50 % of ≥ 3 agents of the same role family (agent and role attachments) but not here (info). **Judgment:** the docs describe a recurring task that an installed skill covers (quote both). | low | both |
| `K3` | **Skill overhead.** Engine: catalogue descriptions > 2000 chars or > 10 catalogue skills for one agent (medium); import total > 8192 chars (high); the same skill reaches the agent through ≥ 2 attachments (low); catalogue skill body > 32768 B (low). **Judgment:** two attached skills overlap in purpose. | medium | both |
| `K4` | **Broken catalogue description**: an attached include skill whose `skill_list` description is < 40 chars, a bare YAML marker (`>` or `\|`), or ends with `,` `:` `;` `(`. The engine links it to the H3 finding of that skill. | medium | engine |

`M3`, `C4`, `C5` and `R3` apply only when ≥ 2 agents are in scope. Built-in skills `timon-task` and `timon-worktree` are excluded from all K and H3 checks. Estimated tokens are always `ceil(chars / 4)`. Always-on = global-instructions + identity `.md` + import skills + core-tier DB rules that apply (global, role = agent role, project = agent project, agent).

---

## 3. Judgment protocol (fixed order, fixed granularity)

Work agent by agent, in the order of `digest.md`. Then do the cross-agent passes. For each check, ask the questions below.

**C1.** For each doc, check every pair of bullets and sentences in the doc. Then check each pair of docs: SOUL↔rules, SOUL↔directives, charter↔rules, directives↔style, and each doc against the agent's DB rules. Ask: can the agent obey both? Look at scope, autonomy, tools, output format, tone and language.
**C2.** For each rule and directive of an agent, compare it with: the global/role/project rules (full text in `mcp.json`), global-instructions, AGENTS.md/CLAUDE.md, import skills, and the built-in preamble (the Kanban close, the question card, `kanban_plan`, delegation, memory). Ask: does the agent contradict a higher layer?
**C3.** For each tool, MCP server or capability that the prose names, compare it with the agent's `config.json`: `disallowed_tools`, `mcp_servers`, `excluded_mcp_servers`, `memory_scope`, and backend `permissionModel`.
**C4.** List every role or agent named after "escalate to", "delegate to", "hand off" or "owner". Each must be an in-scope agent or a real agent from `agentList`. Then compare all "You own" lists across the charters to find overlaps.
**C5.** For each agent, compare the escalation target named in its prose with its `reports_to`. Then compare the pipeline steps across teammates: who merges, who reviews, who closes.
**R1 / R3 (paraphrase only).** Same constraint, different words: within one agent (R1), or across agents (R3). Skip everything listed in the digest under "EXACT DUPLICATE SENTENCES".
**R2.** For each agent sentence, ask: does a higher layer already inject it (rule text, preamble, role prompt)?
**R4.** Compare each pair of DB rules whose scopes overlap.
**H2.** For each DB rule, look for a dated incident, an agent name or a model slug. Use `agentList` and `backends` to see whether it still exists.
**K1 (judgment part).** Find each phrase like "skill X", "apply X", "use the X skill" or "per your X file". If X is not in the installed list of `digest.md`, it is a missing skill.
**K2 (judgment part).** For each recurring task in directives.md or charter.md, look for an installed skill whose description covers it. Quote the doc line and the skill description. Do not suggest a skill only because peers have it: the engine does that.
**K3 (judgment part).** Compare the descriptions of every pair of skills attached to the same agent. If they overlap in purpose, one of them is overhead.
**Engine K findings.** Read every K1 and K2 engine finding. If one does not apply (for example, the id is a common word in that doc, or the role peers do other work), dismiss it with a one-line reason. Do not dismiss a finding only because it is inconvenient.
**M2 / S4 / H1 (judgment part).** Use the definitions in the catalog.

Granularity:
- **One finding = one check + one defect.** List every affected agent in `agents`.
- **The same defect with the same wording in N agents = one finding**, with all N agents. Quote one agent, and add a `note` that names the others.
- **R1: one finding per agent per topic.** A topic is one constraint stated in several places.
- **Severity:** keep the catalog default. To change it, set `sev` and give a one-line `severityJustification`. The report shows the change.
- **Recommendation:** name the source that wins: higher layer > rules.md > directives.md > charter.md > style.md > SOUL.md. Put the exact call in `fix`: `agent_update`, `agent_doc_put`/`agent_doc_rm` (never delete `system-prompt.md`), `memory_rule_rm`/`memory_rule_add`, `skill_attach`/`skill_detach`, `project_set_role`. The engine adds the badge "DB rule change → fresh_conversation" by itself.

---

## 4. Report structure (produced by the engine — for reference)

0. **Indicative-screening banner** (fixed text, always first; the render fails without it): findings are signals to verify, not proof; configuration only, not the smoking gun of an incident; a clean result is not a guarantee.
1. Header and metadata: scope, as-of, skill and engine version, agents, a summary of the live backends, environment notes, a table of the sources inspected with their status.
2. KPI strip: Agents audited, always-on weight (total, average, maximum), P0, P1, P2, P3/P4.
3. Reporting-chain SVG: in-scope agents, out-of-scope parents, dangling targets, cycles, ghost nodes, legend; click a node to filter. Then the inventory table with drawers: per-file size bars, config, memory folder, full text of every injected DB rule, resolved skills with their reads.
4–9. One section per category, in this order: 4 Models (M), 5 Contradictions (C), 6 Size (S), 7 Skills (K: a table of the resolved skills, catalogue and import weight, and the skills read but not attached), 8 Redundancies (R), 9 Hygiene (H) plus the action plan. Each has a **"checks evaluated" table** (every check ID with its method, default severity, finding count and evaluation note), then the collapsible finding tiles (importance, badge, check, ID, title, agent count, origin engine/judgment). Section 9 ends with the prioritized action plan and copy buttons.
Footer: engine version, input fingerprint (sha256 of collected + mcp + judgment), and the count of engine findings versus judgment findings.

---

## 5. Do not

1. Edit any agent doc, DB rule, skill, `config.json` or setting during the audit.
2. Write, patch or hand-tune the HTML. Change the inputs instead.
3. Skip a source or a check, or invent counts, quotes or models.
4. Treat `pieges.md` or `memory/*.md` as auto-injected.
5. Flag the built-in skills `timon-task` and `timon-worktree`, or the built-in MCP servers `timon` and `timon_ask`, as bloat.
6. Report again an exact duplicate that the engine already lists.
7. Dismiss an engine finding without a concrete reason, or dismiss a check that is not dismissible.
