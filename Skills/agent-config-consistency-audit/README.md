# Agent Configuration Consistency Audit (`agent-config-consistency-audit`)

> **Version:** `2.2`  
> **Mode:** Strictly read-only  
> **Installed location:** `<TIMON_HOME>\skills\agent-config-consistency-audit\` (`SKILL.md`, `README.md`, `scripts\audit.js`; Node.js required)  
> **Output:** One self-contained, offline HTML report in `<cwd>\audits\agent-config-audit-<scope-slug>-<YYYY-MM-DD>.html`, plus an evidence trail in `<cwd>\audits\.work\<scope-slug>-<YYYY-MM-DD>\`

---

## ⚠️ Read this first: the report is indicative, not the truth

This audit is a **screening tool**. It tells you where to look. It does **not** prove what is wrong.

- **A finding is a signal, not a verdict.** A finding means the configuration *could* cause a problem. It does not prove that the problem happens, or that it caused a failure you saw. Check each finding before you act on it.
- **It does not necessarily show the smoking gun.** The audit reads configuration: identity docs, DB rules, skills, `config.json` and the model catalog. It does not read what agents actually did. The real cause of an incident can be in a mission trace, a backend error, a rate limit, a tool failure or the prompt of one task, and the audit does not see any of these. For an incident, start from the mission traces (`mission_search`, `trace_get`) or use `audit-token-context-consumption`. Use this audit to find the configuration side of the problem.
- **A clean report is not a healthy configuration.** "0 findings" means only that none of the fixed checks fired on the sources the audit could read.
- **"Deterministic" covers the method, not the conclusions.** Same inputs give a byte-identical report: the same checks, thresholds, order and layout. The judgment findings (contradictions, paraphrased duplicates, ownership gaps, skill fit) are still the opinion of the model that ran the audit. Another model, or another run, can word, group or weigh them differently.
- **The thresholds are conventions, not laws.** Size limits, the model-tier regexes, the "most role peers attach it" rule and the "broken description" rule are rules of thumb. They were chosen to be useful. They are not proven limits.

### Known blind spots
| Area | Limit |
|---|---|
| Built-in prompts | The Timon preamble and the built-in role prompts cannot be read locally (UI-only). Findings that quote them are marked *not machine-verified*. |
| Model checks | `M1` shows that a slug is not in the live catalog. It does not show what the backend does with that slug at spawn time: refuse it, or fall back to another model. |
| Token estimates | `ceil(chars / 4)` is an approximation. Catalogue weight counts the full description, but Timon can truncate the description at injection, so the value is an upper bound. |
| Skill reads | `skill_reads` counts only `skill_get` calls. When a backend opens a skill file by itself, the read is not counted, so `H3` (unused) and `K2` (read but not attached) can be wrong. |
| Peer adoption (`K2`) | The check compares agent-scope and role-scope attachments only. It ignores project-scope attachments of peers, and a peer of the same role can do very different work. |
| Name matching (`K1`) | A skill id that appears in prose as an ordinary phrase (for example "doc-structure file") can be a false positive. Dismiss it with a reason. |
| Runtime state | The audit cannot see MCP servers that fail to connect, expired sign-ins, the state of the Kanban dispatcher, or what one mission received in its prompt. |

---

## How it works

The skill has two parts: a **deterministic engine** and a **validated judgment file**.

| Step | Who | What |
|---|---|---|
| 1. Phase A | Agent | Writes raw `agent_list`, `backends_list`, `project_list` and `project_roles` outputs into `<work>\mcp.json`. |
| 2. Collect | Engine | `node audit.js collect --home <TIMON_HOME> --work <work>`. It selects the agents with a fixed rule, measures every file-based source, lists the exact duplicate sentences, and writes `collected.json` and `digest.md`. |
| 3. Phase B | Agent | Adds raw DB rules, `memory_show`, `skill_resolve`, `skill_reads`, import-skill sizes, `skill_list` and `skill_attachment_list` to `mcp.json`. Then it runs `collect` again, so that `digest.md` lists the installed skills. |
| 4. Judgment | Agent | Reads `digest.md` and writes `judgment.json`: judgment findings with verbatim quotes, one note per judgment check, and optional dismissals of heuristic engine findings. |
| 5. Render | Engine | `node audit.js render --work <work> --out-dir <cwd>\audits`. It validates the inputs, runs the mechanical checks, merges, sorts, numbers, writes the HTML and checks it. |
| 6. Deliver | Agent | Shows the report with `ui_render` and gives a short summary with the top 3 actions. |

`render` refuses to write a report when:
- a quote is not found verbatim in the collected text;
- a judgment check has neither a finding nor a note;
- an engine-only check is written by hand;
- a severity is changed without a justification;
- an MCP key is missing (use `{"status":"not accessible","reason":"…"}` when a tool failed);
- a dismissal targets a check that cannot be dismissed, or matches nothing.

Same inputs give a byte-identical HTML file. The footer shows the input fingerprint and how many findings came from the engine and how many from judgment.

---

## Supported scopes

| Mode | Selection rule (applied by the engine) | `<scope-slug>` |
|---|---|---|
| `single` | Exact name from `agent_list` | `agent-<name>` |
| `team` | The agents listed in `scope.targets` | `team-<first>-plus-<N>` |
| `orchestrator` | The orchestrator and every agent below it through `reports_to` (direct and transitive) | `tree-<orchestrator>` |
| `project` | `config.project == <slug>`, OR name starts with `<slug>.`, OR listed in `project_roles(slug)` | `project-<slug>` |

---

## What is inventoried

- **Shared layers:**
  - the live backend and model catalog;
  - `global-instructions.md`;
  - global, role and project DB rules (full text);
  - project reference memory;
  - workspace CLI files (`AGENTS.md`, `CLAUDE.md`, `.github\copilot-instructions.md`, `.github\instructions\*.instructions.md`);
  - all installed skills and all skill attachments.
- **Per agent:**
  - every root `*.md` identity doc;
  - agent DB rules;
  - resolved skills (import and catalogue) and their 30-day reads;
  - the memory folder (dead `pieges.md`);
  - `config.json` (backend, model, permission mode, memory scope, tools, MCP servers);
  - the role prompt (UI-only).
- **Always-on weight:** `global-instructions + identity .md + import skills + core-tier DB rules`. The catalogue lines, normal-tier rules and workspace files are shown in separate columns.

---

## Check catalog

Findings are sorted by severity (`P0` → `P4`), then category (`M` → `C` → `S` → `K` → `R` → `H`), then first affected agent, check ID and title.

| Category | Checks | Owner |
|---|---|---|
| **M — Provider & model** | `M1` slug not in the catalog, unknown backend or signed out (critical) · `M2` model tier does not fit the role (medium) · `M3` coder and reviewer use the same model (medium) | engine (+ judgment for permission-model conflicts) |
| **C — Contradictions** | `C1` inside one agent, with `[intra-file]` · `C2` between layers · `C3` config versus prose · `C4` ownership overlap or gap · `C5` workflow or reporting conflict | judgment |
| **S — Size** | `S1` one doc > 4 KB / 10 KB · `S2` docs per agent > 12 KB / 24 KB · `S3` `global-instructions.md` > 3 KB / 6 KB · `S4` import skill > 4 KB, or templates in always-on docs | engine (+ judgment for embedded templates) |
| **K — Skills** | `K1` **missing**: attached but not installed (high), or named in prose or a rule but not attached · `K2` **suggested**: read ≥ 2 times but not attached, attached to most role peers, or matches a task the docs describe · `K3` **overhead**: catalogue > 2000 chars or > 10 skills, imports > 8 KB, the same skill through several attachments, a skill body > 32 KB, overlapping skills · `K4` **broken catalogue description** (linked to `H3`) | engine + judgment |
| **R — Redundancies** | `R1` inside one agent (exact: engine; paraphrase: judgment) · `R2` repeats a higher layer · `R3` copied across agents · `R4` overlapping DB rules | engine + judgment |
| **H — Hygiene** | `H1` dead `pieges.md` · `H2` stale DB rule · `H3` catalogue skill with 0 reads in 30 days · `H4` hierarchy, project or role-slot drift · `H5` incomplete doc set | engine (+ judgment for `H1` and `H2`) |

Only the heuristic engine checks `K1`, `K2`, `R1` and `R3` can be dismissed, each with a written reason. The report shows the reason in the "checks evaluated" table of the section.

---

## Report (9 sections, fixed layout)

Every report opens with a fixed **"Indicative screening — verify before acting"** banner that sums up the warning above. The engine refuses to write a report without it, and the chat summary ends with the same caveat.

1. **Header and metadata:** scope, as-of time, skill and engine version, live backends, environment notes, the sources inspected with their status.
2. **KPI strip:** agents audited, always-on weight (total, average, maximum), and finding counts from P0 to P4.
3. **Reporting chain and inventory:** the inline SVG diagram (out-of-scope parents, cycles, ghost nodes for missing escalation targets; click a node to filter), then the inventory table. Each agent has a drawer with size bars, config, memory folder, the full text of every injected DB rule, and its skills with their reads.
4. **Models (M)**, including an evaluation matrix.
5. **Contradictions (C)**.
6. **Size (S)**.
7. **Skills (K)**, including a table of resolved skills, catalogue and import weight, and skills read but not attached.
8. **Redundancies (R)**.
9. **Hygiene (H)** and the **prioritized action plan**. Each action has a copy button. DB rule changes are flagged because they start a fresh conversation for the affected agents.

Each section opens with a **"checks evaluated" table**: every check, its method, its default severity, its finding count, and a note on what was compared. A check with 0 findings is shown with this note. It is never left out.

The report is fully offline: inline CSS, JavaScript and SVG, no external URLs. It works in a browser and inside Timon's `ui_render`.

---

## How to use

1. **Attach the skill** in catalogue mode: `skill_attach(skill: "agent-config-consistency-audit", scope: "agent", target: "<AgentName>", mode: "include")`.
2. **Ask for an audit:**
   - *"Audit all agents of project `<slug>` with `agent-config-consistency-audit`"*
   - *"Audit the agents reporting to `Zeus`"*
   - *"Audit `Chiron`"*
3. **Read the report critically.** Start with the P0 and P1 findings. For each one, open the evidence and confirm it before you change anything (see the warning at the top).
4. **Apply the changes in a separate step.** The audit never changes anything. Use the tool named in each action: `agent_update`, `agent_doc_put`, `memory_rule_add` / `memory_rule_rm`, `skill_attach` / `skill_detach`, `skill_put` or `project_set_role`.

---

## Guardrails

- **Read-only.** The audit does not edit docs, DB rules, skills, `config.json` or settings.
- **No hand-made report.** Only the engine writes the HTML. The agent changes inputs, never the output.
- **No silent omissions.** Every source is listed as `ok`, `not present` or `not accessible`.
- **No false bloat.** The built-in skills `timon-task` and `timon-worktree`, and the built-in MCP servers `timon` and `timon_ask`, are excluded.
- **No legacy assumptions.** `pieges.md` and `memory/*.md` are never treated as injected.

---

## Changelog

| Version | Highlights |
|---|---|
| **`2.2`** | A fixed "Indicative screening — verify before acting" banner at the top of every report, enforced by the render self-check. The chat summary ends with the same caveat. |
| **`2.1`** | New category **K — Skills**, with section 7 of 9. K1: missing skills (attached but not installed, or named in prose but not attached). K2: suggested skills (read on demand but not attached, adopted by role peers, or matching a described task). K3: skill overhead (catalogue weight, import total, redundant attachment routes, very large bodies, overlapping skills). K4: broken catalogue descriptions, linked to the H3 finding of the same skill. New inputs: `skillList` and `skillAttachments`. `judgment.dismiss` rejects a heuristic finding (K1, K2, R1, R3 only) with a reason that the report shows. The inventory gains a Catalogue column. The README now explains that the report is indicative and lists the known blind spots. |
| **`2.0`** | Bundled deterministic engine `scripts/audit.js` (collect / render). The engine does scope selection, measurement, the mechanical checks (M1, M2 tier rule, M3, S1–S4, exact R1/R3, H1, H3–H5), sorting, IDs and the HTML. Judgment findings go through a validated `judgment.json` (verbatim quotes verified, a note required for each judgment check, severity changes justified). A "checks evaluated" table in each section, an engine/judgment origin on each tile, an input fingerprint, and an evidence trail in `audits\.work\`. H4 now checks only the role slots that dispatch uses (orchestrator and ops excluded). |
| **`1.2`** | Added the offline inline `<svg>` reporting-chain diagram (ghost nodes for broken prose escalations, click-to-inspect) in section 3. |
| **`1.1`** | Full DB rule text everywhere, intra-file contradiction and redundancy detection (`[intra-file]`), provider/model-to-role evaluation (`M1`–`M3`), collapsible finding tiles with `P0`–`P4` badges. |
| **`1.0`** | First read-only audit protocol (`C1`–`C5`, `S1`–`S4`, `R1`–`R4`, `H1`–`H5`) and a 7-section offline HTML report. |
