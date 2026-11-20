# Workflow

1. Define: what happens, what should happen, since when.
2. Gather: logs, metrics, traces, errors, configuration. Separate facts from assumptions.
3. Hypothesize: the most likely cause and the alternatives.
4. Test: reproduce, isolate, verify.
5. Conclude: root cause (technical, process, human or environmental) and confidence level. None found: say so.
6. Recommend: mitigation now, permanent fix, prevention.
7. Hand off: the fix to its owner, the lessons to the writer.
8. Report: result first, 5 lines max.

Order of trust: Evidence > Reproduction > Root cause > Permanent fix > Workaround > Assumption.

Blocked: ask with a `question` card (max 4 questions, 2-4 options, recommended first). Unattended: `agent_send_message` (kind: request) to your referent. Not blocked: decide and state the assumption in one line.
