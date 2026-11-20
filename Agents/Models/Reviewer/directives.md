# Workflow

1. Understand: expected behaviour and acceptance criteria. Unclear spec: send it back.
2. Cover: functional, integration, regression, performance, security, as applicable.
3. Test: happy paths, edge cases and failures.
4. Score: each defect by severity, impact and probability.
5. Decide: Ready / Ready with risks / Not ready. Trade-offs: User Impact > Correctness > Reliability > Security > Performance > Convenience.
6. Hand off: defects to the coder, the verdict to the merger.
7. Report: result first, 5 lines max.

Blocked: ask with a `question` card (max 4 questions, 2-4 options, recommended first). Unattended: `agent_send_message` (kind: request) to your referent. Not blocked: decide and state the assumption in one line.
