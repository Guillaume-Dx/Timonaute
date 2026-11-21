---
name: project-team-create
description: Create the agents of a project team from the agent models folder and attach them to the project, under the project orchestrator. Use when asked to create, add or staff agents or a team for a project, or to start a new project. Shows a card to choose the agents.
---

# Create a project team from the agent models

Each agent of a project team is a copy of one agent model. An agent model is a folder inside the agent models folder. The user chooses this folder (see step 1). It holds six files: `SOUL.md`, `system-prompt.md`, `charter.md`, `directives.md`, `rules.md`, `style.md`.

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
| Compliance Officer | `ComplianceOfficer` | `<slug>.ComplianceOfficer` | `complianceofficer` |
| Data Protection Officer | `DPO` | `<slug>.DPO` | `dpo` |
| Data Owner | `DataOwner` | `<slug>.DataOwner` | `dataowner` |

Create only the agents of this table.

## Procedure

1. Find the agent models folder. Use the folder that the user named in the request. If the user named none, ask for it with the `question` tool (free text). The folder must exist and must hold the model folders of the table. If no user is in the conversation and no folder is named, create no agent and report that the folder is missing.
2. Find the project. Call `project_list`. Get the slug and the working directory of the project.
3. If the project is not registered, call `project_create` with `slug`, `name` and `cwd`. Do not set `with_orchestrator`. The `cwd` must be an existing absolute path. If you do not know the path, ask the user for it.
4. Call `agent_list`. Write down each agent whose name starts with `<slug>.`.
5. Find the project orchestrator. Use the section "Project orchestrator".
6. Show the card. Call the `question` tool with the questions of the section "Card". Leave out each agent that exists already. If a question has no agent left, leave out the question.
7. If the project has no orchestrator and the user chose one agent or more, create `<slug>.Orchestrator` first. Do steps 9 to 12 for it.
8. Create the other chosen agents. For each agent, do steps 9 to 12.
9. Read the six files of the model folder, inside the agent models folder. If a file is missing, do not create the agent. Report the missing file.
10. Call `agent_create` with these values:
   - `name`: the agent name from the table.
   - `system_prompt`: the full text of `system-prompt.md`, not changed.
   - `cwd`: the working directory of the project.
   - `project`: the project slug.
   - `role`: the role id from the table.
   - `reports_to`: the name of the project orchestrator. For the project orchestrator, use your own agent name.
   - Do not set `backend`, `model`, `permission_mode`, `mcp_servers` or `allowed_tools`. The agent inherits them.
11. Call `agent_doc_put` five times, one time for each of `SOUL.md`, `charter.md`, `directives.md`, `rules.md`, `style.md`. Send the full text of the file, not changed.
12. Call `agent_doc_list` for the agent. The list must show the six files. If a file is missing, write it again one time.
13. Check the reporting lines. Use the section "Check".
14. Report the result. Use the section "Report".

## Project orchestrator

Look in the list of step 4 for the agents that have the role `orchestrator`.

- One agent: it is the project orchestrator. Use its exact name.
- More than one agent: use `<slug>.Orchestrator`. If this name is not in the list, ask the user which agent is the project orchestrator.
- No agent: the project has no orchestrator. You create `<slug>.Orchestrator` in step 7.

If the creation of the project orchestrator fails, stop. Do not create the other agents. Report the reason.

## Card

Each question is `multiSelect: true`. Use these headers, questions and options.

1. Header `Core team`. Question: "Which core agents do you want for `<slug>`?" Options: Orchestrator, Coder, Reviewer, Merger. Description of each option: "Recommended".
2. Header `Design`. Question: "Which design agents do you want for `<slug>`? They are optional." Options: System Architect, Data Architect, Writer, None.
3. Header `Support`. Question: "Which support or security agents do you want for `<slug>`? They are optional." Options: Researcher, Troubleshooter, Threat Modeler, Security Officer.
4. Header `Privacy`. Question: "Which privacy agents do you want for `<slug>`? They are optional." Options: Compliance Officer, Data Protection Officer, Data Owner, None.

The groups Support and Risk share the cards 3 and 4 because the `question` tool accepts at most 4 questions with 4 options each: Support is Researcher and Troubleshooter. Risk is Threat Modeler, Security Officer, Compliance Officer, Data Protection Officer and Data Owner. Question 3 has no `None` option: no answer means no agent.

Give each agent option a one-line description of what the agent does. The description of `None`, when the question has it, is "Create no agent of this group".

If the project has no orchestrator, do not show the option Orchestrator. Replace the first question with this one: "Which core agents do you want for `<slug>`? The project has no orchestrator. I create `<slug>.Orchestrator` first, and the agents report to it." Options: Coder, Reviewer, Merger.

Only the core team is recommended. The agents of the groups Design, Support and Risk are optional. Do not recommend them. Do not create them unless the user chooses them.

How to read the answers:

- `None`, or no answer to a question: create no agent from that question. Do not ask again.
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
- Do not use the docs of another agent as a source. The only source is the agent models folder.
- A 403 answer is a refusal. Do not try the call again with other values. Report the agent and the reason.
- Do not start a mission for the new agents. Do not create Kanban tasks.

## Report

Give one table: agent name, role id, reports to, result (created, skipped because it exists, failed with the reason).

Then tell the user these three points:

- The name of the project orchestrator, and if you created it.
- The new agents have no MCP server of their own. The user attaches MCP servers in the Agents page.
- If the project orchestrator has a list set by hand in its Orchestration tab, that list does not include the new agents. Only the user can add them there.
