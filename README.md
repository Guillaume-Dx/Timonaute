# Timonaute

My customizations and resources for [Timon](https://github.com/Guillaume-Dx/Timonaute), shared so you can reuse or adapt them.

> Timon is a local-first multi-agent platform. This repo holds the agent role models and skills I use with it.

## Contents

```
Agents/Models/<Role>/   Role models: one folder per agent role
Skills/<skill-id>/      Skills: one folder per skill, with a SKILL.md
roles/                  Custom role definitions and their directives
```

### Agent role models

Each role model is a folder of six markdown files that together define an agent:

| File | Purpose |
|---|---|
| `SOUL.md` | Identity: who the agent is and its level of experience |
| `system-prompt.md` | Mission and core instructions |
| `charter.md` | What the agent owns, and what it does not |
| `directives.md` | Step-by-step workflow |
| `rules.md` | Hard rules: what the agent must never do |
| `style.md` | Tone and report format |

Available roles:

| Group | Roles |
|---|---|
| Core team | Orchestrator, Coder, Reviewer, Merger |
| Design | SystemArchitect, DataArchitect, Writer |
| Support | Researcher, Troubleshooter |
| Risk | ThreatModeler, SecurityOfficer, Compliance |

### Custom roles

[`roles/`](roles/README.md) documents the five custom roles I define in `roles.json` (System Architect, Data Architect, Threat Modeler, Security Officer, Compliance Officer): their directives, default model and permission mode, and how to install them.

### Skills

See [`Skills/README.md`](Skills/README.md) for the inventory.

| Skill | Description |
|---|---|
| [`project-team-create`](Skills/project-team-create/SKILL.md) | Creates the agents of a project team from the role models and attaches them to a project, under the project orchestrator. |

## Usage

1. Copy the role models to a folder on your machine, for example `<TIMON_HOME>/Agents/models`.
2. Copy a skill folder from `Skills/` into your Timon skills folder (`<TIMON_HOME>/skills/<skill-id>/`).
3. Check the paths inside each `SKILL.md` and adapt them to your setup. `project-team-create` points to the role-models folder.
4. Ask an agent to use the skill, for example: "create a team for project X".

## Customizing

- Treat the role models as a starting point. Edit `rules.md` and `style.md` first: they change behavior the most.
- Keep the six file names. The `project-team-create` skill expects them.
- Role ids in the skill (`coder`, `reviewer`, `ops`...) must match the roles defined in your Timon setup.

## Contributing

Suggestions and fixes are welcome. Open an issue or a pull request.

## License

No license is set yet. Add one before reusing this content in your own projects.
