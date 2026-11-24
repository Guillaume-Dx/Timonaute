#!/usr/bin/env node
// Token/context audit - step 1: fetch a fixed snapshot of the inputs (read-only on Timon).
// Every input of the audit comes from here, through the `timon` CLI and the files of the Timon home,
// so two runs on the same scope and window read the same data. Writes only under --out.
//
// Usage:
//   node fetch.js --project <slug> [--days 7 | --since <ISO>] [--as-of <ISO>] --out <workdir>
//                 [--timon <path to the timon CLI>] [--home <~/.timon>]
// Defaults: window = the 7 days before --as-of; --as-of = now, floored to the minute (recorded in the manifest:
// pass the same --as-of to replay a run).
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const METHOD_VERSION = '4.0'
const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true
}
if (!args.project || !args.out) {
  console.error('usage: node fetch.js --project <slug> [--days 7 | --since ISO] [--as-of ISO] --out <workdir> [--timon PATH] [--home DIR]')
  process.exit(2)
}
const HOME = args.home || process.env.TIMON_HOME || path.join(os.homedir(), '.timon')
const TIMON = args.timon || 'timon'
const asOf = args['as-of'] ? Date.parse(args['as-of']) : Math.floor(Date.now() / 60000) * 60000
if (Number.isNaN(asOf)) { console.error('bad --as-of'); process.exit(2) }
const since = args.since ? Date.parse(args.since) : asOf - Number(args.days || 7) * 86400000
const OUT = path.resolve(args.out)
for (const d of ['', 'traces', 'agents', 'cli']) fs.mkdirSync(path.join(OUT, d), { recursive: true })

const log = []
function run(cmd, argv, opts = {}) {
  // timon is a .cmd on Windows: it needs a shell there. Arguments are ids and flags only (no user text).
  const q = (x) => (/^[\w.:\/@=-]+$/.test(x) ? x : '"' + String(x).replace(/"/g, '') + '"')
  const r = process.platform === 'win32'
    ? spawnSync([cmd, ...argv].map(q).join(' '), { encoding: 'utf8', shell: true, maxBuffer: 512 * 1024 * 1024, timeout: opts.timeout || 120000 })
    : spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: opts.timeout || 120000 })
  const ok = r.status === 0
  log.push({ cmd: [path.basename(cmd), ...argv].join(' '), ok, status: r.status })
  return ok ? r.stdout : null
}
const json = (txt) => { if (txt == null) return null; const i = txt.search(/[[{]/); if (i < 0) return null; try { return JSON.parse(txt.slice(i)) } catch { return null } }
const save = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data, null, 1)); return f }
const size = (f) => { try { return fs.statSync(f).size } catch { return null } }
const dirSize = (d) => { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? dirSize(path.join(d, e.name)) : size(path.join(d, e.name)) || 0 } catch { /* none */ } return n }

// ---- tasks of the project in the window (by creation time) ----
const allTasks = json(run(TIMON, ['task', 'list'])) || []
const tasks = allTasks.filter((t) => t.project === args.project && t.created_at >= since && t.created_at <= asOf)
  .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
save('tasks.json', tasks)

// ---- traces: every distinct series/trace of those tasks ----
const traceIds = [...new Set(tasks.flatMap((t) => [t.trace_id, t.series_id]).filter(Boolean))].sort()
for (const id of traceIds) {
  const txt = run(TIMON, ['trace', id, '--json'], { timeout: 300000 })
  if (txt) save(path.join('traces', `${id}.json`), txt.slice(txt.search(/[[{]/)))
}

// ---- agents of the project: config, identity docs, skills, reads, memory ----
const agentsDir = path.join(HOME, 'agents')
const agents = []
for (const name of fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).sort() : []) {
  const cfgFile = path.join(agentsDir, name, 'config.json')
  if (!fs.existsSync(cfgFile)) continue
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) } catch { continue }
  if (cfg.project !== args.project) continue
  const docs = fs.readdirSync(path.join(agentsDir, name)).filter((f) => f.toLowerCase().endsWith('.md')).sort()
    .map((f) => ({ file: f, bytes: size(path.join(agentsDir, name, f)) }))
  const resolved = json(run(TIMON, ['skill', 'resolve', name]))
  const reads = json(run(TIMON, ['skill', 'reads', name, '--json']))
  const skills = ((resolved && resolved.skills) || []).map((s) => ({
    ...s, skill_md_bytes: size(path.join(HOME, 'skills', s.id, 'SKILL.md')), folder_bytes: dirSize(path.join(HOME, 'skills', s.id)),
  }))
  const rules = json(run(TIMON, ['memory', 'rule', 'list', '--agent', name, '--json']))
  agents.push({ name, config: cfg, docs, skills, skill_reads: reads, agent_rules: rules })
  save(path.join('agents', `${name}.json`), agents[agents.length - 1])
}

// ---- shared context ----
const roles = [...new Set(agents.map((a) => a.config.role).filter(Boolean))].sort()
const memory = {
  project: json(run(TIMON, ['memory', 'rule', 'list', '--project', args.project, '--json'])),
  global: json(run(TIMON, ['memory', 'rule', 'list', '--scope', 'global', '--json'])),
  role: json(run(TIMON, ['memory', 'rule', 'list', '--scope', 'role', '--json'])),
  roles_in_scope: roles,
}
save('memory.json', memory)
save('mcp.json', json(run(TIMON, ['mcp', 'list'])) || [])
save('backends.json', json(run(TIMON, ['backends', '--json'])) || {})
save('doctor.json', json(run(TIMON, ['doctor', '--json'])) || {})
const series = {}
for (const id of traceIds) {
  series[id] = { roles: run(TIMON, ['series', 'role', 'list', '--series', id]), fallbacks: run(TIMON, ['series', 'fallback', 'list', '--series', id]) }
}
save('series.json', series)
save('routines.json', json(run(TIMON, ['routine', 'list'])) || run(TIMON, ['routine', 'list']) || [])
save('triggers.json', json(run(TIMON, ['trigger', 'list'])) || run(TIMON, ['trigger', 'list']) || [])
const banner = run(TIMON, [])
const firstLine = (t) => (t || '').trim().split(/\r?\n/)[0] || 'not found'
const cli = {
  timon: banner ? banner.split(/\r?\n/)[0].trim() : null,
  claude: firstLine(run('claude', ['--version'])),
  codex: firstLine(run('codex', ['--version'])),
  copilot: firstLine(run('copilot', ['--version'])),
}
save(path.join('cli', 'versions.json'), cli)

// ---- manifest: what was read, when, with which method ----
const hashes = {}
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name !== 'manifest.json') hashes[path.relative(OUT, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16) } }
walk(OUT)
const manifest = {
  method_version: METHOD_VERSION, project: args.project,
  as_of: new Date(asOf).toISOString(), since: new Date(since).toISOString(),
  counts: { tasks: tasks.length, traces: traceIds.length, agents: agents.length },
  timon_version: cli.timon, cli, commands: log, inputs: hashes,
  // doctor.json is live host state (timestamps, probes): kept for reading, left out of the digest so two
  // fetches of the same window can be compared.
  input_digest: crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(hashes).filter(([k]) => k !== 'doctor.json')))).digest('hex').slice(0, 16),
}
save('manifest.json', manifest)
console.log(JSON.stringify({ out: OUT, as_of: manifest.as_of, since: manifest.since, ...manifest.counts, failed_commands: log.filter((l) => !l.ok).map((l) => l.cmd), input_digest: manifest.input_digest }))
