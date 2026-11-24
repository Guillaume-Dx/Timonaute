#!/usr/bin/env node
// Token/context audit - HTML report renderer (read-only on Timon).
// Combines the measured data (collect.js output) with the auditor's findings into ONE self-contained
// HTML file: inline CSS, inline SVG charts, inline JS hover; no network, no external file.
//
// Usage: node report.js --snapshot <workdir> --out report.html
//        (reads <workdir>/data.json, findings.base.json and findings.json; refuses an invalid findings.json)
//    or: node report.js --data data.json --findings findings.json [--base findings.base.json] --out report.html
'use strict'
const fs = require('fs')
const path = require('path')

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[++i]
}
if (args.snapshot) {
  args.data = args.data || path.join(args.snapshot, 'data.json')
  args.findings = args.findings || path.join(args.snapshot, 'findings.json')
  args.base = args.base || path.join(args.snapshot, 'findings.base.json')
}
if (!args.data || !args.findings || !args.out) {
  console.error('usage: node report.js --snapshot <workdir> --out report.html')
  process.exit(2)
}
const D = JSON.parse(fs.readFileSync(args.data, 'utf8'))
const F = JSON.parse(fs.readFileSync(args.findings, 'utf8'))
const B = args.base && fs.existsSync(args.base) ? JSON.parse(fs.readFileSync(args.base, 'utf8')) : null

// ---------------------------------------------------------------- validation (same method every run)
// The base comes from analyze.js; the auditor may add and sharpen, never drop or downgrade.
function validate() {
  const errs = []
  const need = (obj, fields, where) => { for (const k of fields) if (obj[k] == null || obj[k] === '' || (Array.isArray(obj[k]) && !obj[k].length)) errs.push(`${where}: missing "${k}"`) }
  need(F, ['scope', 'date', 'question', 'summary', 'data_quality', 'findings', 'fixes', 'not_investigated'], 'findings.json')
  if (B) {
    if (F.rules_version !== B.rules_version) errs.push(`rules_version ${F.rules_version} differs from the base ${B.rules_version}: start again from findings.base.json`)
    for (const bf of B.findings || []) {
      const f = (F.findings || []).find((x) => x.id === bf.id)
      if (!f) { errs.push(`finding ${bf.id} of the base was removed (dismiss it with "status": "dismissed" and a "reason" instead)`); continue }
      if (f.status === 'dismissed') { if (!f.reason) errs.push(`finding ${bf.id} dismissed without a reason`); continue }
      if (f.severity !== bf.severity) errs.push(`finding ${bf.id}: severity changed from ${bf.severity} to ${f.severity} (severities come from the rules)`)
    }
    for (const bx of B.fixes || []) {
      const x = (F.fixes || []).find((y) => typeof y === 'object' && y.title === bx.title)
      if (!x) errs.push(`fix "${bx.title}" of the base was removed or renamed (dismiss it with "status": "dismissed" and a "reason")`)
      else if (x.status === 'dismissed' && !x.reason) errs.push(`fix "${bx.title}" dismissed without a reason`)
    }
  }
  const SEV = ['critical', 'serious', 'warning', 'info']
  for (const f of F.findings || []) {
    need(f, ['id', 'severity', 'area', 'finding', 'evidence'], `finding ${f.id || '?'}`)
    if (f.severity && !SEV.includes(f.severity)) errs.push(`finding ${f.id}: severity "${f.severity}" is not one of ${SEV.join('|')}`)
    if (f.status !== 'dismissed' && ['critical', 'serious'].includes(f.severity) && !(F.fixes || []).some((x) => typeof x === 'object' && x.status !== 'dismissed' && (x.refs || []).includes(f.id))) errs.push(`finding ${f.id} (${f.severity}) has no fix referring to it`)
  }
  for (const x of F.fixes || []) {
    if (typeof x !== 'object') { errs.push('a fix is a plain string: use the fix object (SKILL.md 6.1)'); continue }
    if (x.status === 'dismissed') continue
    need(x, ['title', 'effect', 'kind', 'where', 'steps', 'saving', 'frequency', 'effort', 'risk', 'verify', 'refs', 'owner'], `fix "${x.title || '?'}"`)
    if (x.effect && !['lowers', 'slows', 'both'].includes(x.effect)) errs.push(`fix "${x.title}": effect must be lowers|slows|both`)
    if (x.effort && !['S', 'M', 'L'].includes(x.effort)) errs.push(`fix "${x.title}": effort must be S|M|L`)
  }
  if (!F.code_scope) errs.push('code_scope is empty: write what was read in Timon\'s code, or "Timon code: not investigated" and why')
  for (const c of F.code_findings || []) {
    need(c, ['id', 'file', 'pattern', 'status', 'kind', 'finding', 'evidence', 'frequency', 'fix'], `code finding ${c.id || '?'}`)
    if (c.kind === 'bug') need(c, ['expected', 'actual', 'repro'], `code finding ${c.id} (bug)`)
    if (c.kind === 'improvement') need(c, ['problem', 'proposal'], `code finding ${c.id} (improvement)`)
    if (c.status && !['confirmed', 'lead'].includes(c.status)) errs.push(`code finding ${c.id}: status must be confirmed|lead`)
  }
  return errs
}
const problems = validate()
if (problems.length) {
  console.error('findings.json does not follow the method; no report written:\n- ' + problems.join('\n- '))
  process.exit(1)
}
// Dismissed items stay visible but out of the ranking.
F.findings = (F.findings || []).filter((f) => f.status !== 'dismissed').concat((F.findings || []).filter((f) => f.status === 'dismissed').map((f) => ({ ...f, severity: 'info', finding: `[dismissed: ${f.reason}] ${f.finding}` })))
F.fixes = (F.fixes || []).filter((x) => x.status !== 'dismissed')

const REPORT_VERSION = '4.1'
const escPlain = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const money = (x) => (x == null ? 'not measured' : '$' + Number(x).toFixed(2))
const agentShort = (a) => { const s = String(a || ''); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(i + 1) : s }

// Mission and trace ids are shown as "Agent · mission title", never as hex ids.
// Keys: the full id and its 8-character prefix. A trace id resolves to the
// mission that opened it (same id), else to its first mission.
const ID_LABEL = new Map()
const ID_TITLE = new Map()
{
  const seen = new Map()
  const clip = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > 48 ? s.slice(0, 47) + '…' : s }
  const ms = (D.missions || []).slice().sort((a, b) => (a.started_at || 0) - (b.started_at || 0) || String(a.id).localeCompare(String(b.id)))
  for (const m of ms) {
    if (!m || !m.id) continue
    let title = clip(m.title) || `${m.type || 'chat'} mission ${m.started_at ? hhmmOf(m.started_at) : ''}`.trim()
    const base = `${agentShort(m.agent)} · ${title}`
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    if (n > 1) title += ` #${n}`
    const label = `${agentShort(m.agent)} · ${title}`
    for (const k of [m.id, String(m.id).slice(0, 8)]) { ID_LABEL.set(k, label); ID_TITLE.set(k, title) }
  }
  for (const m of ms) {
    for (const k of [m.trace_id, String(m.trace_id || '').slice(0, 8)]) {
      if (k && !ID_LABEL.has(k)) { ID_LABEL.set(k, ID_LABEL.get(m.id)); ID_TITLE.set(k, ID_TITLE.get(m.id)) }
    }
  }
}
function hhmmOf(t) { const d = new Date(t); return d.toISOString().slice(5, 10) + ' ' + d.toISOString().slice(11, 16) }
const ID_RE = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\b/g
const labelIds = (s) => String(s == null ? '' : s).replace(ID_RE, (x) => ID_LABEL.get(x) || ID_LABEL.get(x.slice(0, 8)) || x)
const redactIds = (s) => String(s == null ? '' : s).replace(ID_RE, (x) => (ID_LABEL.has(x) || ID_LABEL.has(x.slice(0, 8)) ? '<mission>' : x))
const esc = (s) => escPlain(labelIds(s))
/** Mission or trace label: "Agent · title". */
const short = (id) => ID_LABEL.get(String(id || '')) || ID_LABEL.get(String(id || '').slice(0, 8)) || String(id || '').slice(0, 8)
/** Mission title alone, for tables that already have an Agent column. */
const mtitle = (id) => ID_TITLE.get(String(id || '')) || ID_TITLE.get(String(id || '').slice(0, 8)) || String(id || '').slice(0, 8)
const hhmm = (t) => { const d = new Date(t); return d.toISOString().slice(5, 10) + ' ' + d.toISOString().slice(11, 16) }
const list = (a) => (a && a.length ? '<ul>' + a.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '<p class="muted">None.</p>')

function table(rows, cols, opts = {}) {
  if (!rows || !rows.length) return '<p class="muted">None.</p>'
  const head = cols.map((c) => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')
  const body = rows.map((r) => '<tr>' + cols.map((c) => {
    const v = typeof c.get === 'function' ? c.get(r) : r[c.key]
    return `<td${c.num ? ' class="num"' : ''}>${c.html ? v : esc(v)}</td>`
  }).join('') + '</tr>').join('')
  return `<div class="tw"><table${opts.id ? ` id="${opts.id}"` : ''}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

const SEV = { critical: '&#9650;', serious: '&#9670;', warning: '&#9679;', info: '&#9675;' }
const sevBadge = (s) => s ? `<span class="sev sev-${esc(s)}">${SEV[s] || ''} ${esc(s)}</span>` : ''

// ---------------------------------------------------------------- timeline chart
function timeline() {
  const turns = D.turns || []
  if (!turns.length) return '<p class="muted">No turn spans in the traces: chronology not measured.</p>'
  const W = 1040, PL = 120, PR = 16, PT = 16, PH = 250, LANE = 26
  const lanes = ['no cost reported', 'switches', 'disruptions']
  const H = PT + PH + 28 + lanes.length * LANE + 10
  const t0 = Math.min(...turns.map((r) => r.t)), t1 = Math.max(...turns.map((r) => r.end || r.t))
  const span = Math.max(1, t1 - t0)
  const x = (t) => PL + ((t - t0) / span) * (W - PL - PR)
  const maxC = Math.max(0.5, ...turns.map((r) => r.raw_cost || 0))
  const niceMax = Math.ceil(maxC * 2) / 2
  const y = (c) => PT + PH - (c / niceMax) * PH
  const laneY = (i) => PT + PH + 28 + i * LANE + LANE / 2

  // top 3 missions by cost get slots 1-3, the rest fold to "Other"
  const byMission = {}
  for (const r of turns) (byMission[r.mission] = byMission[r.mission] || []).push(r)
  const ranked = Object.entries(byMission).map(([id, rs]) => [id, rs.reduce((a, r) => a + (r.raw_cost || 0), 0), rs[0].agent])
    .filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])
  const slot = {}
  ranked.slice(0, 3).forEach(([id], i) => { slot[id] = i + 1 })

  let g = ''
  // grid + y axis
  for (let i = 0; i <= 4; i++) {
    const v = (niceMax / 4) * i
    g += `<line class="grid" x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${PL - 6}" y="${y(v) + 4}" text-anchor="end">$${v.toFixed(2)}</text>`
  }
  // x ticks every ~2-6h
  const stepH = span > 36 * 3600e3 ? 6 : span > 12 * 3600e3 ? 3 : 1
  const first = Math.ceil(t0 / (stepH * 3600e3)) * stepH * 3600e3
  for (let t = first; t <= t1; t += stepH * 3600e3) {
    g += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${PT}" y2="${PT + PH}"/><text class="ax" x="${x(t)}" y="${PT + PH + 16}" text-anchor="middle">${hhmm(t)}</text>`
  }
  g += `<line class="base" x1="${PL}" x2="${W - PR}" y1="${PT + PH}" y2="${PT + PH}"/>`
  lanes.forEach((l, i) => { g += `<text class="ax" x="${PL - 6}" y="${laneY(i) + 4}" text-anchor="end">${esc(l)}</text><line class="grid" x1="${PL}" x2="${W - PR}" y1="${laneY(i) + LANE / 2}" y2="${laneY(i) + LANE / 2}"/>` })

  // fallback windows: switch_out -> next switch_back of the same mission
  const ev = D.events || []
  for (const o of ev.filter((e) => e.kind === 'switch_out' || e.kind === 'start_unmeasured')) {
    const back = ev.find((e) => e.kind === 'switch_back' && e.mission === o.mission && e.t > o.t)
    const end = back ? back.t : Math.max(...(byMission[o.mission] || [{ t: o.t }]).map((r) => r.end || r.t))
    if (!slot[o.mission]) continue
    g += `<rect class="band" x="${x(o.t)}" y="${PT}" width="${Math.max(2, x(end) - x(o.t))}" height="${PH}" data-tip="${esc(short(o.mission))} on a backend that reports no cost: ${hhmm(o.t)} to ${hhmm(end)}"/>`
  }
  // lines per top mission (measured turns only)
  for (const [id] of ranked.slice(0, 3)) {
    const pts = byMission[id].filter((r) => r.measured)
    let d = ''
    pts.forEach((r, i) => {
      const prev = pts[i - 1]
      const breakLine = !prev || r.flags.includes('switch_back') || r.flags.includes('context_drop') || r.t - prev.t > 45 * 60000
      d += `${breakLine ? 'M' : 'L'}${x(r.t).toFixed(1)},${y(r.raw_cost).toFixed(1)}`
    })
    g += `<path class="ln s${slot[id]}" d="${d}"/>`
  }
  // dots
  for (const r of turns) {
    const tip = `${esc(short(r.mission))} | ${hhmm(r.t)} | ${r.measured ? '$' + r.raw_cost.toFixed(2) : 'no cost reported'} | in ${r.tokens_in ?? '-'} / out ${r.tokens_out ?? '-'}${r.flags.length ? ' | ' + r.flags.join(', ') : ''}`
    if (!r.measured) { g += `<rect class="tick" x="${x(r.t) - 1}" y="${laneY(0) - 7}" width="2" height="14" data-tip="${tip}"/><rect class="hit" x="${x(r.t) - 5}" y="${laneY(0) - 10}" width="10" height="20" data-tip="${tip}"/>`; continue }
    const cls = slot[r.mission] ? `s${slot[r.mission]}` : 'other'
    g += `<circle class="dot ${cls}" cx="${x(r.t)}" cy="${y(r.raw_cost)}" r="4"/>`
    if (r.flags.includes('cache_rewrite')) g += `<circle class="ring" cx="${x(r.t)}" cy="${y(r.raw_cost)}" r="8"/>`
    g += `<circle class="hit" cx="${x(r.t)}" cy="${y(r.raw_cost)}" r="9" data-tip="${tip}"/>`
  }
  // events lanes
  for (const e of ev) {
    const tip = `${hhmm(e.t)} ${esc(e.kind)} | ${esc(short(e.mission))} | ${esc(e.detail || '')}${e.cause ? ' | likely trigger: ' + esc(e.cause) : ''}`
    if (['switch_out', 'switch_back', 'start_unmeasured', 'cache_rewrite', 'context_drop'].includes(e.kind)) {
      const sym = { switch_out: '&#8600;', switch_back: '&#8599;', start_unmeasured: '&#8614;', cache_rewrite: '&#10227;', context_drop: '&#8615;' }[e.kind]
      g += `<text class="evs" x="${x(e.t)}" y="${laneY(1) + 5}" text-anchor="middle" data-tip="${tip}">${sym}</text>`
    } else {
      g += `<path class="crit" d="M${x(e.t)},${laneY(2) - 7} l6,12 h-12z" data-tip="${tip}"/>`
    }
  }
  const legend = ranked.slice(0, 3).map(([id, c, a], i) => `<span class="lg"><i class="sw s${i + 1}"></i>${esc(short(id))} (${money(c)})</span>`).join('') +
    (ranked.length > 3 ? '<span class="lg"><i class="sw other"></i>Other missions</span>' : '') +
    '<span class="lg"><i class="sw band"></i>On a no-cost backend</span><span class="lg"><i class="sw ringk"></i>Cache rewrite</span>' +
    '<span class="lg"><b class="crit-t">&#9650;</b> Rate limit / crash / failure</span><span class="lg">&#8600; switch out &#8599; switch back &#8615; context drop &#8614; started unmeasured</span>'
  return `<div class="legend">${legend}</div><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost per turn over time">${g}</svg>`
}

// ---------------------------------------------------------------- hourly chart
function hourly() {
  const raw = D.hours || []
  if (!raw.length) return ''
  const byT = Object.fromEntries(raw.map((h) => [h.t, h]))
  const hs = []
  for (let t = raw[0].t; t <= raw[raw.length - 1].t; t += 3600e3) hs.push(byT[t] || { t, cost: 0, turns: 0, unmeasured_turns: 0, missions_started: 0, interruptions: 0 })
  const W = 1040, PL = 120, PR = 16, PT = 12, PH = 140
  const H = PT + PH + 24
  const bw = (W - PL - PR) / hs.length
  const maxC = Math.max(0.5, ...hs.map((h) => h.cost))
  const niceMax = Math.ceil(maxC)
  const y = (c) => PT + PH - (c / niceMax) * PH
  let g = ''
  for (let i = 0; i <= 2; i++) { const v = (niceMax / 2) * i; g += `<line class="grid" x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${PL - 6}" y="${y(v) + 4}" text-anchor="end">$${v.toFixed(0)}</text>` }
  hs.forEach((h, i) => {
    const bx = PL + i * bw + 1, w = Math.max(2, bw - 2)
    const tip = `${hhmm(h.t)} | recorded ${money(h.cost)} | ${h.turns} turns (${h.unmeasured_turns} no cost) | ${h.missions_started} missions started | ${h.interruptions} disruptions`
    if (h.cost > 0) g += `<path class="bar" d="M${bx},${PT + PH} V${y(h.cost) + 4} q0,-4 4,-4 h${w - 8} q4,0 4,4 V${PT + PH}z"/>`
    if (h.interruptions) g += `<path class="crit" d="M${bx + w / 2},${PT + 2} l5,9 h-10z"/>`
    g += `<rect class="hit" x="${bx}" y="${PT}" width="${w}" height="${PH}" data-tip="${tip}"/>`
    if (i % Math.ceil(hs.length / 10) === 0) g += `<text class="ax" x="${bx + w / 2}" y="${PT + PH + 16}" text-anchor="middle">${hhmm(h.t)}</text>`
  })
  g += `<line class="base" x1="${PL}" x2="${W - PR}" y1="${PT + PH}" y2="${PT + PH}"/>`
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Recorded cost per hour">${g}</svg>`
}

// ---------------------------------------------------------------- per provider / model
// Fixed colour per provider (colour follows the entity): slots in the order providers first appear in
// by_backend, max 3; the unidentified fallback and any 4th provider are gray.
const FALLBACK = 'fallback (not identified)'
const providerSlot = {}
;(D.by_backend || []).filter((b) => b.backend !== FALLBACK).forEach((b, i) => { if (i < 3) providerSlot[b.backend] = 's' + (i + 1) })
const pcls = (b) => providerSlot[b] || 'other'

function modelBars() {
  const rows = (D.by_model || [])
  if (!rows.length) return ''
  const W = 1040, PL = 260, PR = 150, RH = 24, PT = 6
  const H = PT + rows.length * RH + 6
  const maxC = Math.max(0.01, ...rows.map((r) => r.cost))
  const x = (c) => PL + (c / maxC) * (W - PL - PR)
  let g = ''
  rows.forEach((r, i) => {
    const yy = PT + i * RH
    const label = r.backend === FALLBACK ? FALLBACK : r.key
    const tip = `${label} | ${r.missions} missions (${r.missions_no_spans} without turn spans) | ${r.turns} turns (${r.inferred_turns} attributed by inference) | ${r.cost_measured || r.cost > 0 ? money(r.cost) + ' (' + r.cost_share_pct + ' %)' : 'cost not reported'} | ${r.disruptions} disruptions`
    g += `<text class="ax lbl" x="${PL - 8}" y="${yy + 16}" text-anchor="end">${esc(label)}</text>`
    if (r.cost > 0) {
      const w = Math.max(3, x(r.cost) - PL)
      g += `<path class="pb ${pcls(r.backend)}" d="M${PL},${yy + 5} h${w - 4} q4,0 4,4 v6 q0,4 -4,4 h-${w - 4}z"/>`
      g += `<text class="val" x="${PL + w + 6}" y="${yy + 16}">${money(r.cost)} · ${r.cost_share_pct} %</text>`
    } else {
      g += `<text class="ax" x="${PL + 6}" y="${yy + 16}">${r.turns || r.missions ? 'cost not reported · ' + r.missions + ' missions, ' + r.turns + ' turns' : ''}</text>`
    }
    g += `<rect class="hit" x="0" y="${yy}" width="${W}" height="${RH}" data-tip="${esc(tip)}"/>`
  })
  g += `<line class="base" x1="${PL}" x2="${PL}" y1="${PT}" y2="${H - 6}"/>`
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Recorded cost per provider and model">${g}</svg>`
}

function providerHours() {
  const raw = D.hours || []
  if (!raw.length || !raw.some((h) => h.by_backend)) return ''
  const byT = Object.fromEntries(raw.map((h) => [h.t, h]))
  const hs = []
  for (let t = raw[0].t; t <= raw[raw.length - 1].t; t += 3600e3) hs.push(byT[t] || { t, by_backend: {} })
  const order = (D.by_backend || []).map((b) => b.backend)
  const W = 1040, PL = 120, PR = 16, PT = 12, PH = 120, H = PT + PH + 24
  const bw = (W - PL - PR) / hs.length
  const maxT = Math.max(1, ...hs.map((h) => Object.values(h.by_backend || {}).reduce((a, x) => a + x, 0)))
  const y = (v) => PT + PH - (v / maxT) * PH
  let g = ''
  for (let i = 0; i <= 2; i++) { const v = Math.round((maxT / 2) * i); g += `<line class="grid" x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${PL - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>` }
  hs.forEach((h, i) => {
    const bx = PL + i * bw + 1, w = Math.max(2, bw - 2)
    let acc = 0
    const parts = []
    for (const b of order) {
      const n = (h.by_backend || {})[b] || 0
      if (!n) continue
      const top = y(acc + n), bottom = y(acc)
      g += `<rect class="pb ${pcls(b)}" x="${bx}" y="${top + 1}" width="${w}" height="${Math.max(1, bottom - top - 2)}" rx="2"/>`
      acc += n; parts.push(`${b}: ${n}`)
    }
    if (acc) g += `<rect class="hit" x="${bx}" y="${PT}" width="${w}" height="${PH}" data-tip="${esc(hhmm(h.t) + ' | turns per provider | ' + parts.join(' | '))}"/>`
    if (i % Math.ceil(hs.length / 10) === 0) g += `<text class="ax" x="${bx + w / 2}" y="${PT + PH + 16}" text-anchor="middle">${hhmm(h.t)}</text>`
  })
  g += `<line class="base" x1="${PL}" x2="${W - PR}" y1="${PT + PH}" y2="${PT + PH}"/>`
  const legend = order.map((b) => `<span class="lg"><i class="sw ${pcls(b)}"></i>${esc(b)}</span>`).join('')
  return `<div class="legend">${legend}</div><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Turns per hour by provider">${g}</svg>`
}

const providerCols = (withModel) => [
  ...(withModel ? [{ label: 'Provider/model', get: (r) => (r.backend === FALLBACK ? FALLBACK : r.key) }] : [{ label: 'Provider', key: 'backend' }]),
  { label: 'Missions', key: 'missions', num: true },
  { label: 'No turn spans', key: 'missions_no_spans', num: true },
  { label: 'Turns', key: 'turns', num: true },
  { label: 'Inferred turns', key: 'inferred_turns', num: true },
  { label: 'Recorded cost', get: (r) => (r.cost > 0 || r.cost_measured ? money(r.cost) : 'not reported'), num: true },
  { label: 'Share', get: (r) => (r.cost > 0 ? r.cost_share_pct + ' %' : '-'), num: true },
  { label: 'Tokens in', get: (r) => (r.tokens_in ? r.tokens_in.toLocaleString('en-US') : '-'), num: true },
  { label: 'Tokens in counted as', key: 'tokens_in_method' },
  { label: 'Tokens out', get: (r) => (r.tokens_out ? r.tokens_out.toLocaleString('en-US') : '-'), num: true },
  { label: 'Disruptions', key: 'disruptions', num: true },
  { label: 'Median min', key: 'median_minutes', num: true },
]

// ---------------------------------------------------------------- fixes, bugs, issue prompts
const EFFECT = { lowers: 'Lowers consumption', slows: 'Slows consumption', both: 'Lowers and slows' }
function fixCards(fixes) {
  if (!fixes || !fixes.length) return '<p class="muted">None.</p>'
  return fixes.map((f, i) => {
    if (typeof f === 'string') return `<div class="card"><div class="ch"><b>${i + 1}. ${esc(f)}</b></div></div>`
    const chips = [f.effect && `<span class="chip eff-${esc(f.effect)}">${esc(EFFECT[f.effect] || f.effect)}</span>`, f.kind && `<span class="chip">${esc(f.kind)}</span>`, f.effort && `<span class="chip">effort ${esc(f.effort)}</span>`, (f.refs || []).length && `<span class="chip">answers ${esc(f.refs.join(', '))}</span>`].filter(Boolean).join('')
    const row = (k, v) => (v ? `<div class="kv"><span>${k}</span><div>${v}</div></div>` : '')
    return `<div class="card"><div class="ch"><b>${i + 1}. ${esc(f.title)}</b><div class="chips">${chips}</div></div>
${row('Saving', esc(f.saving) + (f.frequency ? ` <span class="muted">· ${esc(f.frequency)}</span>` : ''))}
${row('Where', esc(f.where))}
${f.steps && f.steps.length ? row('Steps', '<ol>' + f.steps.map((x) => `<li>${esc(x)}</li>`).join('') + '</ol>') : ''}
${row('Risk', esc(f.risk))}
${row('Verify', esc(f.verify))}
${row('Owner', esc(f.owner))}</div>`
  }).join('')
}

function issuePrompt(c) {
  const i = c.issue || {}
  const repo = i.repo || '<owner>/<repo>'
  const isBug = (i.type || (c.kind === 'bug' ? 'bug' : 'feature')) === 'bug'
  const loc = `${c.file}${c.line ? ':' + c.line : ''}`
  const body = isBug
    ? [
        '### What happened', `${c.actual || c.finding}\n\nExpected: ${c.expected || '(state the expected behaviour)'}\n\nWhere in the code: \`${loc}\`. Impact on token use: ${c.evidence || ''}`,
        '### Steps to reproduce', (c.repro && c.repro.length ? c.repro : ['(write the shortest reproduction on a test install)']).map((x, n) => `${n + 1}. ${x}`).join('\n'),
        '### Timon version', c.version || '(run \`timon\` with no argument: the first line is the version)',
        '### System', '(OS and version)',
        '### Output of \`timon doctor\`', '(run \`timon doctor\`, remove personal data)',
        '### Logs or screenshots', '(optional; no secrets, no personal paths)',
      ].join('\n\n')
    : [
        '### The problem', `${c.problem || c.finding}\n\nWhere in the code: \`${loc}\`. Measured impact: ${c.evidence || ''}${c.frequency ? ' (' + c.frequency + ')' : ''}`,
        '### What you would like', c.proposal || c.fix || '',
        '### Could it be a plugin?', 'No: it is core daemon behaviour.',
      ].join('\n\n')
  return `Draft a GitHub issue for the Timon repository ${repo}, using its "${isBug ? 'Bug report' : 'Feature request'}" template (label: ${isBug ? 'bug' : 'enhancement'}).

Rules:
- Do NOT create the issue yet. First show me the final title and body.
- Remove personal data: user names in paths (write ~ or <home>), e-mail addresses, private project and agent names, mission and task ids. Keep numbers and file paths inside the Timon repository.
${isBug ? '- Run \`timon\` with no argument (the first line is the version) and \`timon doctor\`, and fill those sections, redacted.\n' : ''}- Check that no open issue already covers it: gh issue list --repo ${repo} --search "<key words>".
- Wait for my explicit confirmation, then run: gh issue create --repo ${repo} --title "<title>" --label ${isBug ? 'bug' : 'enhancement'} --body-file <file>

Title: ${i.title || c.finding}

Body:
${body}`
}

function codeSection(rows) {
  if (!rows || !rows.length) return '<p class="muted">None.</p>'
  const tbl = table(rows, [
    { label: 'Id', get: (r) => r.id || '' },
    { label: 'Where', get: (r) => `<code>${esc(r.file)}${r.line ? ':' + esc(r.line) : ''}</code>`, html: true },
    { label: 'Kind', get: (r) => (r.kind ? `<span class="chip ${r.kind === 'bug' ? 'k-bug' : ''}">${esc(r.kind)}</span>` : ''), html: true },
    { label: 'Status', get: (r) => (r.status ? `<span class="sev ${r.status === 'confirmed' ? 'sev-serious' : 'sev-info'}">${esc(r.status)}</span>` : ''), html: true },
    { label: 'Area', key: 'pattern' }, { label: 'Finding', key: 'finding' }, { label: 'Evidence', key: 'evidence' },
    { label: 'Frequency', key: 'frequency' }, { label: 'Proposed change', key: 'fix' },
  ])
  const prompts = rows.filter((r) => r.issue).map((r, n) => {
    const p = issuePrompt(r)
    const tid = 'ip' + n
    return `<details class="issue"><summary>${esc(r.id || '')} ${r.kind === 'bug' ? 'Bug' : 'Improvement'}: ${esc(r.issue.title || r.finding)} — follow-up prompt to open an issue</summary>
<p class="muted">Paste this into a mission (an agent with the gh CLI) if you want to report it. The agent shows the draft and waits for your confirmation before anything is published.</p>
<textarea id="${tid}" readonly rows="14">${escPlain(redactIds(p))}</textarea><button type="button" class="copy" data-copy="${tid}">Copy prompt</button></details>`
  }).join('')
  return tbl + (prompts ? '<h3>Report to the Timon maintainers</h3>' + prompts : '')
}

// ---------------------------------------------------------------- page
const T = D.totals || {}
const cov = (D.coverage || [])
const covPct = T.cost_aggregate ? Math.round((T.cost_in_spans / T.cost_aggregate) * 100) : null
const tiles = [
  ['Cost in the window', money(T.cost_window ?? T.cost_in_spans), 'turn spans + mission totals'],
  ['Trace aggregates', money(T.cost_aggregate), 'whole series, any time: not comparable between runs'],
  ['Missions', T.missions, `${T.turns} turns with spans`],
  ['Turns with no cost', T.turns ? Math.round((T.unmeasured_turns / T.turns) * 100) + ' %' : '-', 'not measured, not free'],
  ['Backend switches', T.switches, `${money(T.cache_rewrite_cost)} in cache rewrites`],
  ['Disruptions', T.interruptions, 'rate limits, crashes, failures'],
]
const chrono = (D.events || []).filter((e) => e.kind !== 'start_unmeasured' || true)

// ---------------------------------------------------------------- what was analysed (fixed list, fixed mapping)
// Each row is one area of the method. Its status is the worst OPEN finding mapped to it; the colour is that
// severity, which the rules define by weight on consumption. Same rows, same order, every report.
const nAgents = (F.spawn_weight || []).length
const AREAS = [
  { label: 'Spawn weight', what: `identity docs, imported and catalogue skills, memory rules of ${nAgents} agent(s)`, ids: ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B6', 'B7'] },
  { label: 'MCP servers', what: 'servers attached to the agents: connection status and use in tool spans', ids: ['C1', 'C2', 'C3', 'C4', 'C5'] },
  { label: 'Orchestration', what: `chained review, merge and doc tasks, review loops, models and reasoning per role (${T.missions} missions)`, ids: ['D1', 'D2', 'D3', 'D4', 'D5', 'D5b', 'D6', 'D7', 'D8'] },
  { label: 'Context growth', what: `cost per turn inside each session, compactions, rewrites after pauses (${T.turns} turns)`, ids: ['E2', 'E3', 'E4', 'E6', 'E7', 'E8'] },
  { label: 'Backend switches', what: 'missions moved to another backend and back, cache rewrites, likely triggers', ids: ['E1', 'E5'] },
  { label: 'Quota and provider', what: 'rate limits, crashes, model ids the backends do not offer, CLI versions', ids: ['R1', 'F3', 'F4', 'F8'] },
  { label: 'Cost visibility', what: `consumption per provider and model, missions without measured cost, trace coverage (${cov.length} trace(s))`, ids: ['F1', 'F2', 'F5', 'F6', 'F7'] },
]
const SEV_ORDER = ['critical', 'serious', 'warning', 'info']
const openFindings = (F.findings || []).filter((f) => !/^\[dismissed/.test(f.finding))
const known = new Set(AREAS.flatMap((a) => a.ids))
const extra = openFindings.filter((f) => !known.has(f.id))
const areaRows = AREAS.map((a) => ({ ...a, items: openFindings.filter((f) => a.ids.includes(f.id)) }))
if (extra.length) areaRows.push({ label: 'Other causes', what: 'causes added by the auditor from the checklist', items: extra })
// Timon code: a confirmed bug weighs like a serious finding, a lead or an improvement like a warning.
const codeNotRead = !F.code_scope || /not investigated/i.test(F.code_scope)
const codeItems = (F.code_findings || []).map((c) => ({ id: c.id, severity: c.kind === 'bug' && c.status === 'confirmed' ? 'serious' : 'warning', finding: `${c.kind || 'finding'} (${c.status || '?'}): ${c.finding}` }))
areaRows.push({ label: 'Timon code', what: codeNotRead ? 'not analysed in this run' : F.code_scope, items: codeItems, notRead: codeNotRead })

function statusChip(r) {
  if (r.notRead) return '<span class="st st-none">&#9675; Not analysed</span>'
  if (!r.items.length) return '<span class="st st-good">&#10003; No finding</span>'
  const worst = SEV_ORDER.find((s) => r.items.some((f) => f.severity === s)) || 'info'
  const counts = SEV_ORDER.map((s) => [s, r.items.filter((f) => f.severity === s).length]).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(', ')
  return `<span class="st st-${worst}">${SEV[worst] || ''} ${esc(counts)}</span>`
}
function areaBand(r) { if (r.notRead) return 'none'; if (!r.items.length) return 'good'; return SEV_ORDER.find((s) => r.items.some((f) => f.severity === s)) || 'info' }
const analysed = `<div class="areas">${areaRows.map((r) => `<div class="area band-${areaBand(r)}">
<div class="an"><b>${esc(r.label)}</b><span class="muted">${esc(r.what)}</span></div>
<div class="as">${statusChip(r)}${r.items.length ? `<span class="ids">${r.items.map((f) => `<span data-tip="${esc(f.id + ': ' + f.finding)}">${esc(f.id)}</span>`).join(' ')}</span>` : ''}</div></div>`).join('')}</div>
<p class="legend"><span class="lg"><i class="sw b-critical"></i>Critical: the largest driver of consumption</span><span class="lg"><i class="sw b-serious"></i>Serious: a clear, repeated waste</span><span class="lg"><i class="sw b-warning"></i>Warning: small or rare</span><span class="lg"><i class="sw b-info"></i>Info: context</span><span class="lg"><i class="sw b-good"></i>No finding</span><span class="lg"><i class="sw b-none"></i>Not analysed</span></p>`

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Token/context audit - ${esc(F.scope)}</title>
<style>
.viz-root{color-scheme:light;--surface-1:#fcfcfb;--surface-2:#f5f4f0;--text-primary:#0b0b0b;--text-secondary:#52514e;--muted:#898781;--grid:#e1e0d9;--base:#c3c2b7;--border:rgba(11,11,11,.10);
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--other:#898781;--band:rgba(137,135,129,.14);--good:#0ca30c;--warning:#fab219;--serious:#ec835a;--critical:#d03b3b}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .viz-root{color-scheme:dark;--surface-1:#1a1a19;--surface-2:#232321;--text-primary:#f0efec;--text-secondary:#c3c2b7;--grid:#2c2c2a;--base:#383835;--border:rgba(255,255,255,.10);--s1:#3987e5;--s2:#d95926;--s3:#199e70;--band:rgba(195,194,183,.10)}}
:root[data-theme="dark"] .viz-root{color-scheme:dark;--surface-1:#1a1a19;--surface-2:#232321;--text-primary:#f0efec;--text-secondary:#c3c2b7;--grid:#2c2c2a;--base:#383835;--border:rgba(255,255,255,.10);--s1:#3987e5;--s2:#d95926;--s3:#199e70;--band:rgba(195,194,183,.10)}
body{margin:0}.viz-root{background:var(--surface-1);color:var(--text-primary);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 28px;max-width:1120px;margin:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px;padding-top:8px;border-top:1px solid var(--border)}h3{font-size:14px;margin:18px 0 6px;color:var(--text-secondary)}
.muted,.sub{color:var(--text-secondary)}.sub{margin:0 0 16px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
.tile{background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px}.tile b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.tile span{font-size:12px;color:var(--text-secondary)}
.summary{background:var(--surface-2);border-left:3px solid var(--s1);padding:10px 14px;border-radius:4px}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--grid);vertical-align:top}th{color:var(--text-secondary);font-weight:600;position:sticky;top:0;background:var(--surface-1)}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}code{font-size:12px;background:var(--surface-2);padding:1px 4px;border-radius:3px}
.chart{width:100%;height:auto;display:block}.grid{stroke:var(--grid);stroke-width:1}.base{stroke:var(--base);stroke-width:1}.ax{fill:var(--muted);font-size:11px}
.ln{fill:none;stroke-width:2}.ln.s1{stroke:var(--s1)}.ln.s2{stroke:var(--s2)}.ln.s3{stroke:var(--s3)}
.dot{stroke:var(--surface-1);stroke-width:2}.dot.s1{fill:var(--s1)}.dot.s2{fill:var(--s2)}.dot.s3{fill:var(--s3)}.dot.other{fill:var(--other)}
.ring{fill:none;stroke:var(--serious);stroke-width:2}.band{fill:var(--band)}.tick{fill:var(--other)}.hit{fill:transparent;cursor:default}.bar{fill:var(--s1)}
.pb.s1{fill:var(--s1)}.pb.s2{fill:var(--s2)}.pb.s3{fill:var(--s3)}.pb.other{fill:var(--other)}.lbl{fill:var(--text-secondary);font-size:12px}.val{fill:var(--text-primary);font-size:12px;font-variant-numeric:tabular-nums}
.crit{fill:var(--critical)}.evs{fill:var(--text-secondary);font-size:15px;cursor:default}.crit-t{color:var(--critical)}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--text-secondary);margin:6px 0}.lg{display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px}.sw.s1{background:var(--s1)}.sw.s2{background:var(--s2)}.sw.s3{background:var(--s3)}.sw.other{background:var(--other)}.sw.band{background:var(--band);border:1px solid var(--base)}.sw.ringk{border:2px solid var(--serious);border-radius:50%;background:none}
.sev{white-space:nowrap;font-size:12px}.sev-critical{color:var(--critical)}.sev-serious{color:var(--serious)}.sev-warning{color:var(--text-secondary)}.sev-info{color:var(--muted)}
#tip{position:fixed;pointer-events:none;background:var(--text-primary);color:var(--surface-1);font-size:12px;padding:6px 8px;border-radius:6px;max-width:420px;display:none;z-index:9;box-shadow:0 2px 8px rgba(0,0,0,.2)}
details{margin:8px 0}summary{cursor:pointer;color:var(--text-secondary)}
.areas{display:grid;gap:6px;margin:8px 0}.area{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;background:var(--surface-2);border:1px solid var(--border);border-left:5px solid var(--band-c);border-radius:6px;padding:8px 12px}
.an b{display:block}.an span{font-size:12px}.as{display:flex;flex-direction:column;align-items:flex-end;gap:3px}.ids{font-size:11px;color:var(--text-secondary)}.ids span{cursor:default;text-decoration:underline dotted}
.band-critical{--band-c:var(--critical)}.band-serious{--band-c:var(--serious)}.band-warning{--band-c:var(--warning)}.band-info{--band-c:var(--muted)}.band-good{--band-c:var(--good)}.band-none{--band-c:var(--grid)}
.st{font-size:12px;font-weight:600;white-space:nowrap;padding:2px 9px;border-radius:10px;border:1px solid var(--band-c);background:var(--surface-1)}.st-good{color:var(--good)}.st-none{color:var(--muted)}.st-critical{color:var(--critical)}.st-serious{color:var(--serious)}.st-warning{color:var(--text-primary)}.st-info{color:var(--muted)}
.sw.b-critical{background:var(--critical)}.sw.b-serious{background:var(--serious)}.sw.b-warning{background:var(--warning)}.sw.b-info{background:var(--muted)}.sw.b-good{background:var(--good)}.sw.b-none{background:var(--grid)}
.card{background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin:10px 0}.ch{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;margin-bottom:6px}.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:11px;padding:2px 8px;border-radius:10px;background:var(--surface-1);border:1px solid var(--border);color:var(--text-secondary);white-space:nowrap}.eff-lowers{color:var(--s1)}.eff-slows{color:var(--s3)}.eff-both{color:var(--text-primary)}.k-bug{color:var(--critical);border-color:var(--critical)}
.kv{display:grid;grid-template-columns:90px 1fr;gap:10px;padding:4px 0;font-size:13px}.kv>span{color:var(--text-secondary)}.kv ol{margin:0;padding-left:18px}
.issue{background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 12px}.issue textarea{width:100%;box-sizing:border-box;font:12px/1.45 ui-monospace,Consolas,monospace;background:var(--surface-1);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:8px}
.copy{margin-top:6px;font:inherit;font-size:13px;padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface-1);color:var(--text-primary);cursor:pointer}
@media print{#tip{display:none}h2{break-after:avoid}.tw{overflow:visible}}
</style></head><body><div class="viz-root">
<h1>Token/context audit — ${esc(F.scope)}</h1>
<p class="sub">${esc(F.date || D.generated_at.slice(0, 10))}${D.range ? ` · data from ${hhmm(D.range.from)} to ${hhmm(D.range.to)} UTC` : ''}${F.question ? ' · ' + esc(F.question) : ''}</p>
<div class="tiles">${tiles.map(([k, v, s]) => `<div class="tile"><span>${esc(k)}</span><b>${esc(v)}</b><span>${esc(s)}</span></div>`).join('')}</div>
<div class="summary">${esc(F.summary)}${F.fixes && F.fixes.length ? ` <a href="#fixes">Go to the ${F.fixes.length} fixes</a>.` : ''}</div>
<h2>What was analysed</h2>
<p class="muted">Each area of the method and its status. The colour is the weight of the area's findings on consumption, set by the rules (SKILL.md 4.1). Hover an id for the finding.</p>
${analysed}

<h2>Data quality</h2>${list(F.data_quality)}
${table(cov, [{ label: 'Trace', get: (c) => short(c.trace) }, { label: 'Missions', key: 'missions', num: true }, { label: 'Spans shown / total', get: (c) => `${c.spans_shown} / ${c.spans_total}`, num: true }, { label: 'Cost in turn spans', get: (c) => money(c.cost_in_spans), num: true }, { label: 'Aggregate cost', get: (c) => money(c.cost_aggregate), num: true }, { label: 'Coverage', get: (c) => (c.cost_coverage_pct == null ? '-' : c.cost_coverage_pct + ' %'), num: true }])}

<h2>Chronology of consumption</h2>
<p class="muted">Cost per turn over time (UTC). A rising line inside one session is context growth; a drop is a compaction or a new session; a gray band is time spent on a backend that reports no cost. Hover any mark for details.</p>
${timeline()}
<h3>Recorded cost per hour</h3>${hourly()}
${list(F.chronology_notes)}

<h2>Consumption per provider and model</h2>
<p class="muted">Recorded cost comes from turn spans, plus the mission total for missions without turn spans. Turn spans carry no model id: a turn's provider is inferred (cost reported = a cost-reporting backend: ${esc((D.cost_backends || ['claude']).join(', '))}; no cost inside a mission now on such a backend = an unidentified fallback); the "Inferred turns" column counts them. Tokens are not comparable across providers: see the "Tokens in counted as" column.</p>
${modelBars()}
<h3>Turns per hour by provider</h3>${providerHours()}
<h3>Per provider</h3>
${table(D.by_backend, providerCols(false))}
<h3>Per provider and model</h3>
${table(D.by_model, providerCols(true))}
${list(F.provider_notes)}

<h2>Context switching</h2>
<p class="muted">Backend switches, cache rewrites, context drops and disruptions, in order. The trigger column is the nearest disruption of another mission between 15 minutes before and 10 minutes after the event: a correlation, not a proof.</p>
${table(chrono, [{ label: 'When (UTC)', get: (e) => hhmm(e.t) }, { label: 'Event', key: 'kind' }, { label: 'Agent', get: (e) => agentShort(e.agent) }, { label: 'Mission', get: (e) => mtitle(e.mission) }, { label: 'Cost', get: (e) => (e.cost ? money(e.cost) : ''), num: true }, { label: 'Likely trigger', get: (e) => e.cause || '' }, { label: 'Detail', key: 'detail' }])}

<h2>Spawn weight</h2>
${table(F.spawn_weight, [{ label: 'Agent', key: 'agent' }, { label: 'Backend/model', key: 'backend_model' }, { label: 'Docs', key: 'docs' }, { label: 'Imported skills', key: 'imported' }, { label: 'Catalogue', key: 'catalogue' }, { label: 'Memory rules', key: 'rules' }, { label: 'MCP', key: 'mcp' }, { label: 'Total', key: 'total' }])}

<h2>Outliers</h2>
${table(F.outliers, [{ label: 'Mission / task', key: 'mission' }, { label: 'Turns', key: 'turns', num: true }, { label: 'Cost', key: 'cost', num: true }, { label: 'Peer median', key: 'peer', num: true }, { label: 'Ratio', key: 'ratio', num: true }, { label: 'Probable cause', key: 'cause' }])}

<h2>Findings</h2>
${table(F.findings, [{ label: 'Id', key: 'id' }, { label: 'Severity', get: (r) => sevBadge(r.severity), html: true }, { label: 'Area', key: 'area' }, { label: 'Finding', key: 'finding' }, { label: 'Evidence', key: 'evidence' }, { label: 'Est. impact', key: 'impact' }, { label: 'Fix', key: 'fix' }, { label: 'Owner', key: 'owner' }])}

<h2>Timon code analysis</h2>
${F.code_scope ? `<p class="muted">${esc(F.code_scope)}</p>` : ''}
${codeSection(F.code_findings)}

<h2 id="fixes">Fixes ranked by saving</h2>
<p class="muted"><b>Lowers</b> = fewer tokens in total. <b>Slows</b> = the same work spread out: fewer rate limits, fallbacks and cache rewrites. Ranked by saving × frequency, then by effort.</p>
${fixCards(F.fixes)}

<h2>Not investigated / needs data</h2>${list(F.not_investigated)}

<h2>Appendix</h2>
<details><summary>Peer groups (agent · task type · backend/model)</summary>
${table(D.groups, [{ label: 'Agent', get: (g) => agentShort(g.agent) }, { label: 'Type', key: 'type' }, { label: 'Backend/model', get: (g) => `${g.backend}/${g.model}` }, { label: 'Missions', key: 'n', num: true }, { label: 'Cost', get: (g) => money(g.cost), num: true }, { label: 'Median', get: (g) => money(g.median_cost), num: true }, { label: 'Turns', key: 'turns', num: true }, { label: 'No-cost missions', key: 'unmeasured_missions', num: true }, { label: 'Tools', key: 'tools', num: true }, { label: 'Tool errors', key: 'tool_errors', num: true }, { label: 'Median min', key: 'median_minutes', num: true }])}</details>
<details><summary>Configured vs actual model</summary>
${table(Object.entries(D.model_drift || {}).map(([k, n]) => ({ k, n })), [{ label: 'Agent: configured -> ran', key: 'k' }, { label: 'Missions', key: 'n', num: true }])}</details>
<details><summary>Top 25 missions by cost</summary>
${table((D.missions || []).slice(0, 25), [{ label: 'Agent', get: (m) => agentShort(m.agent) }, { label: 'Mission', get: (m) => mtitle(m.id) }, { label: 'Type', key: 'type' }, { label: 'Ran on', get: (m) => `${m.backend}/${m.model}` }, { label: 'Turns', key: 'turns', num: true }, { label: 'Cost', get: (m) => (m.cost_source === 'not measured' ? 'not measured' : money(m.cost)), num: true }, { label: 'Peer x', get: (m) => m.ratio ?? '-', num: true }, { label: 'Max growth in a session', get: (m) => (m.max_growth ? m.max_growth + 'x' : '-'), num: true }, { label: 'Tools (errors)', get: (m) => `${m.tools} (${m.tool_errors})`, num: true }])}</details>
<details><summary>All turns (table view of the chronology chart)</summary>
${table(D.turns, [{ label: 'When (UTC)', get: (r) => hhmm(r.t) }, { label: 'Agent', get: (r) => agentShort(r.agent) }, { label: 'Mission', get: (r) => mtitle(r.mission) }, { label: 'Cost', get: (r) => (r.measured ? money(r.raw_cost) : 'no cost reported'), num: true }, { label: 'Tokens in', key: 'tokens_in', num: true }, { label: 'Tokens out', key: 'tokens_out', num: true }, { label: 'Flags', get: (r) => r.flags.join(', ') }])}</details>
<p class="muted" style="margin-top:24px">Snapshot ${esc(D.generated_at)}${D.manifest ? ` · window ${esc(D.manifest.since)} to ${esc(D.manifest.as_of)} · method ${esc(D.manifest.method_version)} · rules ${esc(F.rules_version || '-')} · input digest ${esc(D.manifest.input_digest)} · ${esc(D.manifest.timon_version || '')}` : ''} · report ${REPORT_VERSION} · audit-token-context-consumption skill. Read-only audit: every fix above is a proposal for the owner. Same snapshot + same findings.json = same report.</p>
<div id="tip"></div>
</div>
<script>
(function(){document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-copy]');if(!b)return;var t=document.getElementById(b.getAttribute('data-copy'));var done=function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy prompt'},1500)};t.select();if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t.value).then(done,function(){try{document.execCommand('copy');done()}catch(_){b.textContent='Select and copy by hand'}})}else{try{document.execCommand('copy');done()}catch(_){b.textContent='Select and copy by hand'}}})})();
(function(){var tip=document.getElementById('tip');document.addEventListener('mousemove',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(!t){tip.style.display='none';return}tip.textContent=t.getAttribute('data-tip');tip.style.display='block';var x=e.clientX+14,y=e.clientY+14;if(x+430>innerWidth)x=e.clientX-430;tip.style.left=x+'px';tip.style.top=y+'px'});})();
</script></body></html>`

fs.writeFileSync(args.out, html)
console.log(JSON.stringify({ out: args.out, bytes: html.length }))
