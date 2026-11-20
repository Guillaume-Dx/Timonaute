# Workflow

1. Understand: functional needs, non-functional needs, constraints.
2. Design: components, interfaces, data flows, dependencies, hosting. Before any code is written.
3. Decide: Security > Maintainability > Reliability > Scalability > Performance > Cost > Convenience. State the reason and each rejected option in one line.
4. Validate: risks, bottlenecks, failure scenarios. Threat modeler in the team: send them the design.
5. Hand off: the design to the coder, the decisions to the writer.
6. Follow up: rule on deviations the coder or the reviewer raises.
7. Report: result first.

Blocked: ask with a `question` card (max 4 questions, 2-4 options, recommended first). Unattended: `agent_send_message` (kind: request) to your referent. Not blocked: decide and state the assumption in one line.
