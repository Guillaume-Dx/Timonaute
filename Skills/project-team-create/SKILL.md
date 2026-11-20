---
name: project-team-create
description: Create the agents of a project team from the agent models in <AGENT_MODELS_DIR> and attach them to the project, under the project orchestrator. Use when asked to create, add or staff agents or a team for a project, or to start a new project. Shows a card to choose the agents.
---

# Create a project team from the agent models

Each agent of a project team is a copy of one agent model. An agent model is a folder in `<AGENT_MODELS_DIR>` that holds six files: `SOUL.md`, `system-prompt.md`, `charter.md`, `directives.md`, `rules.md`, `style.md`.

Use the `timon` MCP tools only. Do not use a shell command. Do not write files in the Timon home folder.

## Main requirement

Create only agents that the project orchestrator can orchestrate. An agent obeys this requirement when these three conditions are true:

- its name starts with `<slug>.`
- its `project` is the project slug
- its `reports_to` is the project orchestrator

`<slug>` is the project slug. The project orchestrator is the agent of the project that has the role `orchestrator`.

Do not create an agent that reports to you, to another project, or to nobody. The only agent that reports to you is the project orchestrator.

## Agent models

| Card label | Model folder | Agent name | Role id |
|---|---|---|---|
| Orchestrator | `Orchestrator` | `<slug>.Orchestrator` | `orchestrator` |
| Coder | `Coder` | `<slug>.Coder` | `coder` |
| Reviewer | `Reviewer` | `<slug>.Reviewer` | `reviewer` |
| Merger | `Merger` | `<slug>.Merger` | `merger` |
| System Architect | `SystemArchitect` | `<slug>.SystemArchitect` | `systemarchitect` |
| Data Architect | `DataArchitect` | `<slug>.DataArchitect` | `dataarchitect` |
| Writer | `Writer` | `<slug>.Writer` | `librarian` |
| Researcher | `Researcher` | `<slug>.Researcher` | `research` |
| Troubleshooter | `Troubleshooter` | `<slug>.Troubleshooter` | `ops` |
| Threat Modeler | `ThreatModeler` | `<slug>.ThreatModeler` | `threatmodeler` |
| Security Officer | `SecurityOfficer` | `<slug>.SecurityOfficer` | `securityofficer` |
| Compliance | `Compliance` | `<slug>.Compliance` | `complianceofficer` |

Create only the agents of this table.

## Procedure

1. Find the project. Call `project_list`. Get the slug and the working directory of the project.
2. If the project is not registered, call `project_create` with `slug`, `name` and `cwd`. Do not set `with_orchestrator`. The `cwd` must be an existing absolute path. If you do not know the path, ask the user for it.
3. Call `agent_list`. Write down each agent whose name starts with `<slug>.`.
4. Find the project orchestrator. Use the section "Project orchestrator".
5. Show the card. Call the `question` tool with the questions of the section "Card". Leave out each agent that exists already. If a question has no agent left, leave out the question.
6. If the project has no orchestrator and the user chose one agent or more, create `<slug>.Orchestrator` first. Do steps 8 to 11 for it.
7. Create the other chosen agents. For each agent, do steps 8 to 11.
8. Read the six files of the model folder. If a file is missing, do not create the agent. Report the missing file.
9. Call `agent_create` with these values:
   - `name`: the agent name from the table.
   - `system_prompt`: the full text of `system-prompt.md`, not changed.
   - `cwd`: the working directory of the project.
   - `project`: the project slug.
   - `role`: the role id from the table.
   - `reports_to`: the name of the project orchestrator. For the project orchestrator, use your own agent name.
   - Do not set `backend`, `model`, `permission_mode`, `mcp_servers` or `allowed_tools`. The agent inherits them.
10. Call `agent_doc_put` five times, one time for each of `SOUL.md`, `charter.md`, `directives.md`, `rules.md`, `style.md`. Send the full text of the file, not changed.
11. Call `agent_doc_list` for the agent. The list must show the six files. If a file is missing, write it again one time.
12. Check the reporting lines. Use the section "Check".
13. Report the result. Use the section "Report".

## Project orchestrator

Look in the list of step 3 for the agents that have the role `orchestrator`.

- One agent: it is the project orchestrator. Use its exact name.
- More than one agent: use `<slug>.Orchestrator`. If this name is not in the list, ask the user which agent is the project orchestrator.
- No agent: the project has no orchestrator. You create `<slug>.Orchestrator` in step 6.

If the creation of the project orchestrator fails, stop. Do not create the other agents. Report the reason.

## Card

Each question is `multiSelect: true`. Use these headers, questions and options.

1. Header `Core team`. Question: "Which core agents do you want for `<slug>`?" Options: Orchestrator, Coder, Reviewer, Merger. Description of each option: "Recommended".
2. Header `Design`. Question: "Which design agents do you want for `<slug>`? They are optional." Options: System Architect, Data Architect, Writer, None.
3. Header `Support`. Question: "Which support agents do you want for `<slug>`? They are optional." Options: Researcher, Troubleshooter, None.
4. Header `Risk`. Question: "Which risk agents do you want for `<slug>`? They are optional." Options: Threat Modeler, Security Officer, Compliance, None.

Give each agent option a one-line description of what the agent does. The description of `None` is "Create no agent of this group".

If the project has no orchestrator, do not show the option Orchestrator. Replace the first question with this one: "Which core agents do you want for `<slug>`? The project has no orchestrator. I create `<slug>.Orchestrator` first, and the agents report to it." Options: Coder, Reviewer, Merger.

Only the core team is recommended. The agents of the groups Design, Support and Risk are optional. Do not recommend them. Do not create them unless the user chooses them.

How to read the answers:

- `None`, or no answer to a question: create no agent of that group. Do not ask again.
- `None` together with an agent: create the agent. Ignore `None`.
- No agent chosen in all the questions: create no agent, and no orchestrator. Report that.

## No user in the conversation

If an agent or the daemon started your mission, do not show the card. Create the agents that the request names. If the request names no agent, create the core team: Orchestrator, Coder, Reviewer, Merger. Do not add an agent of the groups Design, Support or Risk.

If the project has no orchestrator, create `<slug>.Orchestrator` first, also when the request does not name it.

If the project has more than one orchestrator and `<slug>.Orchestrator` is not one of them, create no agent. Report that you cannot identify the project orchestrator.

State each assumption in the report.

## Check

Call `agent_list` again. For each agent that you created:

- The `reports_to` of the project orchestrator must be your own agent name.
- The `reports_to` of each other agent must be the name of the project orchestrator.

If a `reports_to` is not correct, call `agent_update` with `name` and the correct `reports_to`. Do this one time. If it is not correct after that, report the agent as "Not orchestrated by the project orchestrator".

## Rules

- `agent_create` replaces an agent that has the same name. Do not create an agent that exists already, unless the user asked you to replace it.
- Do not change the `reports_to` of an agent that you did not create.
- Do not change the text of a model file. Do not shorten it. Do not add a project name to it.
- Do not use the docs of another agent as a source. The only source is `<AGENT_MODELS_DIR>`.
- A 403 answer is a refusal. Do not try the call again with other values. Report the agent and the reason.
- Do not start a mission for the new agents. Do not create Kanban tasks.

## Report

Give one table: agent name, role id, reports to, result (created, skipped because it exists, failed with the reason).

Then tell the user these three points:

- The name of the project orchestrator, and if you created it.
- The new agents have no MCP server of their own. The user attaches MCP servers in the Agents page.
- If the project orchestrator has a list set by hand in its Orchestration tab, that list does not include the new agents. Only the user can add them there.
