#!/usr/bin/env node
// Token/context audit - data collector (read-only).
// Turns saved `timon trace <id> --json` files (+ optional `timon task list` output and agent configs)
// into one data file: per-mission costs, a per-turn chronology, context-switch events, hourly buckets,
// peer groups and data-coverage figures. Never calls Timon itself; never writes outside --out.
//
// Usage:
//   node collect.js --traces <dir> [--tasks tasks.json] [--project <slug>] [--agents <~/.timon/agents>]
//                   [--idle-min 10] [--cost-backends claude] --out data.json
// --cost-backends: backends whose turns report cost_usd (comma list). A no-cost turn inside a mission of
// such a backend ran elsewhere (fallback or switch) and is attributed to "fallback (not identified)".
'use strict'
const fs = require('fs')
const path = require('path')

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true
}
// --snapshot <workdir>: the folder written by fetch.js. Reads traces, tasks and agent configs from it (not
// from the live home), so the same snapshot always gives the same data.json.
let MANIFEST = null
if (args.snapshot) {
  args.traces = args.traces || path.join(args.snapshot, 'traces')
  args.tasks = args.tasks || path.join(args.snapshot, 'tasks.json')
  args.out = args.out || path.join(args.snapshot, 'data.json')
  try { MANIFEST = JSON.parse(fs.readFileSync(path.join(args.snapshot, 'manifest.json'), 'utf8')); args.project = args.project || MANIFEST.project } catch { /* none */ }
}
if (!args.traces || !args.out) {
  console.error('usage: node collect.js --traces <dir> [--tasks tasks.json] [--project slug] [--agents dir] [--idle-min 10] --out data.json')
  process.exit(2)
}
// `killed` is how Timon ends a finished task mission: not a disruption.
const NORMAL_END = new Set(['killed', 'completed', 'user'])
const COST_BACKENDS = new Set(String(args['cost-backends'] || 'claude').split(',').map((x) => x.trim()))
const FALLBACK = 'fallback (not identified)'
// Turn spans carry no model id, and a mission's override is its CURRENT one (a running chat may have been
// switched since). So a turn's provider is inferred: cost reported => a cost backend; no cost inside a mission
// now on a cost backend => an unidentified fallback. `attribution` says how sure the row is.
function turnBackend(m, isMeasured, missionHasMeasured) {
  const cur = COST_BACKENDS.has(m.backend)
  if (isMeasured) {
    if (cur) return { backend: m.backend, model: m.model, attribution: 'mission' }
    if (COST_BACKENDS.has(m.config_backend)) return { backend: m.config_backend, model: m.config_model, attribution: 'inferred from agent config' }
    return { backend: [...COST_BACKENDS][0], model: 'not identified', attribution: 'inferred from cost' }
  }
  if (cur) return { backend: FALLBACK, model: 'not identified', attribution: 'unknown' }
  return { backend: m.backend, model: m.model, attribution: missionHasMeasured ? 'inferred from current override' : 'mission' }
}
const IDLE_MS = Number(args['idle-min'] || 10) * 60000

const readJson = (f) => {
  const raw = fs.readFileSync(f, 'utf8')
  const start = raw.search(/[[{]/) // tolerate a text banner before the JSON
  return JSON.parse(raw.slice(start))
}
const med = (a) => { const s = a.filter((x) => x != null).slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }
const r2 = (x) => Math.round((x || 0) * 100) / 100

// ---------- load ----------
let tasks = []
if (args.tasks) {
  const t = readJson(args.tasks)
  tasks = Array.isArray(t) ? t : (t.tasks || t.items || [])
  if (args.project) tasks = tasks.filter((x) => x.project === args.project)
}
const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]))

const cfg = {}
if (args.snapshot && fs.existsSync(path.join(args.snapshot, 'agents'))) {
  for (const f of fs.readdirSync(path.join(args.snapshot, 'agents')).sort()) {
    try { const a = JSON.parse(fs.readFileSync(path.join(args.snapshot, 'agents', f), 'utf8')); cfg[a.name] = a.config } catch { /* skip */ }
  }
} else if (args.agents && fs.existsSync(args.agents)) {
  for (const a of fs.readdirSync(args.agents)) {
    const f = path.join(args.agents, a, 'config.json')
    if (fs.existsSync(f)) { try { cfg[a] = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { /* skip */ } }
  }
}

const WIN = MANIFEST && MANIFEST.since && MANIFEST.as_of ? { since: Date.parse(MANIFEST.since), asOf: Date.parse(MANIFEST.as_of) } : null
const missions = {}
const spans = []
const coverage = []
for (const f of fs.readdirSync(args.traces).filter((x) => x.endsWith('.json')).sort()) {
  let d
  try { d = readJson(path.join(args.traces, f)) } catch (e) { console.error('skip', f, e.message); continue }
  const ss = d.spans || []
  const shownCost = ss.filter((s) => s.kind === 'turn').reduce((a, s) => a + (s.cost_usd || 0), 0)
  coverage.push({
    trace: d.trace_id, missions: (d.missions || []).length, spans_shown: ss.length, spans_total: d.spans_total,
    truncated: !!d.spans_truncated, cost_in_spans: r2(shownCost), cost_aggregate: r2(d.aggregates && d.aggregates.cost_usd),
    cost_coverage_pct: d.aggregates && d.aggregates.cost_usd ? Math.round((shownCost / d.aggregates.cost_usd) * 100) : null,
  })
  // Window from the manifest: only what started inside [since, as_of] counts, so a later fetch with the same
  // --as-of / --since sees the same turns even if the series kept running (the trace aggregates above cannot
  // be cut and stay whole: compare them with care).
  const inWin = (t) => !WIN || (t >= WIN.since && t <= WIN.asOf)
  for (const m of d.missions || []) if (inWin(m.started_at)) missions[m.id] = { ...m, trace_id: d.trace_id, ended_at: m.ended_at && WIN && m.ended_at > WIN.asOf ? null : m.ended_at }
  for (const t of d.tasks || []) if (!taskById[t.id]) taskById[t.id] = t
  for (const s of ss) if (inWin(s.started_at)) spans.push(s)
}

// Model of one mission run: its own override; else the task's effective model when the task ran on the same
// backend (series roles set it there); else the agent's configured model on that backend.
function modelOf(m, t, c) {
  if (m.model_override) return m.model_override
  const backend = m.backend_override || (t && t.effective_backend) || c.backend || 'claude'
  if (t && t.effective_model && (t.effective_backend || backend) === backend) return t.effective_model
  if ((c.backend || 'claude') === backend) return c.model || null
  return null
}

// ---------- per mission ----------
const out = []
for (const m of Object.values(missions)) {
  const c = cfg[m.agent_name] || {}
  const t = taskById[m.task_id]
  const own = spans.filter((s) => s.mission_id === m.id)
  const turns = own.filter((s) => s.kind === 'turn').sort((a, b) => a.started_at - b.started_at)
  const tools = own.filter((s) => s.kind === 'tool')
  const toolCount = {}
  const toolBytes = {}
  for (const s of tools) {
    toolCount[s.name] = (toolCount[s.name] || 0) + 1
    if (s.output != null) toolBytes[s.name] = (toolBytes[s.name] || 0) + JSON.stringify(s.output).length
  }
  const spanCost = turns.reduce((a, s) => a + (s.cost_usd || 0), 0)
  out.push({
    id: m.id, trace_id: m.trace_id, agent: m.agent_name, title: (m.title || m.mission || '').slice(0, 90),
    type: t ? t.type : (m.task_id ? 'task' : 'chat'), task_id: m.task_id || null, parent: m.parent_mission_id || null,
    started_at: m.started_at, ended_at: m.ended_at || null, status: m.status, interrupted: m.interrupted_reason || null,
    config_backend: c.backend || 'claude', config_model: c.model || null,
    // The mission's own override is the run that happened; the task's effective_* is its LAST run (a retry
    // on a fallback rewrites it). A chat mission's override is its current one (see turnBackend).
    backend: m.backend_override || (t && t.effective_backend) || c.backend || 'claude',
    model: modelOf(m, t, c),
    reasoning: m.reasoning_effort || c.reasoningEffort || null,
    extra_skills: m.extra_skills || null, extra_mcp: m.extra_mcp_servers || null, forked_from: m.forked_from || null,
    turns: turns.length, measured_turns: turns.filter((s) => (s.cost_usd || 0) > 0).length,
    cost: r2(spanCost || m.total_cost_usd || 0), cost_source: spanCost ? 'turn spans' : (m.total_cost_usd ? 'mission total' : 'not measured'),
    tools: tools.length, tool_errors: tools.filter((s) => s.status === 'error').length,
    top_tools: Object.entries(toolCount).sort((a, b) => b[1] - a[1]).slice(0, 5),
    tool_output_bytes: Object.entries(toolBytes).sort((a, b) => b[1] - a[1]).slice(0, 5),
    task: t ? { iteration: t.iteration, requeue: t.requeue_count, pipeline: t.pipeline, parent_task_id: t.parent_task_id } : null,
    _turns: turns,
  })
}

// ---------- chronology + context-switch detection ----------
const turnsOut = []
const events = []
for (const m of out) {
  const T = m._turns
  const measured = T.filter((s) => (s.cost_usd || 0) > 0).map((s) => s.cost_usd)
  const medCost = med(measured)
  let prev = null
  let prevMeasured = null
  let segStart = null
  const segments = []
  const closeSeg = (end) => { if (segStart) { segments.push({ ...segStart, end }); segStart = null } }
  if (T.length && !((T[0].cost_usd || 0) > 0) && m.config_backend === 'claude') {
    events.push({ t: T[0].started_at, kind: 'start_unmeasured', mission: m.id, agent: m.agent, detail: 'The first turn reports no cost although the agent is set to a cost-reporting backend: the mission started on another backend (override or fallback).' })
  }
  for (const s of T) {
    const cost = s.cost_usd || 0
    const isMeasured = cost > 0
    const gap = prev ? s.started_at - (prev.ended_at || prev.started_at) : 0
    const row = {
      mission: m.id, agent: m.agent, t: s.started_at, end: s.ended_at || s.started_at, cost: r2(cost) || 0, raw_cost: cost,
      tokens_in: s.tokens_in, tokens_out: s.tokens_out, duration_ms: s.duration_ms, measured: isMeasured, flags: [],
      ...turnBackend(m, isMeasured, measured.length > 0),
    }
    if (prev) {
      const prevMeasuredFlag = (prev.cost_usd || 0) > 0
      if (prevMeasuredFlag && !isMeasured) {
        events.push({ t: s.started_at, kind: 'switch_out', mission: m.id, agent: m.agent, detail: 'Turns stop reporting cost: the mission moved to a backend that reports no usage (fallback or manual switch). The new backend receives the whole history or a summary.' })
        row.flags.push('switch_out'); closeSeg(prev.started_at)
      }
      if (!prevMeasuredFlag && isMeasured) {
        events.push({ t: s.started_at, kind: 'switch_back', mission: m.id, agent: m.agent, detail: 'Turns report cost again: back on the original backend.' })
        row.flags.push('switch_back')
      }
    }
    if (isMeasured && (s.tokens_out || 0) <= 100 && cost >= Math.max(0.3, 0.5 * medCost) && prev &&
        ((prev.cost_usd || 0) === 0 || gap > IDLE_MS)) {
      const cause = (prev.cost_usd || 0) === 0 ? 'after backend switch' : `after ${Math.round(gap / 60000)} min idle`
      events.push({ t: s.started_at, kind: 'cache_rewrite', mission: m.id, agent: m.agent, cost: r2(cost), detail: `Turn with ${s.tokens_out || 0} output tokens costs $${cost.toFixed(2)}: the whole prompt is written to the cache again (${cause}).` })
      row.flags.push('cache_rewrite')
    }
    if (isMeasured && prevMeasured && prevMeasured.cost_usd >= 0.3 && cost < 0.4 * prevMeasured.cost_usd && !row.flags.includes('cache_rewrite')) {
      events.push({ t: s.started_at, kind: 'context_drop', mission: m.id, agent: m.agent, detail: `Cost per turn drops from $${prevMeasured.cost_usd.toFixed(2)} to $${cost.toFixed(2)}: compaction, summary handover or new session.` })
      row.flags.push('context_drop'); closeSeg(prevMeasured.started_at)
    }
    if (isMeasured) {
      if (!segStart) segStart = { start: s.started_at, first: cost, max: cost, n: 0 }
      segStart.max = Math.max(segStart.max, cost); segStart.n++
      prevMeasured = s
    }
    if (!isMeasured && s.tokens_in && prev && prev.tokens_in && s.tokens_in > prev.tokens_in * 1.05 && (prev.cost_usd || 0) === 0) row.flags.push('cumulative_tokens?')
    turnsOut.push(row)
    prev = s
  }
  closeSeg(T.length ? T[T.length - 1].started_at : null)
  m.segments = segments.map((g) => ({ ...g, first: r2(g.first), max: r2(g.max), growth: g.first ? Math.round((g.max / g.first) * 10) / 10 : null }))
  m.max_growth = m.segments.reduce((a, g) => Math.max(a, g.growth || 0), 0)
  if (m.interrupted && !NORMAL_END.has(m.interrupted)) events.push({ t: m.ended_at || m.started_at, kind: m.interrupted, mission: m.id, agent: m.agent, detail: `Mission interrupted (${m.interrupted}) on ${m.backend}/${m.model}.` })
  if (m.status === 'failed' && !m.interrupted) events.push({ t: m.ended_at || m.started_at, kind: 'failed', mission: m.id, agent: m.agent, detail: `Mission failed on ${m.backend}/${m.model}.` })
  delete m._turns
}
events.sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind) || a.mission.localeCompare(b.mission))
turnsOut.sort((a, b) => a.t - b.t || a.mission.localeCompare(b.mission))

// ---------- correlation: what likely triggered each switch ----------
// A disruption's time is its mission's end, which can come a few minutes AFTER the switch it caused,
// so the window is 15 min before to 10 min after. A correlation, not a proof: say so in the report.
const SWITCH_KINDS = new Set(['switch_out', 'switch_back', 'cache_rewrite', 'context_drop', 'start_unmeasured'])
const DISRUPTIONS = { has: (k) => !SWITCH_KINDS.has(k) }
for (const e of events.filter((x) => ['switch_out', 'start_unmeasured'].includes(x.kind))) {
  const near = events.filter((d) => DISRUPTIONS.has(d.kind) && d.mission !== e.mission && d.t >= e.t - 15 * 60000 && d.t <= e.t + 10 * 60000)
    .sort((a, b) => Math.abs(a.t - e.t) - Math.abs(b.t - e.t))[0]
  if (near) e.cause = `${near.kind} of ${near.agent.split('.').pop()} ${near.mission.slice(0, 8)} (${Math.round((near.t - e.t) / 60000)} min)`
}
// ---------- hourly buckets ----------
const hour = (t) => Math.floor(t / 3600000) * 3600000
const hourly = {}
const bucket = (t) => (hourly[hour(t)] = hourly[hour(t)] || { t: hour(t), cost: 0, turns: 0, unmeasured_turns: 0, missions_started: 0, interruptions: 0 })
for (const r of turnsOut) { const b = bucket(r.t); b.cost += r.raw_cost; b.turns++; if (!r.measured) b.unmeasured_turns++ }
for (const m of out) bucket(m.started_at).missions_started++
for (const e of events) if (DISRUPTIONS.has(e.kind)) bucket(e.t).interruptions++


// ---------- peer groups ----------
const groups = {}
for (const m of out) {
  const k = `${m.agent}|${m.type}|${m.backend}/${m.model}`
  const g = (groups[k] = groups[k] || { key: k, agent: m.agent, type: m.type, backend: m.backend, model: m.model, n: 0, cost: 0, costs: [], turns: 0, unmeasured: 0, tools: 0, tool_errors: 0, durations: [] })
  g.n++; g.cost += m.cost; g.costs.push(m.cost); g.turns += m.turns; g.tools += m.tools; g.tool_errors += m.tool_errors
  if (m.cost_source === 'not measured') g.unmeasured++
  if (m.ended_at) g.durations.push((m.ended_at - m.started_at) / 60000)
}
const groupRows = Object.values(groups).map((g) => ({
  key: g.key, agent: g.agent, type: g.type, backend: g.backend, model: g.model, n: g.n, cost: r2(g.cost), median_cost: r2(med(g.costs)),
  turns: g.turns, unmeasured_missions: g.unmeasured, tools: g.tools, tool_errors: g.tool_errors, median_minutes: Math.round(med(g.durations) * 10) / 10,
})).sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key))
for (const m of out) {
  const g = groups[`${m.agent}|${m.type}|${m.backend}/${m.model}`]
  const peer = med(g.costs)
  m.peer_median = r2(peer)
  m.ratio = peer > 0 ? Math.round((m.cost / peer) * 10) / 10 : null
}

// ---------- consumption per provider and per provider/model ----------
// Turns carry the backend they really ran on (see --cost-backends). Missions without turn spans are counted
// on the backend/model of their task. tokens_in: summed on cost backends (Claude = uncached input only),
// last value per mission on the others (Codex reports a cumulative session counter): never compare across.
function byKey(keyOf) {
  const acc = {}
  const get = (k, backend, model) => (acc[k] = acc[k] || { key: k, backend, model, missions: new Set(), missions_no_spans: 0, turns: 0, inferred_turns: 0, measured_turns: 0, cost: 0, tokens_out: 0, tokens_in_sum: 0, tokens_in_last: {}, disruptions: 0, minutes: [] })
  for (const r of turnsOut) {
    const g = get(keyOf(r.backend, r.model), r.backend, keyOf === byBackendKey ? null : r.model)
    g.missions.add(r.mission); g.turns++; if (r.attribution !== 'mission') g.inferred_turns++; if (r.measured) g.measured_turns++
    g.cost += r.raw_cost; g.tokens_out += r.tokens_out || 0
    if (COST_BACKENDS.has(r.backend)) g.tokens_in_sum += r.tokens_in || 0
    else g.tokens_in_last[r.mission] = Math.max(g.tokens_in_last[r.mission] || 0, r.tokens_in || 0)
  }
  for (const m of out) {
    const g = get(keyOf(m.backend, m.model), m.backend, keyOf === byBackendKey ? null : m.model)
    if (!g.missions.has(m.id)) { g.missions.add(m.id); if (!m.turns) g.missions_no_spans++ }
    // a mission without turn spans may still carry its own total: count it once, on its task's backend/model
    if (!m.turns && m.cost_source === 'mission total') { g.cost += m.cost; g.cost_from_mission_totals = (g.cost_from_mission_totals || 0) + m.cost }
    if (m.ended_at) g.minutes.push((m.ended_at - m.started_at) / 60000)
    if ((m.interrupted && !NORMAL_END.has(m.interrupted)) || m.status === 'failed') g.disruptions++
  }
  const totalCost = Object.values(acc).reduce((a, g) => a + g.cost, 0) || 1
  return Object.values(acc).map((g) => {
    const tin = g.tokens_in_sum + Object.values(g.tokens_in_last).reduce((a, x) => a + x, 0)
    return {
      key: g.key, backend: g.backend, model: g.model, missions: g.missions.size, missions_no_spans: g.missions_no_spans,
      turns: g.turns, measured_turns: g.measured_turns, inferred_turns: g.inferred_turns, cost: r2(g.cost), cost_from_mission_totals: r2(g.cost_from_mission_totals || 0), cost_share_pct: Math.round((g.cost / totalCost) * 100),
      cost_measured: COST_BACKENDS.has(g.backend), tokens_in: tin, tokens_in_method: COST_BACKENDS.has(g.backend) ? 'sum (uncached only)' : (g.backend === FALLBACK ? 'not comparable' : 'last cumulative value per mission'),
      tokens_out: g.tokens_out, disruptions: g.disruptions, median_minutes: Math.round(med(g.minutes) * 10) / 10,
    }
  }).sort((a, b) => b.cost - a.cost || b.turns - a.turns || b.missions - a.missions || a.key.localeCompare(b.key))
}
function byBackendKey(backend) { return backend }
const byBackend = byKey(byBackendKey)
const byModel = byKey((backend, model) => `${backend}/${model}`)
// turns per hour per provider, for the stacked chart
for (const r of turnsOut) { const b = hourly[hour(r.t)]; b.by_backend = b.by_backend || {}; b.by_backend[r.backend] = (b.by_backend[r.backend] || 0) + 1 }

// ---------- config drift ----------
const drift = out.filter((m) => m.config_model && m.model && m.config_model !== m.model)
  .reduce((a, m) => { const k = `${m.agent}: ${m.config_backend}/${m.config_model} -> ${m.backend}/${m.model}`; a[k] = (a[k] || 0) + 1; return a }, {})
const driftSorted = Object.fromEntries(Object.entries(drift).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))

const hours = Object.values(hourly).sort((a, b) => a.t - b.t).map((b) => ({ ...b, cost: r2(b.cost) }))
const total = out.reduce((a, m) => a + m.cost, 0)
const data = {
  generated_at: (MANIFEST && MANIFEST.as_of) || args['as-of'] || new Date().toISOString(), project: args.project || null, manifest: MANIFEST ? { method_version: MANIFEST.method_version, as_of: MANIFEST.as_of, since: MANIFEST.since, input_digest: MANIFEST.input_digest, timon_version: MANIFEST.timon_version, cli: MANIFEST.cli } : null,
  range: out.length ? { from: Math.min(...out.map((m) => m.started_at)), to: Math.max(...out.map((m) => m.ended_at || m.started_at)) } : null,
  totals: {
    missions: out.length, turns: turnsOut.length, unmeasured_turns: turnsOut.filter((r) => !r.measured).length,
    cost_window: r2(total), cost_in_spans: r2(total), cost_aggregate: r2(coverage.reduce((a, c) => a + (c.cost_aggregate || 0), 0)),
    cache_rewrite_cost: r2(events.filter((e) => e.kind === 'cache_rewrite').reduce((a, e) => a + (e.cost || 0), 0)),
    switches: events.filter((e) => e.kind === 'switch_out').length, interruptions: events.filter((e) => DISRUPTIONS.has(e.kind)).length,
  },
  coverage, groups: groupRows, model_drift: driftSorted, by_backend: byBackend, by_model: byModel, cost_backends: [...COST_BACKENDS],
  missions: out.sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id)), turns: turnsOut, events, hours,
}
fs.writeFileSync(args.out, JSON.stringify(data, null, 1))
console.log(JSON.stringify({ out: args.out, ...data.totals, traces: coverage.length }, null, 0))
