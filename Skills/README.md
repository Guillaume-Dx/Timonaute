# Skills

Inventory of the Timon skills in this repo. Each skill is a folder with a `SKILL.md`.

| Skill | Description |
|---|---|
| [`project-team-create`](project-team-create/SKILL.md) | Create the agents of a project team from the role models in [`Agents/Models`](../Agents/Models) and attach them to the project, under the project orchestrator. Shows a card to choose the agents. |

## `project-team-create`

- **Trigger:** a request to create, add or staff agents or a team for a project, or to start a new project.
- **Input:** a project slug. The skill registers the project if needed. It needs an existing absolute working directory.
- **Agents:** 12 role models in four groups: Core team (Orchestrator, Coder, Reviewer, Merger), Design (SystemArchitect, DataArchitect, Writer), Support (Researcher, Troubleshooter), Risk (ThreatModeler, SecurityOfficer, Compliance).
- **Behavior:** shows a card to choose agents. Only the core team is recommended. With no user in the conversation, it creates the core team.
- **Result:** each agent is named `<slug>.<Role>`, belongs to the project and reports to the project orchestrator. Each agent gets the six files of its role model.
- **Requires:** the `timon` MCP tools and the role models. The Design and Risk agents use the [custom roles](../roles/README.md).
- **Placeholder:** `<TIMON_HOME>` in `SKILL.md` stands for your Timon home folder.
