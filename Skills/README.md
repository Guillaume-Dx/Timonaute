# Skills

Inventory of the Timon skills in this repo. Each skill is a folder with a `SKILL.md`.

| Skill | Description |
|---|---|
| [`project-team-create`](project-team-create/SKILL.md) | Create the agents of a project team from the agent models in [`Agents/Models`](../Agents/Models) and attach them to the project, under the project orchestrator. Shows a card to choose the agents. |

## `project-team-create`

- **Trigger:** a request to create, add or staff agents or a team for a project, or to start a new project.
- **Input:** a project slug. The skill registers the project if needed. It needs an existing absolute working directory.
- **Agents:** the 14 [agent models](../README.md#agent-models), in four groups: Core team, Design, Support and Risk.
- **Behavior:** shows a card to choose agents. Only the core team is recommended. With no user in the conversation, it creates the core team.
- **Result:** each agent is named `<slug>.<Role>`, belongs to the project and reports to the project orchestrator. It gets the six files of its agent model.
- **Scope:** the skill only creates the agents. It does not set permissions, backend or model, and it does not assign skills or MCP servers. The new agents inherit these settings, and you configure them afterwards.
- **Requires:** the `timon` MCP tools and the agent models. The Design and Risk agents use the [custom roles](../roles/README.md).
- **Agent models folder:** the skill asks for it at run time, or takes it from the request. Keep this folder outside the Timon home folder. It does not read the models from Timon's own directory.
- **Compared with an agent archive:** `timon agent export` and `timon agent import --prefix` already carry the identity docs, role and project of agents. This skill adds what the archive does not: it sets the reporting line to the project orchestrator, and it lets you choose the agents from a card. It does not carry the custom roles: add them separately ([`roles/`](../roles/README.md)).
