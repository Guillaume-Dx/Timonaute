# Timonaute

My customizations and resources for Timon, a local-first multi-agent platform. Shared so you can reuse or adapt them.

- **Timon web site:** [timon-ai.com](https://timon-ai.com)
- **Timon documentation:** [docs.timon-ai.com](https://docs.timon-ai.com)
- **Timon on GitHub:** [ai-timon/timon](https://github.com/ai-timon/timon)

## Overview

The repo has three parts that work together:

| Part | Folder | What it is |
|---|---|---|
| Agent models | [`Agents/Models`](Agents/Models) | 14 ready-made agent definitions, one folder per role. |
| Custom roles | [`roles`](roles/README.md) | Default directives, model and permission mode of the 7 custom roles in `roles.json`. |
| Skills | [`Skills`](Skills/README.md) | Packaged instructions for agents. Two skills today: `project-team-create` and `audit-token-context-consumption`. |

How they fit: a **role** gives an agent its default directives. An **agent model** is the full definition of an agent for that role. The **skill** `project-team-create` copies the agent models into a project and builds a team that reports to the project orchestrator.

## Agent models

Each agent model is a folder of six markdown files that define an agent:

| File | Purpose |
|---|---|
| `SOUL.md` | Identity: who the agent is and its level of experience |
| `system-prompt.md` | Mission and core instructions |
| `charter.md` | What the agent owns, and what it does not |
| `directives.md` | Step-by-step workflow |
| `rules.md` | Hard rules: what the agent must never do |
| `style.md` | Tone and report format |

| Group | Agent model | Role id | Defined in |
|---|---|---|---|
| Core team | Orchestrator | `orchestrator` | Built-in |
| | Coder | `coder` | Built-in |
| | Reviewer | `reviewer` | Built-in |
| | Merger | `merger` | Built-in |
| Design | SystemArchitect | `systemarchitect` | [`roles`](roles/README.md) |
| | DataArchitect | `dataarchitect` | [`roles`](roles/README.md) |
| | Writer | `librarian` | Built-in |
| Support | Researcher | `research` | Built-in |
| | Troubleshooter | `ops` | Built-in |
| Risk | ThreatModeler | `threatmodeler` | [`roles`](roles/README.md) |
| | SecurityOfficer | `securityofficer` | [`roles`](roles/README.md) |
| | ComplianceOfficer | `complianceofficer` | [`roles`](roles/README.md) |
| | DPO | `dpo` | [`roles`](roles/README.md) |
| | DataOwner | `dataowner` | [`roles`](roles/README.md) |

## Shared rules

Every agent model ends its `rules.md` with the same **Anti-loop rules** (strict), to keep agents from wasting time and budget:

- Stop after 2 failed attempts at the same action and ask the orchestrator.
- Do not wait actively: no sleep, no status polling.
- Do not relaunch a stuck task or agent: set it to BLOCKED and get the orchestrator's confirmation.
- Confirm before costly work: more than 3 Kanban tasks, parallel agents, long missions, resuming after a rate limit.
- On a rate limit, do not retry: report the resume time and wait.
- Do not start a mission or task that is already running.

## Custom roles and skills

- **Custom roles:** see [`roles/`](roles/README.md) for the directives, default model and permission mode of the seven custom roles, and how to add them to `roles.json`.
- **Skills:** see [`Skills/`](Skills/README.md) for the inventory.
  - `project-team-create` builds a project team from the agent models.
  - `audit-token-context-consumption` audits where tokens and context go and produces an HTML report. Its analyses are leads to investigate, not a verdict: they help you improve your configuration and your use of Timon. See [its README](Skills/audit-token-context-consumption/README.md).

## Usage

1. Add the custom roles to Timon ([steps](roles/README.md#install)).
2. Copy the agent models to a folder of your choice, outside the Timon home folder (for example `<WORKSPACE>/agent-models`).
3. Copy a skill folder from `Skills/` to `<TIMON_HOME>/skills/<skill-id>/`.
4. Ask an agent to use the skill and give it the models folder, for example: "create a team for project X, agent models in `<WORKSPACE>/agent-models`".

## Customizing

- Treat the agent models as a starting point. Edit `rules.md` and `style.md` first: they change behavior the most.
- Keep the six file names. The `project-team-create` skill expects them.
- Role ids in the skill must match the roles defined in your Timon setup.

## Versioning

The repo follows [Semantic Versioning](https://semver.org). [`manifest.json`](manifest.json) lists the repo version and the version of each skill, role and agent model. [`CHANGELOG.md`](CHANGELOG.md) lists the changes. Each release has a git tag `vX.Y.Z`.

| Change | Bump | Example |
|---|---|---|
| Incompatible: renamed or removed item, changed role id, changed file layout | Major | Rename an agent model folder |
| New item, or a new behavior that keeps existing use working | Minor | Add an agent model or a role |
| Fix or wording change with no change in behavior | Patch | Fix a typo in `rules.md` |

To release: bump the versions in `manifest.json`, add an entry to `CHANGELOG.md`, commit, then tag.

Version numbers are not stored inside the agent model files or in `roles.json`: Timon loads every `.md` file of an agent into its context, and a role accepts only its own fields.

## Contributing

Suggestions and fixes are welcome. Open an issue or a pull request.

## License

[MIT](LICENSE).
