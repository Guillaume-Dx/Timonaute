# audit-token-context-consumption

A Timon skill that finds **where the tokens and context of a project go**,
proves it with numbers, and proposes fixes that **lower** consumption (fewer
tokens) or **slow** it (the same work spread out: fewer rate limits,
fallbacks and cache rewrites). The result is one self-contained HTML report.

Version 4.0 (method 4.0, rules 4.0). The instructions for the agent are in
[`SKILL.md`](SKILL.md); this file is for the people who use it.


> **Leads, not proof.** The analyses of this skill are not meant to find the smoking gun. They are leads to investigate, to improve your own configuration (agents, skills, MCP servers, models) and the way you use Timon. A finding says where to look first. Check it against your own use of Timon before you change anything.

## Purpose

- Show what a project's agents spend, mission by mission and turn by turn, and
  why: what each spawn carries (identity docs, skills, memory rules, MCP
  servers), how long sessions grow, when missions switch backend, and which
  providers and models carry the cost.
- Turn that into ranked, detailed fixes: where to change what, the expected
  saving, the effort, the risk, and the number to re-measure.
- Find what **Timon itself** could do better (bugs and improvements in its
  code), with a ready-to-copy prompt to open an issue on the Timon repository.
- Do it the **same way every time**: the same inputs, rules, thresholds,
  ranking and report layout, so two audits can be compared.

The audit only reads. It never changes an agent, a skill, an MCP server, a
series, a setting or any code, and it never opens an issue.

## When to use it

- The quota runs out faster than expected, or rate limits and fallbacks
  appear often.
- A project's missions feel slow or expensive, or an orchestrator's chat has
  become very long.
- After changing a team (models, skills, MCP servers, pipelines): run it
  before and after to measure the effect.
- Regularly (for example weekly) on the busiest projects, to catch drift.
- Before reporting a Timon problem about cost or context: the report gives
  the evidence and the issue prompt.

Not for: a live incident (a crashed mission, a blocked task: use a
troubleshooting skill), or a project with no activity in the window.

## What you get

`audits/token-audit-<project>-<date>.html` in the working folder of the agent
that ran it, shown in the chat, with:

1. KPI tiles and a summary of the main drivers.
2. **What was analysed**: eight areas (spawn weight, MCP servers,
   orchestration, context growth, backend switches, quota and provider, cost
   visibility, Timon code), each with "No finding", "Not analysed" or its
   findings coloured by their weight on consumption.
3. Chronology: cost per turn over time, cost per hour, every backend switch,
   cache rewrite, compaction, rate limit and crash.
4. Consumption per provider and per model.
5. Spawn weight per agent, outliers, findings.
6. Timon code analysis: bugs and improvements, each with an issue prompt.
7. Fixes as detailed cards, ranked by saving.
8. Gaps ("not investigated") and an appendix with every table.

The snapshot folder (in the OS temp folder) keeps every input; the footer of
the report gives the window, the method and rules versions and an input
digest.

## How to use it

### Requirements

- A Timon agent with the built-in `timon` MCP server, a shell, **Node.js 18+**
  and the `timon` CLI on the PATH (or its path given to the scripts).
- Read access to the Timon home (`~/.timon`).
- For the Timon code analysis: a checkout of the Timon source registered as a
  project. Without it, that row says "Not analysed".
- Nothing else: no Python, no network, no extra package.

### Attach the skill

Attach it to the agent that will run audits (Skills tab, Catalogue mode is
enough: the agent reads it when asked). A troubleshooting or research agent
is a good fit; avoid attaching it to busy orchestrators or coders.

### Ask for an audit

Name the project (and, if you want, the window or a fixed end time). The agent
then runs the four scripts in order:

| Step | Script | Does |
| --- | --- | --- |
| 1 | `fetch.js` | Saves a snapshot of every input through the `timon` CLI |
| 2 | `collect.js` | Builds the chronology, the per-provider view and the peer groups |
| 3 | `analyze.js` | Applies the 16 fixed rules: findings, fixes, summary |
| 4 | `report.js` | Validates the auditor's additions and renders the HTML |

Between steps 3 and 4 the agent walks the checklist for causes the rules
cannot see and reads Timon's code; it may add findings, never remove or
re-rate the base ones.

You can also run the scripts yourself (paths relative to this folder):

```
node scripts/fetch.js   --project <slug> --as-of 2026-11-24T06:00:00Z --out <work>
node scripts/collect.js --snapshot <work>
node scripts/analyze.js --snapshot <work>
cp <work>/findings.base.json <work>/findings.json     (copy on Windows; then fill code_scope)
node scripts/report.js  --snapshot <work> --out audits/token-audit-<slug>-2026-11-24.html
```

### Read the report

Treat the report as a list of leads, not as a verdict: a fix card is a hypothesis to test, not a proven cause. Start with **What was analysed** and the fix cards. Each fix says whether it
lowers or slows consumption, where to apply it, and what to re-measure.
Apply the fixes in the app (or through a Kanban task), wait for a few days of
activity, then audit again with a new window and compare.

## Recommendations

### Which model to run it under

The scripts do the counting, so the model matters for the parts that need
judgement: the checklist of causes, the Timon code analysis and the wording
of the fixes and issue prompts.

| Use | Recommended | Why |
| --- | --- | --- |
| Full audit with Timon code analysis | **Claude Opus 5.5** (`claude-opus-5-5`) | Reads unfamiliar code well, separates a confirmed bug from a lead, keeps the method under pressure. |
| Routine re-audit (same project, no code reading) | **Claude Sonnet 5.5** (`claude-sonnet-5-5`) | The rules do most of the work; Sonnet follows the procedure reliably at a lower cost. |
| Codex models | Possible | Works if the agent has a shell and the `timon` CLI; check the output once against a Claude run. |
| Small models (Haiku and similar) | Not recommended | Tend to skip the checklist or paste raw data into the context. |
| Backends without Timon tools or a shell (gateways) | Do not use | The skill and its scripts would be pasted whole into every prompt and cannot run. |

Pick the model ids from `backends_list` on your install; the names above are
the ones offered on this install at the time of writing.

### Good practice

- **Run it in its own mission** (or a Kanban research task), not inside a
  long orchestrator chat: the audit reads a lot and would grow that session.
- **Fix the end time** (`as-of`) when you want to compare runs; keep the
  snapshot folders of the periods you compare.
- **One project per run.** For a team that spans projects, run once per
  project.
- **Let the rules decide** severities and ranking; add context with notes and
  extra findings, and dismiss a base finding only with a reason.
- **Review issue prompts before running them**: they ask the agent to show a
  draft, remove personal data and wait for your confirmation. Security
  problems go to the private advisory link, never to a public issue.
- Re-audit after each batch of fixes and check the "verify" metric of each
  card.

### Sample prompts

Full audit of a project:

> Audit the token and context consumption of project `timon-projects-onsteroids`
> over the last 7 days, with the audit-token-context-consumption skill. Include
> the Timon code analysis.

Fixed window, to compare with an earlier run:

> Run the token/context audit on project `<slug>` with as-of
> 2026-11-24T06:00:00Z and a 7-day window. Keep the snapshot folder and give me
> its path.

One expensive task:

> Kanban task `<task id>` cost far more than its peers. Run the token/context
> audit on its project, starting one hour before the task, and explain what
> made it expensive.

Before / after a change:

> I switched the Writer's skills to Catalogue and moved doc tasks to Haiku on
> 2026-11-24. Audit project `<slug>` for the 7 days before and the 7 days after
> that date, and compare the two reports.

Quick re-audit, no code reading:

> Re-run the token/context audit on project `<slug>` for the last 7 days. Skip
> the Timon code analysis (mark it "not investigated") and list only what
> changed since the previous report.

Unattended (Kanban research task or routine):

> Weekly: run the token/context audit on project `<slug>` (7 days, as-of = the
> start of this run). Do not ask questions; state assumptions in the report.
> Post the report path and the top 3 fixes with `timon notify report`.

## Files

| File | Role |
| --- | --- |
| `SKILL.md` | The method, for the agent: data traps, checklist, rules table, procedure, report schema |
| `scripts/fetch.js` | Step 1: snapshot of the inputs |
| `scripts/collect.js` | Step 2: chronology, providers, peer groups |
| `scripts/analyze.js` | Step 3: fixed rules, base findings and fixes |
| `scripts/report.js` | Step 4: validation and HTML report |

To change the method, change `SKILL.md` and the scripts together and raise
the version numbers (`METHOD_VERSION` in `fetch.js`, `RULES_VERSION` in
`analyze.js`, `version` in the `SKILL.md` header). Reports made with different
versions are not comparable.
