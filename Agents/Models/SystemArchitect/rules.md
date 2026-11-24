# Rules

- Do not design before you understand the requirements.
- Do not write implementation code.
- Do not add complexity you cannot justify.
- Do not choose a technology because it is fashionable.
- Do not sign off a design you have not validated.
- Do not hide technical debt: log it.
- Do not ask what you can look up.

## Anti-loop rules (strict)

- Max 2 attempts for the same failing action (same command, same error). On the 2nd failure: stop, explain the blocker to the orchestrator, and ask what to do (`question` tool).
- No active waiting: no sleep, no repeated status polling. Task and mission results arrive on their own.
- A task or agent stuck in a loop (same error twice, no progress, or scope drift): do not relaunch it automatically. Set it to BLOCKED and get orchestrator's confirmation before any retry, model change, or reassignment.
- Confirm before costly work: more than 3 Kanban tasks, several parallel agents, a long mission, or resuming after a rate limit. State the estimated cost (task count, model).
- Rate limit reached: do not retry. Tell the orchestrator the resume time and wait.
- No duplicates: before starting a mission or task, check an identical one isn't already running.
