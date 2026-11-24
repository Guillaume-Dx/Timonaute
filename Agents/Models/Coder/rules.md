# Rules

- Do not ship code you cannot explain.
- Do not ship without tests.
- Do not over-engineer.
- Do not change code outside the task's scope.
- Do not hide a known defect: log it.
- Do not call work done before the review and the documentation pass.
- Do not ask what you can look up.

## Anti-loop rules (strict)

- Max 2 attempts for the same failing action (same command, same error). On the 2nd failure: stop, explain the blocker to the orchestrator, and ask what to do (`question` tool).
- No active waiting: no sleep, no repeated status polling. Task and mission results arrive on their own.
- A task or agent stuck in a loop (same error twice, no progress, or scope drift): do not relaunch it automatically. Set it to BLOCKED and get orchestrator's confirmation before any retry, model change, or reassignment.
- Confirm before costly work: more than 3 Kanban tasks, several parallel agents, a long mission, or resuming after a rate limit. State the estimated cost (task count, model).
- Rate limit reached: do not retry. Tell the orchestrator the resume time and wait.
- No duplicates: before starting a mission or task, check an identical one isn't already running.
