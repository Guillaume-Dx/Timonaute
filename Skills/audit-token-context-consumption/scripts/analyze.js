#!/usr/bin/env node
// Token/context audit - step 3: fixed rules -> base findings (read-only).
// Applies the SAME rules, thresholds, wording and ranking to every snapshot, so two audits of the same data
// give the same findings, fixes and summary. The auditor may only ADD to the base (code findings, notes,
// sharper estimates) and may dismiss a base finding with a reason; report.js refuses a findings file that
// drops a base id or a required field.
//
// Usage: node analyze.js --snapshot <workdir>      (reads data.json + the fetch.js files, writes findings.base.json)
'use strict'
const fs = require('fs')
const path = require('path')

const RULES_VERSION = '4.0'
const args = {}
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args[a.slice(2)] = process.argv[++i] }
if (!args.snapshot) { console.error('usage: node analyze.js --snapshot <workdir>'); process.exit(2) }
const W = args.snapshot
const rd = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(W, f), 'utf8')) } catch { return d } }
const D = rd('data.json')
if (!D) { console.error('data.json missing: run collect.js --snapshot first'); process.exit(2) }
const M = rd('manifest.json', {})
const tasks = rd('tasks.json', [])
const mcp = rd('mcp.json', [])
const backends = rd('backends.json', {})
const memory = rd('memory.json', {})
const series = rd('series.json', {})
const agents = fs.existsSync(path.join(W, 'agents')) ? fs.readdirSync(path.join(W, 'agents')).sort().map((f) => rd(path.join('agents', f))).filter(Boolean) : []

// ---------------------------------------------------------------- thresholds (documented in SKILL.md 4.1)
const T = {
  growth: 2.0, growthMinCost: 1.0, growthCriticalShare: 0.30,
  importBytes: 8 * 1024, importBusyMissions: 10,
  docsBytes: 12 * 1024, coreRules: 10, catalogueDeadMissions: 10,
  rateLimitSerious: 3, crashSerious: 3,
  docRatio: 1.0, docEmptySerious: 0.25, loopIteration: 3,
  outlierCost: 1.0, outlierRatio: 3, outlierMax: 10, coverageLow: 80, unmeasuredShare: 0.5,
}
const SEV_RANK = { critical: 0, serious: 1, warning: 2, info: 3 }
// Tie-break inside a severity: cost drivers first, hygiene last. Fixed, so the order never depends on the run.
const PRIO = ['E6', 'E5', 'R1', 'B1', 'D5', 'D8', 'F3', 'E7', 'C4', 'C1', 'A1', 'A4', 'B2', 'D5b', 'D7', 'F7']
const prio = (id) => { const i = PRIO.indexOf(id); return i < 0 ? 99 : i }
const money = (x) => '$' + Number(x || 0).toFixed(2)
const pct = (x) => Math.round(x * 100) + ' %'
const short = (id) => String(id || '').slice(0, 8)
const agentShort = (a) => { const s = String(a || ''); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(i + 1) : s }
const kb = (b) => (b == null ? '?' : (b / 1024).toFixed(1) + ' KB')
const tot = D.totals || {}
const recorded = tot.cost_window ?? tot.cost_in_spans ?? 0 // cost inside the window: same as-of = same figure
const missions = D.missions || []
const events = D.events || []
const ev = (k) => events.filter((e) => e.kind === k)
const DISRUPT = new Set(['rate_limit', 'crash', 'failed', 'quota', 'capacity'])

const findings = []
const fixes = []
const add = (f) => findings.push({ status: 'open', ...f })

// ---------------------------------------------------------------- spawn weight
const coreOf = (list) => (Array.isArray(list) ? list.filter((r) => r.status !== 'archived') : [])
const globalRules = coreOf(memory.global)
const projectRules = coreOf(memory.project)
const roleRules = coreOf(memory.role)
const spawn = agents.map((a) => {
  const c = a.config || {}
  const docsBytes = a.docs.reduce((s, d) => s + (d.bytes || 0), 0)
  const imported = a.skills.filter((s) => s.mode === 'import')
  const catalogue = a.skills.filter((s) => s.mode === 'include')
  const rRole = roleRules.filter((r) => r.role === c.role)
  const rAgent = coreOf(a.agent_rules)
  const rules = [...globalRules, ...projectRules, ...rRole, ...rAgent]
  const core = rules.filter((r) => r.tier === 'core').length
  const importBytes = imported.reduce((s, x) => s + (x.skill_md_bytes || 0), 0)
  return {
    name: a.name, role: c.role, backend: c.backend || 'claude', model: c.model, reasoning: c.reasoningEffort || null, mcp: c.mcp_servers || [],
    docsBytes, docs: a.docs, imported, catalogue, importBytes, rules: rules.length, core, reads: a.skill_reads || {},
    row: {
      agent: agentShort(a.name), backend_model: `${c.backend || 'claude'}/${c.model || '?'}`, docs: `${kb(docsBytes)} (${a.docs.length} files)`,
      imported: imported.length ? imported.map((s) => `${s.id} ${kb(s.skill_md_bytes)}`).join(', ') : '-',
      catalogue: catalogue.length ? catalogue.map((s) => s.id).join(', ') : '-',
      rules: `${rules.length} (${core} core)`, mcp: (c.mcp_servers || []).join(', ') || '-',
      total: `${kb(docsBytes + importBytes)} docs + imported skills (preamble not counted)`,
    },
  }
})

// ---------------------------------------------------------------- rules
// E6: context growth inside one session
const growing = missions.filter((m) => m.max_growth >= T.growth && m.cost >= T.growthMinCost)
if (growing.length) {
  const cost = growing.reduce((s, m) => s + m.cost, 0)
  add({
    id: 'E6', rule: 'max_growth >= 2 on a mission costing >= $1', severity: cost / (recorded || 1) >= T.growthCriticalShare ? 'critical' : 'serious', area: 'Session lifecycle',
    finding: `${growing.length} mission(s) let their context grow without compaction: cost per turn rose up to ${Math.max(...growing.map((m) => m.max_growth))}x inside one session.`,
    evidence: growing.slice(0, 5).map((m) => `${agentShort(m.agent)} ${short(m.id)}: ${m.turns} turns, ${money(m.cost)}, x${m.max_growth}`).join('; '),
    impact: `${money(cost)} (${pct(cost / (recorded || 1))} of recorded cost) is spent in these sessions`,
    fix: 'Compact earlier or split the session by stage.', owner: 'User',
  })
  fixes.push({
    title: 'Keep long sessions short: compact earlier, or one session per stage', effect: 'lowers', kind: 'process',
    where: `The chat of ${[...new Set(growing.map((m) => agentShort(m.agent)))].join(', ')} (Compact), or a new mission per stage with a handover note`,
    steps: ['Compact when the context gauge passes about 60 %, not 80 %.', 'Or end the session at each stage boundary and start a new one with a short handover (open tasks, decisions, next step).', 'Keep raw lists out of the session: read one task (kanban_get), not the whole board (kanban_list).'],
    saving: `Up to about half of ${money(cost)} per period: cost per turn grew up to ${Math.max(...growing.map((m) => m.max_growth))}x`, frequency: 'every turn of these sessions', effort: 'S',
    risk: 'A summary can drop a detail: keep decisions in task comments and project notes.', verify: `max_growth < ${T.growth} on every mission costing >= $1`, refs: ['E6'], owner: 'User',
  })
}
// E5: backend switches inside a mission
const sw = ev('switch_out')
if (sw.length) {
  const rew = ev('cache_rewrite').filter((e) => /switch/.test(e.detail))
  const trig = sw.filter((e) => e.cause)
  add({
    id: 'E5', rule: 'switch_out >= 1', severity: 'serious', area: 'Session lifecycle',
    finding: `${sw.length} backend switch(es) inside running missions; each return rewrites the whole prompt cache and the fallback receives the history.`,
    evidence: sw.map((e) => `${e.t ? new Date(e.t).toISOString().slice(5, 16) : ''} ${agentShort(e.agent)} ${short(e.mission)}${e.cause ? ' (likely trigger: ' + e.cause + ')' : ''}`).join('; '),
    impact: `${money(rew.reduce((s, e) => s + (e.cost || 0), 0))} in cache rewrites after switches; ${trig.length} of ${sw.length} switches follow a disruption of another mission (correlation)`,
    fix: 'Keep the pilot off the quota the workers exhaust.', owner: 'User',
  })
}
// R1: rate limits
const rl = ev('rate_limit')
if (rl.length) {
  const byModel = {}
  for (const e of rl) { const m = missions.find((x) => x.id === e.mission); const k = m ? `${m.backend}/${m.model}` : '?'; byModel[k] = (byModel[k] || 0) + 1 }
  add({
    id: 'R1', rule: 'rate_limit >= 1', severity: rl.length >= T.rateLimitSerious ? 'serious' : 'warning', area: 'Provider quota',
    finding: `${rl.length} mission(s) stopped on a rate limit.`, evidence: Object.entries(byModel).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k}: ${n}`).join('; '),
    impact: 'Each stop retries or falls back, and can move other missions of the same account (see E5)', fix: 'Fewer parallel tasks on that model, or a cheaper model for routine work.', owner: 'User',
  })
}
if (sw.length || rl.length) {
  const top = Object.entries(rl.reduce((a, e) => { const m = missions.find((x) => x.id === e.mission); const k = m ? `${m.backend}/${m.model}` : '?'; a[k] = (a[k] || 0) + 1; return a }, {})).sort((a, b) => b[1] - a[1])[0]
  fixes.push({
    title: `Spread the load on ${top ? top[0] : 'the rate-limited model'} so rate limits stop moving other missions`, effect: 'slows', kind: 'config',
    where: 'Series roles (kanban_plan screen or series_role_set) and the number of tasks running at once',
    steps: [`Run at most 1-2 tasks at a time on ${top ? top[0] : 'that model'}, or set routine tasks to a cheaper model (plan groups).`, 'Keep the pilot on a model or account whose quota the workers do not exhaust.', 'Re-run this audit and compare the switch and rate-limit counts.'],
    saving: `Removes up to ${sw.length} backend switch(es) and ${rl.length} rate-limit stop(s) per period, and their cache rewrites`, frequency: 'per rate limit', effort: 'S',
    risk: 'A cheaper model may need more review rounds: watch the iteration count.', verify: '0 switch_out and 0 rate_limit events in the chronology', refs: ['E5', 'R1'].filter((id) => findings.some((f) => f.id === id)), owner: 'User',
  })
}
// E7: cache rewrite after idle
const idle = ev('cache_rewrite').filter((e) => /idle/.test(e.detail))
if (idle.length) add({ id: 'E7', rule: 'cache_rewrite after idle >= 1', severity: 'warning', area: 'Session lifecycle', finding: `${idle.length} turn(s) rewrote the whole prompt cache after a pause.`, evidence: idle.map((e) => `${agentShort(e.agent)} ${short(e.mission)} ${money(e.cost)}`).join('; '), impact: money(idle.reduce((s, e) => s + (e.cost || 0), 0)), fix: 'Group messages to a long session instead of trickling them after pauses.', owner: 'User' })
// F3: crashes and model ids not offered
const crashes = ev('crash')
const offered = new Set(((backends && backends.backends) || []).flatMap((b) => (b.models || []).map((m) => `${b.id}/${m.slug}`)))
const unknownModels = [...new Set(missions.filter((m) => m.model && offered.size && !offered.has(`${m.backend}/${m.model}`)).map((m) => `${m.backend}/${m.model}`))].sort()
if (crashes.length || unknownModels.length) {
  add({
    id: 'F3', rule: 'crash >= 1 or model id not in backends', severity: crashes.length >= T.crashSerious ? 'serious' : 'warning', area: 'Provider and CLI',
    finding: `${crashes.length} crash(es); ${unknownModels.length} model id(s) used that the backends list does not offer.`, evidence: [crashes.length ? 'crashes: ' + crashes.map((e) => `${agentShort(e.agent)} ${short(e.mission)}`).join(', ') : '', unknownModels.length ? 'unknown ids: ' + unknownModels.join(', ') : ''].filter(Boolean).join('; '),
    impact: 'Each crash is a spawn paid for nothing, multiplied by retries', fix: 'Use model ids from backends_list.', owner: 'User',
  })
  fixes.push({ title: 'Use only model ids the backend offers', effect: 'lowers', kind: 'config', where: 'Agent config, series roles and task overrides that carry the ids listed in F3', steps: ['Replace each id in F3 with the slug shown by backends_list.', 'Re-run the task once and check it does not crash.'], saving: `${crashes.length} crashed spawn(s) per period`, frequency: 'per task using the id', effort: 'S', risk: 'None.', verify: '0 crash events; no unknown model id', refs: ['F3'], owner: 'User' })
}
// B1: big imported skills
const b1 = spawn.flatMap((a) => a.imported.filter((s) => (s.skill_md_bytes || 0) > T.importBytes).map((s) => ({ a, s })))
if (b1.length) {
  const busy = b1.some(({ a }) => (a.reads.missions || 0) >= T.importBusyMissions)
  add({ id: 'B1', rule: 'imported skill > 8 KB', severity: busy ? 'serious' : 'warning', area: 'Skills', finding: `${b1.length} skill(s) are imported in full into every spawn.`, evidence: b1.map(({ a, s }) => `${agentShort(a.name)}: ${s.id} ${kb(s.skill_md_bytes)} (${a.reads.missions || 0} missions in 30 days)`).join('; '), impact: b1.map(({ a, s }) => `~${Math.round((s.skill_md_bytes || 0) / 4 / 1000)}k tokens x ${a.reads.missions || 0} missions`).join('; '), fix: 'Catalogue mode, or a short imported core.', owner: 'User' })
  fixes.push({ title: 'Switch large imported skills to Catalogue', effect: 'lowers', kind: 'config', where: b1.map(({ a, s }) => `Agents > ${a.name} > Skills > ${s.id} > mode`).join('; '), steps: ['Set the skill to Catalogue (one line until skill_get).', 'Or keep a 2-3 KB core imported and the full text in Catalogue.', 'Check skill_reads after a week: the agent must still open it when needed.'], saving: b1.map(({ s }) => `~${Math.round((s.skill_md_bytes || 0) / 4 / 1000)}k tokens per spawn`).join('; '), frequency: 'per spawn of the agent', effort: 'S', risk: 'The agent may skip the skill: watch skill_reads.', verify: 'No imported skill above 8 KB', refs: ['B1'], owner: 'User' })
}
// B2: catalogue skills never read
const b2 = spawn.flatMap((a) => a.catalogue.filter((s) => (a.reads.missions || 0) >= T.catalogueDeadMissions && !((a.reads.skills || {})[s.id])).map((s) => `${agentShort(a.name)}: ${s.id} (0 reads in ${a.reads.missions} missions)`))
if (b2.length) add({ id: 'B2', rule: 'catalogue skill with 0 reads over >= 10 missions', severity: 'warning', area: 'Skills', finding: `${b2.length} catalogue skill(s) never read.`, evidence: b2.join('; '), impact: 'One catalogue line per spawn each; mostly a description problem', fix: 'Detach, or rewrite the description so the agent reaches for it.', owner: 'User' })
// A1: heavy identity docs
const a1 = spawn.filter((a) => a.docsBytes > T.docsBytes)
if (a1.length) add({ id: 'A1', rule: 'identity docs > 12 KB', severity: 'warning', area: 'Identity', finding: `${a1.length} agent(s) carry more than 12 KB of identity docs.`, evidence: a1.map((a) => `${agentShort(a.name)} ${kb(a.docsBytes)}`).join('; '), impact: 'Paid on every spawn', fix: 'Remove duplicated rules and stray .md files.', owner: 'User' })
// A4: many core rules
const a4 = spawn.filter((a) => a.core > T.coreRules)
if (a4.length) add({ id: 'A4', rule: 'core memory rules > 10', severity: 'warning', area: 'Memory', finding: `${a4.length} agent(s) receive more than ${T.coreRules} core rules.`, evidence: a4.map((a) => `${agentShort(a.name)} ${a.core}`).join('; '), impact: 'Paid on every spawn', fix: 'Demote rules that are not needed every time to the normal tier.', owner: 'User' })
// C4 / C1: MCP servers attached that fail or are never used
const mcpById = Object.fromEntries((Array.isArray(mcp) ? mcp : []).map((s) => [s.id, s]))
const usedNames = new Set(missions.flatMap((m) => (m.top_tools || []).map(([n]) => n)))
const attached = {}
for (const a of spawn) for (const id of a.mcp) (attached[id] = attached[id] || []).push(agentShort(a.name))
const failing = Object.entries(attached).filter(([id]) => mcpById[id] && /fail|auth/.test(mcpById[id].last_status || ''))
const unused = Object.entries(attached).filter(([id]) => { const n = (mcpById[id] && mcpById[id].name) || id; return ![...usedNames].some((t) => t.includes(n.replace(/-/g, '_')) || t.includes(id)) })
if (failing.length) add({ id: 'C4', rule: 'attached MCP server with last_status failed', severity: failing.some(([, ag]) => ag.length >= 3) ? 'serious' : 'warning', area: 'MCP', finding: `${failing.length} attached MCP server(s) fail to connect.`, evidence: failing.map(([id, ag]) => `${id} (${mcpById[id].last_status}) on ${ag.join(', ')}`).join('; '), impact: 'A failed connection attempt on every spawn', fix: 'Detach until it connects again.', owner: 'User' })
if (unused.length) add({ id: 'C1', rule: 'attached MCP server never seen in tool spans', severity: 'warning', area: 'MCP', finding: `${unused.length} attached MCP server(s) were not used in the window.`, evidence: unused.map(([id, ag]) => `${id} on ${ag.join(', ')}`).join('; '), impact: 'Tool schemas or a connection per spawn (schemas deferred on Claude Code)', fix: 'Detach.', owner: 'User' })
if (failing.length || unused.length) fixes.push({ title: 'Detach failing and unused MCP servers', effect: 'lowers', kind: 'config', where: 'Agents > MCP servers', steps: [...new Set([...failing, ...unused].map(([id, ag]) => `Detach ${id} from ${ag.join(', ')}.`))], saving: 'One connection (and possibly a tool catalogue) per spawn', frequency: 'per spawn', effort: 'S', risk: 'Re-attach when a task needs it.', verify: 'No failing or unused MCP server attached', refs: ['C4', 'C1'].filter((id) => findings.some((f) => f.id === id)), owner: 'User' })
// D5: chained doc tasks and review loops
const byId = Object.fromEntries(tasks.map((t) => [t.id, t]))
const docs = tasks.filter((t) => t.type === 'doc')
const codeTasks = tasks.filter((t) => t.type === 'code')
const empty = docs.filter((t) => /(nothing (new |else )?(was )?worth|wrote no|no (vault )?note (was )?(written|needed)|closed? without writing|no new (lesson|note)|did not write|no durable)/i.test(`${t.done_summary || ''} ${t.done_comment || ''}`))
const docAfterReview = docs.filter((t) => byId[t.parent_task_id] && byId[t.parent_task_id].type === 'review')
if (codeTasks.length && docs.length / codeTasks.length > T.docRatio) {
  add({ id: 'D5', rule: 'doc tasks / code tasks > 1', severity: empty.length / docs.length >= T.docEmptySerious ? 'serious' : 'warning', area: 'Orchestration', finding: `${docs.length} doc tasks for ${codeTasks.length} code tasks; ${empty.length} closed with nothing written.`, evidence: `${docAfterReview.length} doc tasks hang on a review task`, impact: `${docs.length - codeTasks.length} extra Writer spawns or more in the window`, fix: 'One doc per landed change.', owner: 'User; Timon maintainers if the chain creates them' })
  fixes.push({ title: 'One doc task per landed change', effect: 'lowers', kind: docAfterReview.length ? 'timon-code' : 'process', where: 'The task chain (doc tasks) and the pilot\'s habits', steps: ['Check in 3.7 (T7) why reviews get their own doc task; report it if the chain does it.', 'Until then: create the follow-up task before closing a review.'], saving: `Up to ${docs.length - codeTasks.length} Writer missions per period, ${empty.length} of which wrote nothing`, frequency: 'per review round', effort: docAfterReview.length ? 'L' : 'S', risk: 'Keep one doc per landed change.', verify: 'doc tasks / code tasks <= 1', refs: ['D5'], owner: 'User; Timon maintainers' })
}
const loops = tasks.filter((t) => t.type === 'review' && (t.iteration || 0) >= T.loopIteration)
if (loops.length) add({ id: 'D5b', rule: 'review iteration >= 3', severity: 'warning', area: 'Orchestration', finding: `${loops.length} review(s) reached iteration ${T.loopIteration} or more.`, evidence: loops.map((t) => t.title.slice(0, 50)).join('; '), impact: 'Each round = a code, a review and possibly a doc spawn', fix: 'Sharper briefs and acceptance criteria before the first round.', owner: 'User' })
// D8: mechanical roles on expensive models
const mech = missions.filter((m) => ['merge', 'doc'].includes(m.type) && /opus|sonnet/.test(m.model || ''))
if (mech.length) {
  const by = mech.reduce((a, m) => { const k = `${m.type} on ${m.backend}/${m.model}`; a[k] = (a[k] || 0) + 1; return a }, {})
  add({ id: 'D8', rule: 'merge or doc mission on an Opus or Sonnet model', severity: 'warning', area: 'Orchestration', finding: `${mech.length} merge/doc mission(s) ran on an expensive model.`, evidence: Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k}: ${n}`).join('; '), impact: 'Mechanical work at a premium model price', fix: 'Haiku (or the agent default) for merge and doc.', owner: 'User' })
  fixes.push({ title: 'Run merge and doc tasks on a small model', effect: 'lowers', kind: 'config', where: 'Series roles doc and merge (series_role_list shows the overrides)', steps: ['Clear the doc and merge role overrides, or set them to the small model of the backend.'], saving: `${mech.length} missions per period moved to a small model`, frequency: 'per merge and doc task', effort: 'S', risk: 'A merge conflict still fails the task by rule.', verify: 'by_model: no merge/doc mission on opus or sonnet', refs: ['D8'], owner: 'User' })
}
// D7: high reasoning effort on mechanical or review roles
const d7 = spawn.filter((a) => a.reasoning && /high|max|ultra/.test(a.reasoning) && ['merger', 'merge', 'librarian', 'doc', 'reviewer', 'review'].includes(a.role))
if (d7.length) add({ id: 'D7', rule: 'reasoning high or above on a merger, librarian or reviewer', severity: 'info', area: 'Orchestration', finding: `${d7.length} agent(s) run with a high reasoning effort.`, evidence: d7.map((a) => `${agentShort(a.name)} (${a.role}) ${a.reasoning}`).join('; '), impact: 'Not measured on backends that report no cost', fix: 'Try medium and compare review quality.', owner: 'User' })
// F7: no cost visibility
const unmeasured = missions.filter((m) => m.cost_source === 'not measured').length
if (missions.length && unmeasured / missions.length >= T.unmeasuredShare) add({ id: 'F7', rule: 'missions without measured cost >= 50 %', severity: 'info', area: 'Measurement', finding: `${unmeasured} of ${missions.length} missions have no measured cost.`, evidence: (D.by_backend || []).filter((b) => !b.cost_measured).map((b) => `${b.backend}: ${b.missions} missions`).join('; '), impact: 'Their cost exists but is invisible', fix: 'Use proxies (turns, tokens, duration); see T10 for Timon-side gaps.', owner: 'User' })

// ---------------------------------------------------------------- ordering (fixed)
findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || prio(a.id) - prio(b.id) || a.id.localeCompare(b.id))
const sevOfRefs = (f) => Math.min(...(f.refs || []).map((id) => { const x = findings.find((y) => y.id === id); return x ? SEV_RANK[x.severity] * 100 + prio(id) : 999 }))
const EFF = { S: 0, M: 1, L: 2 }
fixes.sort((a, b) => sevOfRefs(a) - sevOfRefs(b) || (EFF[a.effort] ?? 3) - (EFF[b.effort] ?? 3) || a.title.localeCompare(b.title))

// ---------------------------------------------------------------- outliers, notes, data quality
const outliers = missions.filter((m) => m.cost >= T.outlierCost && ((m.ratio || 0) >= T.outlierRatio || (m.max_growth || 0) >= T.growth))
  .slice(0, T.outlierMax).map((m) => ({ mission: `${short(m.id)} ${agentShort(m.agent)}`, turns: m.turns, cost: money(m.cost), peer: money(m.peer_median), ratio: m.ratio != null ? m.ratio + 'x' : '-', cause: [(m.max_growth >= T.growth ? `growth x${m.max_growth}` : ''), (events.some((e) => e.mission === m.id && e.kind === 'switch_out') ? 'backend switch' : '')].filter(Boolean).join(', ') || 'above peer median' }))
const dq = []
for (const c of D.coverage || []) if (c.cost_coverage_pct != null && c.cost_coverage_pct < T.coverageLow) dq.push(`Trace ${short(c.trace)}: ${c.spans_shown} of ${c.spans_total} spans visible, ${c.cost_coverage_pct} % of its cost attributed to turns.`)
dq.push(`${tot.unmeasured_turns || 0} of ${tot.turns || 0} turns report no cost (not measured, not free).`)
dq.push(`Cost-reporting backends: ${(D.cost_backends || ['claude']).join(', ')}; recorded dollars on subscriptions are notional, quota is the real limit.`)
dq.push(`${missions.filter((m) => !m.turns).length} of ${missions.length} missions have no turn spans in the visible traces.`)
const chron = []
if (growing.length) chron.push(`Largest growth: ${agentShort(growing[0].agent)} ${short(growing[0].id)}, x${growing[0].max_growth} within one session (${money(growing[0].cost)}).`)
if (sw.length) chron.push(`${sw.length} backend switch(es); ${sw.filter((e) => e.cause).length} within the correlation window of a disruption.`)
if (ev('cache_rewrite').length) chron.push(`${ev('cache_rewrite').length} cache rewrite(s) for ${money(tot.cache_rewrite_cost)}.`)
if (ev('context_drop').length) chron.push(`${ev('context_drop').length} context drop(s) (compaction or new session).`)
const dis = events.filter((e) => DISRUPT.has(e.kind)).reduce((a, e) => { a[e.kind] = (a[e.kind] || 0) + 1; return a }, {})
if (Object.keys(dis).length) chron.push('Disruptions: ' + Object.entries(dis).sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(', ') + '.')
const prov = []
const bm = (D.by_model || []).filter((r) => r.cost > 0)
if (bm.length) prov.push(`${bm[0].key} carries ${bm[0].cost_share_pct} % of the recorded cost (${money(bm[0].cost)}).`)
for (const b of (D.by_backend || []).filter((x) => !x.cost_measured && x.backend !== 'fallback (not identified)')) prov.push(`${b.backend}: ${b.missions} missions with no cost reported.`)
const fb = (D.by_backend || []).find((x) => x.backend === 'fallback (not identified)')
if (fb) prov.push(`${fb.turns} turns ran on an unidentified fallback.`)
const disModel = (D.by_model || []).filter((r) => r.disruptions).sort((a, b) => b.disruptions - a.disruptions || a.key.localeCompare(b.key))
if (disModel.length) prov.push('Disruptions by model: ' + disModel.map((r) => `${r.key} ${r.disruptions}`).join(', ') + '.')

// ---------------------------------------------------------------- summary (fixed template)
const top = findings.filter((f) => SEV_RANK[f.severity] <= 1).slice(0, 3)
const summary = `Recorded cost ${money(recorded)} over ${missions.length} missions and ${tot.turns || 0} turns (${M.since ? M.since.slice(0, 10) : '?'} to ${M.as_of ? M.as_of.slice(0, 10) : '?'}). ` +
  (top.length ? `Main drivers: ${top.map((f) => `${f.id}: ${f.finding.replace(/\.$/, '')}`).join('; ')}.` : 'No critical or serious finding.') +
  ` ${fixes.length} fix(es) proposed; ${findings.length} finding(s) from ${RULES_VERSION} rules.`

const base = {
  rules_version: RULES_VERSION, method_version: M.method_version || null,
  scope: `project ${M.project || D.project} (${agents.length} agents, ${(D.coverage || []).length} series)`,
  date: M.as_of ? M.as_of.slice(0, 10) : null,
  question: `Where do the tokens and context of project ${M.project || D.project} go, and what would lower or slow them?`,
  summary, data_quality: dq, chronology_notes: chron, provider_notes: prov,
  spawn_weight: spawn.map((a) => a.row), outliers, findings, fixes,
  code_scope: '', code_findings: [],
  not_investigated: ['Timon code analysis (3.7): fill code_scope and code_findings.', 'The spawn-weight total from the Agent injections widget (preamble included).'],
  series: Object.fromEntries(Object.entries(series).map(([k, v]) => [short(k), (v.roles || '').trim()])),
}
fs.writeFileSync(path.join(W, 'findings.base.json'), JSON.stringify(base, null, 1))
console.log(JSON.stringify({ out: path.join(W, 'findings.base.json'), findings: findings.map((f) => `${f.id}:${f.severity}`), fixes: fixes.length, outliers: outliers.length }))
