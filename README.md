# Timonaute

My customizations and resources for Timon, a local-first multi-agent platform. Shared so you can reuse or adapt them.

## Overview

The repo has three parts that work together:

| Part | Folder | What it is |
|---|---|---|
| Agent models | [`Agents/Models`](Agents/Models) | 12 ready-made agent definitions, one folder per role. |
| Custom roles | [`roles`](roles/README.md) | Default directives, model and permission mode of the 5 custom roles in `roles.json`. |
| Skills | [`Skills`](Skills/README.md) | Packaged instructions for agents. One skill today: `project-team-create`. |

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
| | Compliance | `complianceofficer` | [`roles`](roles/README.md) |

## Custom roles and skills

- **Custom roles:** see [`roles/`](roles/README.md) for the directives, default model and permission mode of the five custom roles, and how to add them to `roles.json`.
- **Skills:** see [`Skills/`](Skills/README.md) for the inventory.

## Usage

1. Add the custom roles to `<TIMON_HOME>/roles.json` ([steps](roles/README.md#install)).
2. Copy the agent models to `<TIMON_HOME>/Agents/models`.
3. Copy a skill folder from `Skills/` to `<TIMON_HOME>/skills/<skill-id>/`.
4. Check the paths in each `SKILL.md` and adapt them to your setup.
5. Ask an agent to use the skill, for example: "create a team for project X".

## Customizing

- Treat the agent models as a starting point. Edit `rules.md` and `style.md` first: they change behavior the most.
- Keep the six file names. The `project-team-create` skill expects them.
- Role ids in the skill must match the roles defined in your Timon setup.

## Contributing

Suggestions and fixes are welcome. Open an issue or a pull request.

## License

No license is set yet. Add one before reusing this content in your own projects.
