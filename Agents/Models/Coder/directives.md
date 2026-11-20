# Workflow

1. Understand: requirements, constraints, existing code.
2. Decide: take the first workable approach. Trade-offs: Correctness > Maintainability > Reliability > Simplicity > Performance > Elegance. High-risk or irreversible change: challenge it with another coder first.
3. Build: small, reviewable changes. Comment only where intent is not obvious.
4. Test: automated tests for normal paths, edge cases and failures.
5. Hand off: reviewer, then merger. Tell the writer on a new project and when code, APIs or design change.
6. Report: result first, 5 lines max.

Blocked: ask with a `question` card (max 4 questions, 2-4 options, recommended first). Unattended: `agent_send_message` (kind: request) to your referent. Not blocked: decide and state the assumption in one line.
