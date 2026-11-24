---
name: audit-token-context-consumption
description: Audit why Timon burns too many tokens or fills context too fast. Use when asked to trace the cost of a Kanban task, a mission, all missions of a project, or a team of agents, or to check agent roles, identity docs, skills (catalogue vs import), MCP servers, spawn and retry patterns, provider behaviour, CLI versions, the project code that spawns missions, and the chronology of consumption and context switches. Output is a self-contained HTML report.
metadata:
  author: Guillaume-Dx
  version: "4.0"
compatibility: Designed for Claude Code, GitHub Copilot or Codex agents that hold the built-in `timon` MCP server (read tools only), a shell with Node.js 18+ and the `timon` CLI. Read access to `~/.timon`, `~/.claude`, `~/.copilot`, `~/.codex` improves the "outside Timon" checks.
---

# Purpose

Find **where** extra tokens and context come from, **prove it with numbers**,
and propose fixes. This skill only reads. It never changes an agent, a skill,
an MCP server, a series or a setting.

Every claim in the report needs a source: a tool output, a file path, a span id
or a doc route. If a fact cannot be measured, write "not measured" — do not guess.

The audit has three views, and the final output is **one HTML file**:

1. **Configuration** — what every spawn pays (identity, skills, MCP, memory, models).
2. **Chronology** — how the cost moves over time: context growth, compactions,
   backend switches, cache rewrites, rate limits, crashes (section 3.6), and
   **consumption per provider and model** (section 3.6.1).
3. **Timon code** — where the Timon platform itself makes agents spend more
   than needed (injection, tool payloads, fallbacks, handovers, compaction,
   chained tasks, measurement gaps), with changes to propose to Timon (section 3.7).

Four scripts sit next to this file (`scripts/`). They carry the method: run them
in this order, every time, with no step skipped or replaced by hand.

| Step | Script | Input | Output |
| --- | --- | --- | --- |
| 1 | `fetch.js` | `timon` CLI + Timon home (read only) | a **snapshot** folder: tasks, traces, agents (config, docs, skills, reads, rules), memory, MCP, backends, doctor, series, routines, triggers, CLI versions, `manifest.json` (window, as-of, hashes, input digest) |
| 2 | `collect.js` | the snapshot | `data.json`: missions, per-turn chronology, context-switch events, hourly buckets, consumption per provider and model, peer groups, coverage, model drift |
| 3 | `analyze.js` | the snapshot + `data.json` | `findings.base.json`: findings from the fixed rules (4.1), spawn weight, outliers, notes, ranked fixes, summary |
| 4 | `report.js` | `data.json` + `findings.base.json` + your `findings.json` | the HTML report; **refuses** a `findings.json` that breaks the method (0.1) |

# 0.1 Same method, same report — every time

Two audits of the same scope must use the same method and produce the same
report. The rules:

1. **One unit of analysis: a project and a time window.** Default window: the
   7 days before `--as-of`. A request about one task or one mission becomes its
   project, with `--since` one hour before the task (or mission) started; name
   the task or mission in the summary. A team of agents spanning projects = one
   run per project.
2. **Every input comes from `fetch.js`.** No MCP read, no hand-picked trace, no
   sample. The snapshot is the evidence: keep the folder.
3. **Replay = same snapshot.** `collect.js`, `analyze.js` and `report.js` are
   deterministic: on the same snapshot and the same `findings.json` they write
   byte-identical files. Fetching again gives newer data by design; to compare
   two periods, keep both snapshots.
4. **Findings, severities, ranking, fixes and the summary come from the rules**
   (`analyze.js`, section 4.1). Start `findings.json` as a copy of
   `findings.base.json`. You may:
   - add: findings with new ids, `code_scope` and `code_findings` (3.7), lines to
     `not_investigated`, sharper numbers in a fix's `saving` (keep the basis);
   - dismiss a base finding or fix: `"status": "dismissed"` plus a `"reason"`
     (it stays visible, out of the ranking).
   You may not: remove or rename a base finding or fix, change a base
   severity, or reorder. `report.js` checks this and writes nothing if it fails.
5. **Fixed wording.** Keep the base `summary`; to add context, append at most one
   sentence. Use the vocabulary of this skill (lowers / slows, confirmed /
   lead, bug / improvement, "not measured").
6. **Fixed output name:** `<cwd>/audits/token-audit-<project>-<as-of date>.html`.
   The footer carries the window, method, rules and report versions and the input digest.
   From report 4.1, the HTML shows no mission or trace ids: `report.js` replaces each
   id (full or 8-character, also inside findings text) with "Agent · mission title"
   from `data.json`. In `findings.json`, keep writing the 8-character ids: they are
   resolved at render time. Issue prompts get `<mission>` instead (no private names).
7. **Change the method only by changing this skill** (scripts and version). A
   report made with another `method_version` or `rules_version` is not comparable.

# 0. Know what the numbers mean (read first)

The data has traps. Check these before you compare anything.

| Signal | Where | Trap |
| --- | --- | --- |
| `cost_usd` per `turn` span | `trace_get` | Most reliable cost signal on Claude. Use it as the main metric. |
| `tokens_in` / `tokens_out` | `trace_get` (turn spans, `aggregates`) | On Claude, `tokens_in` counts only **uncached** input. A turn can show `tokens_in: 2` and still cost $0.33 because of cache reads and writes of a large prompt. Never rank by `tokens_in` alone. |
| `null` tokens and `cost_usd: 0` | turns run on Copilot (and other backends that report no usage) | Means **not measured**, not free. Use proxies: number of tool spans, payload size, turn duration, number of turns. |
| `cost_usd: 0` with a large, growing `tokens_in` | turns run on Codex | Codex reports a **cumulative** token counter per session, not per turn, and no cost. Use the deltas as a rough proxy only. |
| Mission `total_cost_usd` | `trace_get` missions list | Often `null` even when its turn spans carry cost. Sum the turn spans; `collect.js` does it and says which source it used. |
| Subscription backends | `backends_list` `subscription` note | Claude, Codex and Copilot run on subscriptions: `cost_usd` is a notional figure. The real limit is quota and rate limits — a disruption is a cost even at $0. |
| Context gauge | chat UI ring (window used / size) | Shows live fullness. Red from 40 %, compaction advised at 80 % (doc `/usage/missions`, "Compacting a conversation"). |
| Spawn weight | **Agent injections** widget / Skills tab "Context injected at spawn" | What every new mission of the agent pays before the first word. |
| Quota | LLM Quota widget | "Unknown usage" means no probe, not 0 %. |

`trace_get` returns at most 500 spans — the **latest** 500 (`spans_total`, `spans_truncated`).
`aggregates` covers all of them. Report the coverage per trace (cost in visible
turn spans ÷ aggregate cost); `collect.js` computes it.
The effective model of a task is in the task (`effective_backend`, `effective_model`),
not in the agent's `config.json`: series roles and fallbacks override it.

# 1. Scope

The scope is always **a project and a time window** (0.1 rule 1). State it in
the first line of the report (the base `scope` and `summary` do).

| Request | Run |
| --- | --- |
| One Kanban task | `kanban_get <id>` for its project and creation time → `fetch.js --project <its project> --since <created − 1 h>`; name the task in the summary. |
| One mission | Same, with the mission's agent project and start time. |
| A project | `fetch.js --project <slug>` (7 days by default). |
| A team of agents | One run per project of the team; compare the reports. |

Unattended run and unclear scope: the project of the agent that asked, 7 days.

# 2. Protect your own context while auditing

The audit itself can blow up context. Rules:

- To look at one detail the snapshot lacks, `trace_get` with `compact=true` only (one compact trace of 57 spans is already ~25 KB); it never replaces the snapshot.
- Never call `mission_status view=full` on a long mission. Use `view=status`.
- Do not grep a whole vault or `~/.timon` with output mode "content". Use counts or file lists, then read one file.
- Save big outputs to a file and extract numbers with a script. Do not paste them into the chat.
- Get every input with `fetch.js` (CLI into files), never through MCP into your context: `kanban_list` returned 4 MB for 815 tasks.
- `<work>` is the snapshot folder in the OS temp directory: `audit-<project>-<as-of date>`. Use Node.js for any extra parsing; Python may be absent.
- To read the data, print small extracts of `data.json` / `findings.base.json` with `node -e`. Never print a whole file.

# 3. What to collect

## 3.1 Spawn weight (paid by every mission of the agent)

Timon injects, in this order (doc `/usage/agents`, "See what an agent is given at start"):

1. Timon preamble and backend description
2. Global instructions (Settings)
3. `SOUL.md`, **every other `.md` file in the agent folder**, the role prompt, the custom directives
4. `system-prompt.md`, then the skills: **imported** skills in full, **catalogue** skills one line each
5. Memory: global digest, curated rules (project, role, agent), recent pitfalls

`fetch.js` saves, per agent of the project, `agents/<name>.json`: config,
every `.md` in its folder with its size, resolved skills (mode, origin, sizes),
skill reads over 30 days and agent rules; `memory.json` holds the project,
role and global rules. `analyze.js` turns them into the spawn-weight table.
Look yourself for: stray `.md` files (notes, drafts, copies: each is
injected) and a customised role prompt ("Modified" applies to every agent with
that role). The "Context injected at spawn" total (Skills tab, Agent injections
widget) is not in the snapshot: ask the user to read it, or list it in
`not_investigated`.

## 3.2 Per mission

From the snapshot traces (`data.json` → `missions`):
- Number of turns, `cost_usd` per turn, total cost, duration.
- Tool spans: count, the tools with the most calls, `status: error` count (failed calls repeated = paid twice).
- Repeated identical calls (same tool name, same short interval).
- Parent and child missions (`parent_mission_id`), chained tasks, `forked_from`.
- Mission fields: `backend_override`, `model_override`, `reasoning_effort`, `extra_skills`, `extra_mcp_servers`, `interrupted_reason`.

## 3.3 Orchestration

- `series.json` (series roles and fallbacks per series in the window): the model per role and per group, and the fallback chains.
- `routines.json`, `triggers.json`: how often each one fires, and whether a broad filter matches too many events.
- `pipeline_list`, `workflow_list`: the fan-out per run.
- The Orchestration tab of the agent: who it may hand work to.

## 3.4 Tools and MCP

- `mcp.json` and each agent's `mcp_servers` (in `agents/<name>.json`).
- Built-in servers are always present (`timon`, `timon_ask`, `timon-browser`, `grepai`) and cannot be removed. Do not report them as a defect.
- On Claude Code, the claude.ai connectors and `~/.claude.json` / project `.mcp.json` / plugin servers are loaded by the CLI itself (badges "claude.ai" and "claude (local config)"). Kanban task agents lose the claude.ai connectors unless their role lists them.

## 3.5 Provider and CLI

- `backends.json`: the backends and models that are really installed.
- `doctor.json`: the binaries and their state.
- `cli/versions.json`: Timon, Claude Code, Codex and Copilot versions read from the CLIs ("not found" = not installed or not on the PATH).
- The configured model in `config.json` compared to the model the mission really ran (`model_override`, the turn spans).

## 3.6 Chronology and context switching

`collect.js --snapshot <work>` (procedure step 3) builds this view from the snapshot.

It prints the totals (missions, turns, no-cost turns, switches, disruptions,
cache-rewrite cost). Then read `data.json` with small scripts — never whole.

What it detects, per mission, from the ordered turn spans:

| Event | Rule | Checklist link |
| --- | --- | --- |
| `switch_out` / `switch_back` | Turns stop / start reporting cost inside one mission | E1, E5 |
| `start_unmeasured` | First turn has no cost although the agent is set to Claude | E5, D8 |
| `cache_rewrite` | Turn with ≤ 100 output tokens that costs ≥ max($0.30, half the mission median), after a switch back or after an idle gap (`--idle-min`, default 10) | E1, E7 |
| `context_drop` | Cost per turn falls below 40 % of the previous turn | E6 (a compaction, a summary handover or a new session) |
| `rate_limit`, `crash`, … | Mission `interrupted_reason` (`killed` is a normal task end and is skipped) or status `failed` | E4, E5, F3, F4 |
| Segment growth | Inside a run of measured turns, max cost ÷ first cost (`max_growth`) | E6, F6 |
| Likely trigger (`cause`) | Nearest disruption of another mission 15 min before to 10 min after a switch | E5 — a correlation, not a proof |

Also look at, in `data.json`:
- `hours`: cost, turns, missions started and disruptions per hour. Bursts of
  disruptions followed by switches point at shared quota.
- `model_drift`: configured model → model that really ran, with counts.
- `groups`: peer groups (agent · task type · backend/model) with medians.

Write the 3–5 most telling moments as `chronology_notes` (time, what happened,
the number).

### 3.6.1 Consumption per provider and model

`collect.js` writes `by_backend` (per provider) and `by_model` (per provider/model):
missions, missions without turn spans, turns, inferred turns, recorded cost and
share, tokens in and out, disruptions and median mission length. `hours[].by_backend`
gives turns per hour per provider.

How a run is attributed (read this before you quote a number):
- **Mission:** its own `backend_override` / `model_override` (the run that
  happened) → the task's `effective_backend` / `effective_model` when on the same
  backend (series roles land there) → the agent's `config.json`. Do not use the
  task's effective model alone: a retry on a fallback rewrites it.
- **Turn:** turn spans carry no model id, and a running chat's override is its
  *current* one. A turn that reports cost ran on a cost backend
  (`--cost-backends`, default `claude`); a no-cost turn inside a mission that is
  now on a cost backend is `fallback (not identified)`. The `inferred_turns`
  column counts turns attributed this way. To name the fallback, read
  `series_fallback_list` and the global fallback setting, and say it is inferred.
- **Cost:** turn spans, plus `total_cost_usd` for missions without turn spans
  (`cost_from_mission_totals`). Providers that report no cost show "not reported",
  never $0.
- **Tokens:** never compare across providers. Claude `tokens_in` = uncached input
  only (summed); Codex = cumulative session counter (last value per mission).
  The `tokens_in_method` field says which.

Questions to answer with it: which model carries most of the recorded cost; which
models run many missions with no cost visibility (F7); whether mechanical roles
run on expensive models (D8); which provider collects the disruptions (E5, F3);
whether fallbacks carry a large share of the turns (E1, E5). Write them as
`provider_notes`.

## 3.7 Timon code analysis

Goal: find where **Timon itself** (the platform, not the projects it runs)
makes agents spend more tokens or context than needed, and propose changes to
Timon. The data of 3.1–3.6 shows *what* is expensive; the code shows *why* and
where a fix in Timon would remove it for every user.

**Where the code is.** The Timon source repository: find it with `project_list`
(the project whose folder holds `orchestrator/src/agent.ts`). Read its
`AGENTS.md` first. If the install has no source checkout, write "Timon code: not
investigated" and stop this section. Read only: never build, test or run
anything there (`orchestrator/dist/` is what the live daemon runs).

**Method.**
1. Start from a measured finding, never from the code. Take each finding,
   outlier or chronology event from 3.1–3.6.
2. Find the deciding code with a search on the names the data shows (a field
   such as `interrupted_reason` or `effective_model`, a message such as
   "Conversation recovered", a title prefix such as `doc:`, a tool name). Use
   file lists or counts, then read only the function (`agent.ts` alone is
   about 6,500 lines).
3. State the current behaviour with `file:line`, why it costs tokens, how often it
   runs (from the data), the change you propose, and the expected saving.
4. Mark each finding **confirmed** (the code path and the data agree) or **lead**
   (plausible, not proved: say what would prove it).

**Where to look** (paths under `orchestrator/`; verify they still exist):

| Id | Area | Start with | What to check |
| --- | --- | --- | --- |
| T1 | Spawn injection | `src/agent.ts` (preamble, role prompt, identity docs, skills import vs catalogue, memory digest and rules) | Size of each injected block; text repeated across blocks; content that every mission gets but few need; parts that could be catalogue or on-demand. Compare with the spawn weight measured in 3.1. |
| T2 | Tool catalogue | `bin/timon-mcp-catalog.mjs`, `bin/timon-mcp.mjs`, `src/backends/mcp-preapproved.ts` | Number and length of tool descriptions and schemas. On CLIs that do not defer schemas, they are sent on every turn. |
| T3 | Tool payloads | the handlers behind the tools seen in the traces (`kanban_list`, `kanban_add`, `kanban_get`, `kanban_update`, `trace_get`, `mission_status`) | Missing `limit` / pagination / project filter / field selection; write tools that echo the full row (description, comments) back; default output larger than an agent needs. Use the output sizes from 3.2 (`tool_output_bytes`). |
| T4 | Fallback and switch | `src/backend-fallback.ts`, `src/backend-breaker.ts`, `src/backend-recheck.ts` | What moves a mission to another backend (a rate limit on *another* agent of the same account?); when it moves back; whether the round trip could be avoided or delayed (each return rewrites the whole prompt cache). Match with `switch_out` / `cache_rewrite` events and their likely triggers. |
| T5 | Handover and recovery | `src/summary.ts` and the replay/handover code it is called from | What the new backend receives (full history, a summary, a size cap); whether the summary is reused or rebuilt on every switch. |
| T6 | Compaction and session lifecycle | `src/backends/capabilities.ts` (`nativeCompact`), compaction and idle-reap code in `src/agent.ts` and `src/dispatcher.ts` | Whether long chat missions are ever compacted without the user; thresholds; whether an idle reap forces a cold cache on the next turn. Match with `max_growth` and `context_drop`. |
| T7 | Chained work | `src/task-chain.ts`, `src/verification-loop.ts`, `src/doc-task.ts` | When review, merge and doc tasks are created; whether the observed count matches the rules (for example doc tasks after reviews, or docs closed with nothing written); skip rules that could apply. |
| T8 | Wake-ups of the pilot | `src/dispatcher.ts`, `src/agent-pair-breaker.ts` | Each task return wakes the orchestrator for a turn on its whole context: are returns batched? Count pilot turns that only acknowledge a return. |
| T9 | Prompt-cache stability | the prompt assembly in `src/agent.ts` | Dynamic text (dates, ids, counters, live lists) placed before stable text breaks the provider cache on every turn (F5). |
| T10 | Measurement gaps | `src/trace-view.ts`, the turn-span writer | 500-span cap (latest only); no model id on turn spans; mission `total_cost_usd` left `null`; cumulative Codex counters stored as-is. Each gap hides cost from users; propose the field or the fix. |

Each code finding needs: `file:line`, the area (T1–T10), the measured finding it
explains, confirmed or lead, frequency, the proposed change and the expected
saving. The owner is the Timon maintainers: a change goes through a pull request
on the Timon repository (its `AGENTS.md`). Do not edit Timon code yourself.

# 4. Checklist of causes

For each item write **Found / Not found / N/A**, the evidence, and the estimated
impact (tokens, $, or % above the peer median).

## A. Identity and role (paid on every turn of every mission)
- A1. Large or duplicated identity docs. The same rules in `SOUL.md`, `rules.md`, the role prompt and the global instructions.
- A2. Stray `.md` files in the agent folder that are injected by mistake.
- A3. A customised role prompt that grew large. The cost is multiplied by every agent with that role.
- A4. Many or long memory rules. Many `core` tier rules. Rules duplicated across scopes.
- A5. A role that gets work outside its charter, so the task bounces between agents (each bounce pays a new spawn).

## B. Skills
- B1. Skills in **Import** mode that are not needed on every task. Import pastes the whole text into every prompt; catalogue costs one line until `skill_get`.
- B2. Skills attached at a wide scope (every agent, project, role) that only a few agents use. Check with `skill_reads`: a catalogue skill with 0 reads is dead weight or has a bad description.
- B3. A catalogue skill read many times per mission (`reads` much higher than `missions` in `skill_reads`). The agent re-reads it; consider splitting or importing a short core.
- B4. A backend with no access to Timon's tools or files (for example a Hermes gateway). There, **catalogue skills are pasted whole**, plus their text files up to 64 KB per skill.
- B5. Per-mission skills added by Timon (`timon-task`, `timon-worktree`) are always imported. Count them in the task spawn weight, but do not report them as a defect.
- B6. Duplicate skills: the same content under two ids, or a Timon copy plus the CLI's own copy (for example `~/.copilot/skills`, `~/.claude/skills`, project `.claude/skills`).
- B7. `extra_skills` on `mission_spawn` or on Kanban tasks that add skills by habit.

## C. MCP servers
- C1. Servers attached to an agent that no skill or role mentions and that no trace shows in use.
- C2. Servers with a large tool catalogue when the agent uses one or two tools. Note: Claude Code can defer tool schemas (ToolSearch); other CLIs may send all schemas on every turn. Say which case applies.
- C3. Tools that return raw, unpaginated payloads (full HTTP bodies, whole files, whole tables, `view=full` transcripts).
- C4. A server that fails to connect at each spawn (timeout messages in the transcript).
- C5. `extra_mcp_servers` on spawns or tasks.

## D. Orchestration and spawn patterns
- D1. `mission_spawn` for work that 2–5 direct tool calls could do. Each spawn pays the full spawn weight again.
- D2. Deep nesting: missions that spawn missions. Measure the depth through `parent_mission_id`.
- D3. The same goal spawned several times instead of `mission_send` to the existing mission. Look for an `idempotency_key` on repeated spawns.
- D4. Agent ping-pong: `request` messages back and forth. Timon holds a pair after 30 messages in 30 minutes (`TIMON_WAKE_PAIR_MAX_MESSAGES`, `TIMON_WAKE_PAIR_WINDOW_MS`). A pair near that limit is a finding.
- D5. Review → fix → review loops on Kanban: count the chained tasks per original task in the trace.
- D6. Routines or triggers that fire too often or match too broadly.
- D7. Thinking level or `reasoning_effort` set high on agents that do simple work.
- D8. An expensive model on a role that does mechanical work (merger, docs) in `series_role_list`.

## E. Session lifecycle (context rebuilt or replayed)
- E1. **Backend or model switch** during a conversation: the new model gets the whole history, or a summary written by the old model (doc `/usage/missions`, "Choosing a model").
- E2. **Native session unavailable**: Timon replays the recorded conversation, or a summary of it, up to the handover limit. Look for the card or for "Conversation recovery" at the top of the prompt.
- E3. **Memory rule changes**: removing, rewording or rescoping a rule forces a **fresh conversation** for every agent the rule could reach at its next mission. Frequent rule edits on global or role scope = many fresh conversations.
- E4. Automatic retries for unattended missions: up to 3 retries (Settings → AI models → Circuit breaker), each in the same session. Count "Timon retry n/3" lines.
- E5. Model at capacity or quota exhausted → move to the fallback backend → the task runs again there.
- E6. Long missions never compacted while the gauge is above 80 %. On backends other than Claude and Grok, compaction opens a new conversation.
- E7. Idle reap (10 min default) and a later message: the process restarts. If the provider prompt cache has expired, the full prompt is written to the cache again. Look for a high `cost_usd` on the first turn after a pause.
- E8. The Silent-turn and Turn-budget settings (45 min / 4 h by default) set too high, so a looping turn is not stopped.

## F. Outside Timon (provider and CLI)
- F1. **Files the CLI reads by itself**: `AGENTS.md` / `CLAUDE.md` in the working folder and parent folders, CLI user memory (for example `~/.claude/projects/<cwd>/memory/MEMORY.md`), hooks output. Timon does not count these in the spawn weight.
- F2. **CLI-native skills and MCP** (`~/.claude/skills`, plugins, `~/.claude.json`; `~/.copilot/skills`, the Copilot MCP config; `~/.codex/config.toml`). They add to Timon's own.
- F3. **Version drift**: different versions of the same CLI on different machines or after an update, or a model id the CLI rejects. A rejected model gives a fast crash and a retry loop (see the known Copilot cases with dotted model ids).
- F4. **Local state corruption** that crashes every spawn after a few seconds (for example the Copilot `.mcp-writer.lock` case). Each crash is short, but retries and fallbacks multiply them.
- F5. Prompt-cache misses: content that changes at the top of the prompt between turns. Timon puts stable text first and memory last; a custom directive or doc with a date or counter in it breaks this.
- F6. Context window size: a 1 M window delays compaction, so every turn re-reads a much longer history.
- F7. Backends that report no usage. The cost exists but Timon cannot see it. Say this in the report.
- F8. A permission refusal that the agent retries with small changes (on Copilot, the refusal is immediate and the retry never helps).

## 4.1 Fixed rules (analyze.js, rules 4.0)

| Id | Rule | Severity |
| --- | --- | --- |
| E6 | A mission costing ≥ $1 with `max_growth` ≥ 2 | critical if those missions hold ≥ 30 % of the recorded cost, else serious |
| E5 | ≥ 1 `switch_out` | serious |
| R1 | ≥ 1 `rate_limit` | serious from 3, else warning |
| B1 | An imported skill > 8 KB | serious if the agent ran ≥ 10 missions in 30 days, else warning |
| D5 | Doc tasks ÷ code tasks > 1 | serious if ≥ 25 % of doc tasks wrote nothing, else warning |
| D8 | A merge or doc mission on an Opus or Sonnet model | warning |
| F3 | ≥ 1 crash, or a model id that `backends` does not offer | serious from 3 crashes, else warning |
| E7 | ≥ 1 cache rewrite after an idle pause | warning |
| C4 | An attached MCP server whose `last_status` is failed | serious if attached to ≥ 3 agents, else warning |
| C1 | An attached MCP server never seen in tool spans | warning |
| A1 | Identity docs > 12 KB | warning |
| A4 | > 10 core memory rules reach an agent | warning |
| B2 | A catalogue skill with 0 reads over ≥ 10 missions | warning |
| D5b | A review at iteration ≥ 3 | warning |
| D7 | Reasoning effort high or above on a merger, librarian or reviewer | info |
| F7 | ≥ 50 % of missions without measured cost | info |

Order: severity, then the id order of this table, then id. Fixes: the most
severe finding they answer, then effort (S before M before L), then title.
Outliers: missions costing ≥ $1 with a peer ratio ≥ 3 or `max_growth` ≥ 2, at
most 10, by cost. Data quality: trace coverage < 80 %, turns without cost,
missions without turn spans. Change a threshold only in `analyze.js` and raise
`RULES_VERSION` and this table together.

## T. Timon code (section 3.7)
- T1–T10 from the table in 3.7. Rank by frequency × saving: a cost paid on every spawn or every turn beats one paid per project setup. Only confirmed findings get a severity above `warning`.

# 5. Procedure

Run it in this order, every time. `<skill>` is this skill's folder; `timon` is
the CLI (pass `--timon <path>` if it is not on the PATH).

1. **Scope and time.** Run `date`. Name the project (0.1 rule 1) and the as-of
   time (now, floored to the minute, unless the user gives one).
2. **Fetch:** `node <skill>/scripts/fetch.js --project <slug> --as-of <ISO> [--days 7 | --since <ISO>] --out <work>`.
   Check `failed_commands` in its output: a failed input goes to `data_quality`.
3. **Collect:** `node <skill>/scripts/collect.js --snapshot <work>`.
4. **Analyse:** `node <skill>/scripts/analyze.js --snapshot <work>`. Read its
   one-line output (finding ids and severities), then small extracts of
   `findings.base.json`.
5. **Check step 0** for each backend in scope; anything the rules cannot see
   goes to `data_quality` or `not_investigated`.
6. **Walk the checklist A–F** (section 4) against the snapshot. A cause the rules
   did not catch becomes an added finding with a new id (`X1`, `X2`…), its
   evidence and a fix.
7. **Timon code (3.7):** start from the base findings, in their order; write
   `code_scope` and `code_findings`, each with its issue object (6.2, 6.3).
8. **Write `<work>/findings.json`** from `findings.base.json` (0.1 rule 4).
9. **Render:** `node <skill>/scripts/report.js --snapshot <work> --out <cwd>/audits/token-audit-<project>-<as-of date>.html`.
   If it refuses, fix `findings.json` (never the rules) and render again.
10. **Look at it** once (section 6), then show it with `ui_render` and answer in at
    most 5 lines: scope and window, the top 2–3 drivers with numbers, the
    number of fixes and of issue prompts, the file path and the snapshot folder.

Fixes are proposals. The owner applies them (the user in the app, or an
authorised agent through a Kanban task). Issues are never opened by the auditor.

# 6. Report (final output: HTML)

The final output is **one self-contained HTML file**, rendered by step 9 of the
procedure:

```
node <skill>/scripts/report.js --snapshot <work> --out <cwd>/audits/token-audit-<project>-<as-of date>.html
```

`<cwd>` is your own working folder (create `audits/` if needed). Then:
- show it with `ui_render` (`path` = the absolute HTML path, a short `title`);
- in the chat, give at most 5 lines: the scope, the top 2–3 drivers with numbers,
  and the file path. The tables live in the HTML, not in the chat.

The report opens with KPI tiles, the summary and **What was analysed**: one row
per area of the method, always the same eight rows in the same order — Spawn
weight (A, B), MCP servers (C), Orchestration (D), Context growth (E2–E4, E6–E8),
Backend switches (E1, E5), Quota and provider (R1, F3, F4, F8), Cost visibility
(F1, F2, F5–F7), Timon code (code findings) — plus "Other causes" when the
auditor added findings. Each row says what was examined (with counts) and its
status: "No finding" (green), "Not analysed" (gray, for Timon code when
`code_scope` says so), or the count of open findings per severity, coloured by
the worst one. The colour is the weight on consumption as the rules define it
(critical = the largest driver, serious = a clear, repeated waste, warning =
small or rare, info = context). In the Timon code row, a confirmed bug counts as
serious and a lead or an improvement as warning. Dismissed findings do not count.

Then: data quality with trace coverage,
**chronology chart** (cost per turn over time, top 3 missions coloured, others
gray, no-cost turns in their own lane, switches and disruptions marked, gray
bands = time on a no-cost backend), cost per hour, **consumption per provider
and model** (cost bars per model coloured by provider, turns per hour stacked
by provider, a table per provider and per provider/model), the
**context-switching table**, spawn weight, outliers, findings, **Timon code analysis** with bugs and improvements and a copyable issue prompt for each, ranked fixes as detailed cards, gaps,
and an appendix (peer groups, configured vs actual model, top missions, every
turn as a table).

`findings.json` schema (every field optional except `scope` and `summary`):

```json
{
  "scope": "project <slug> (n agents, n series)",
  "date": "YYYY-MM-DD",
  "question": "the question the audit answers",
  "summary": "2-3 sentences: the main drivers, with numbers",
  "data_quality": ["backend: which metric is valid", "what is not measured"],
  "chronology_notes": ["time: what happened, with the number"],
  "provider_notes": ["provider/model: share of cost, missions with no cost visibility, disruptions"],
  "spawn_weight": [{"agent": "", "backend_model": "", "docs": "", "imported": "", "catalogue": "", "rules": "", "mcp": "", "total": ""}],
  "outliers": [{"mission": "", "turns": 0, "cost": "", "peer": "", "ratio": "", "cause": ""}],
  "findings": [{"id": "E6", "severity": "critical|serious|warning|info", "area": "", "finding": "", "evidence": "", "impact": "", "fix": "", "owner": ""}],
  "code_scope": "Timon repository path, version or commit, modules read",
  "code_findings": [{"id": "TC1", "file": "orchestrator/src/x.ts", "line": 26, "pattern": "T4 Fallback and switch", "status": "confirmed|lead", "kind": "bug|improvement", "finding": "", "evidence": "the measured finding it explains + the code fact", "frequency": "per spawn | per turn | per task | per switch", "fix": "the change to Timon", "expected": "(bug)", "actual": "(bug)", "repro": ["(bug) step"], "version": "(bug)", "problem": "(improvement)", "proposal": "(improvement)", "issue": {"type": "bug|feature", "title": "", "repo": "owner/repo"}, "owner": "Timon maintainers (pull request)"}],
  "fixes": [{"title": "", "effect": "lowers|slows|both", "kind": "config|process|timon-code", "where": "", "steps": [""], "saving": "", "frequency": "", "effort": "S|M|L", "risk": "", "verify": "", "refs": [""], "owner": ""}],
  "not_investigated": ["what is missing and why"]
}
```

## 6.1 Fixes in detail

A one-line fix is not enough. Each fix in `fixes` is an object:

| Field | Content |
| --- | --- |
| `title` | The change, as an action ("Compact the Orchestrator at 60 %") |
| `effect` | `lowers` (fewer tokens in total), `slows` (same work, spread out: fewer rate limits, fallbacks and cache rewrites) or `both` |
| `kind` | `config` (a setting in the app), `process` (how work is split, piloted or scheduled), `timon-code` (needs a change to Timon) |
| `where` | The exact place: app page and field, tool and arguments, or `file:line` |
| `steps` | 2–5 concrete steps the owner can follow |
| `saving` | Estimated saving with its basis ("~$40 per series: turns 30–68 cost $1.2–2.2 instead of ≤ $0.9") |
| `frequency` | How often the saving repeats (per spawn, per turn, per task, per series, per week) |
| `effort` | `S` (minutes, one setting), `M` (an hour, several agents), `L` (code change) |
| `risk` | What could get worse (quality, lost context, slower work) and how to limit it |
| `verify` | The metric to re-measure after the change and its target (`max_growth` < 2, 0 `switch_out` per day, Writer spawn weight < 10 KB) |
| `refs` | Finding ids it answers (`E6`, `B1`, a code finding id) |
| `owner` | Who applies it |

Rank: first by saving × frequency, then by lowest effort. Put at least one
`slows` fix when the data shows rate limits or switches: spreading the load
(fewer parallel Opus tasks, staggered series, cheaper model for mechanical
roles) often prevents the fallbacks that make everything else more expensive.

Typical levers (use them only when the data supports them):
- **Lower:** compaction or one session per stage for long pilots (E6); catalogue
  instead of import (B1); fewer chained tasks (D5); cheaper model on mechanical
  roles (D8); detach unused MCP servers (C1, C4); shorter identity docs (A1).
- **Slow:** cap concurrent tasks on the expensive model; stagger series; keep the
  pilot on a different account or model than the workers so a worker rate limit
  does not move the pilot (E5); raise the idle reap only when a pause is short
  (E7); batch task returns to the pilot (T8).

## 6.2 Bugs and improvements to Timon

Each code finding (3.7) gets `kind`:
- `bug`: Timon does not do what its own code comments, docs or rules say
  (for example a skip rule that does not skip, a filter that is ignored, a
  number that is wrong). Add `expected`, `actual`, `repro` (steps on a test
  install or from the data, no real secrets) and `version` (the first line of `timon` run with no argument,
  for example "Timon 0.1.9").
- `improvement`: Timon works as designed but the design costs tokens. Add
  `problem` and `proposal`.

A security issue is never a public issue: say "report privately" and point to
the security link in the Timon repository's `.github/ISSUE_TEMPLATE/config.yml`.

## 6.3 Follow-up issue prompts

For each bug or improvement worth reporting, add an `issue` object to the code
finding: `{ "type": "bug|feature", "title": "...", "repo": "<owner>/<repo>" }`.
Take `repo` from the Timon repository: the upstream named in
`.github/ISSUE_TEMPLATE/config.yml` or the `origin` remote (not a personal fork).
`report.js` turns it into a ready-to-copy prompt that follows the repository's
issue template (bug: What happened, Steps to reproduce, Timon version, System,
`timon doctor`, Logs; feature: The problem, What you would like, Could it be a
plugin?). The prompt tells the agent who runs it to show the draft, remove
personal data, and wait for the user's confirmation before `gh issue create`.

In the chat, mention the number of issue prompts ready; never open an issue
yourself: an issue is public as soon as it is created.

Severity: `critical` = the largest driver or a cost that repeats on most
missions; `serious` = a clear, repeated waste; `warning` = small or rare;
`info` = context only.

Before you hand it over, open the HTML once and look at it (the browser tool
opens only http(s) pages: serve the folder with a one-off Node server that exits
by itself after a few minutes, or rely on `ui_render`). Check label overlap,
empty sections and that the numbers match `data.json`.

# 7. Do not

1. Do not change configuration, skills, MCP servers, memory rules or settings. (Changing a memory rule also resets conversations — that adds cost.)
2. Do not leave the declared scope.
3. Do not report "high" without a number and a peer comparison.
4. Do not read `tokens_in` on Claude as the total input.
5. Do not read `null` or `0` on Copilot as "free".
6. Do not give CLI versions or model ids from memory. Read them from `backends_list`, `doctor`, `config.json` or the CLI.
7. Do not report the built-in MCP servers or the per-task skills (`timon-task`, `timon-worktree`) as defects.
8. Do not edit, build or test Timon's code. Code findings are proposals for the Timon maintainers, through a pull request.
9. Do not paste `data.json`, traces or task lists into the chat or into `findings.json`. Quote numbers.
10. Do not present a "likely trigger" correlation as a proven cause.
11. Do not load external fonts, scripts or images in the report: it must open offline.
12. Do not open, comment on or push anything to an issue tracker or a repository. Write the issue prompt; the user decides.
13. Do not put personal data in an issue prompt: no user names in paths, e-mail addresses, private project or agent names, or ids that identify the user's work. Use placeholders.
