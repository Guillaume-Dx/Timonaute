#!/usr/bin/env node
// agent-config-consistency-audit — deterministic engine (read-only).
// Commands:
//   node audit.js collect --home <TIMON_HOME> --work <dir>
//       reads <work>/mcp.json (phase A keys), selects the scope, measures every
//       file-based source, finds exact duplicate sentences, writes
//       <work>/collected.json and <work>/digest.md.
//   node audit.js render --work <dir> --out-dir <cwd>\audits
//       reads collected.json + mcp.json + judgment.json, validates them, runs the
//       mechanical checks, merges the judgment findings, sorts, numbers, renders
//       the HTML report and verifies it. Same inputs => byte-identical HTML.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '2.2';
const STD_DOCS = ['SOUL.md', 'system-prompt.md', 'charter.md', 'rules.md', 'style.md', 'directives.md'];
const BUILTIN_SKILLS = ['timon-task', 'timon-worktree'];
const SEVS = ['critical', 'high', 'medium', 'low', 'info'];
const CATS = ['M', 'C', 'S', 'K', 'R', 'H'];
const DISMISSIBLE = ['K1', 'K2', 'R1', 'R3'];
const K_T = { catChars: 2000, catCount: 10, importTotal: 8192, bigBody: 32768, peerMin: 3, peerShare: 0.5, readsMin: 2 };
const PL = { critical: ['P0', 'Immediate', 'Critical'], high: ['P1', 'High', 'High'], medium: ['P2', 'Medium', 'Medium'], low: ['P3', 'Low', 'Low'], info: ['P4', 'Info', 'Info'] };
// owner: script = only the engine may emit it; judgment = only judgment.json; both = engine part + judgment part.
const CATALOG = {
  M1: ['Invalid or unavailable provider/model', 'critical', 'script'],
  M2: ['Role-to-model capability or cost mismatch', 'medium', 'both'],
  M3: ['Coder/Reviewer model monoculture', 'medium', 'script'],
  C1: ['Intra-agent conflict (intra-file & inter-file)', 'critical', 'judgment'],
  C2: ['Cross-layer conflict', 'critical', 'judgment'],
  C3: ['Config-vs-prose impossibility', 'critical', 'judgment'],
  C4: ['Inter-agent ownership overlap or gap', 'high', 'judgment'],
  C5: ['Inter-agent workflow/reporting conflict', 'critical', 'judgment'],
  S1: ['Oversized single .md doc', 'medium', 'script'],
  S2: ['Oversized total identity .md docs per agent', 'medium', 'script'],
  S3: ['Oversized global-instructions.md', 'medium', 'script'],
  S4: ['Task-specific bloat always injected', 'high', 'both'],
  R1: ['Intra-agent duplication (intra-file & inter-file)', 'medium', 'both'],
  R2: ['Cross-layer duplication', 'medium', 'judgment'],
  R3: ['Cross-agent duplication', 'medium', 'both'],
  R4: ['Duplicate/overlapping DB rules', 'low', 'judgment'],
  H1: ['Dead legacy files', 'low', 'both'],
  H2: ['Stale or superseded DB rules', 'low', 'judgment'],
  H3: ['Unused Catalogue skills', 'info', 'script'],
  H4: ['Hierarchy / project metadata drift', 'high', 'script'],
  H5: ['Incomplete identity doc set', 'low', 'script'],
  K1: ['Missing skill (attached but not installed, or named in prose but not attached)', 'medium', 'both'],
  K2: ['Suggested skill (read but not attached, adopted by role peers, or matching a described task)', 'low', 'both'],
  K3: ['Skill overhead (catalogue weight, import total, redundant routes, very large bodies, overlapping skills)', 'medium', 'both'],
  K4: ['Broken catalogue description (agent cannot tell when to use the skill)', 'medium', 'script'],
};
const MULTI_AGENT_CHECKS = ['M3', 'C4', 'C5', 'R3'];
const LIGHT_MODEL = /haiku|flash|mini|nano|lite|small/i;
const TOP_MODEL = /opus|fable|astra|ultra/i;
const REASONING_ROLES = ['orchestrator', 'coder', 'code', 'reviewer', 'review', 'research', 'researcher', 'doc', 'librarian', 'writer', 'ops'];
const MECHANICAL_ROLES = ['merger', 'merge', 'chore'];
const ROLE_SLOT = { coder: 'code', code: 'code', reviewer: 'review', review: 'review', merger: 'merge', merge: 'merge', research: 'research', researcher: 'research', librarian: 'doc', doc: 'doc', writer: 'doc', chore: 'chore' };
const T = { S1: [4096, 10240], S2: [12288, 24576], S3: [3072, 6144], S4: 4096 };

// ---------- helpers ----------
const tok = c => Math.ceil(c / 4);
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const md = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const ws = s => String(s).replace(/\s+/g, ' ').trim();
const normPath = p => ws(p).replace(/[\\/]+/g, '/').toLowerCase();
const die = (...m) => { console.error('ERROR:', ...m); process.exit(1); };
function args(argv) { const o = { _: [] }; for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { o[argv[i].slice(2)] = argv[i + 1]; i++; } else o._.push(argv[i]); } return o; }
function readJson(p, required = true) { if (!fs.existsSync(p)) { if (required) die('missing file', p); return null; } try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch (e) { die('invalid JSON in', p, e.message); } }
function measure(fp) {
  if (!fs.existsSync(fp)) return { path: fp, status: 'not present', bytes: 0, chars: 0, lines: 0, tok: 0, text: '' };
  try {
    const buf = fs.readFileSync(fp); const text = buf.toString('utf8').replace(/^﻿/, '');
    const ls = text.split(/\r?\n/); if (ls.length && ls[ls.length - 1] === '') ls.pop();
    const chars = [...text].length;
    return { path: fp, status: 'ok', bytes: buf.length, chars, lines: ls.length, tok: tok(chars), text };
  } catch (e) { return { path: fp, status: 'not accessible', bytes: 0, chars: 0, lines: 0, tok: 0, text: '', error: e.message }; }
}
const agentsOf = raw => (Array.isArray(raw) ? raw : raw && raw.agents) || [];
const nowStamp = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); const off = -d.getTimezoneOffset(); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} ${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`; };
const safeSlug = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '-');
function slotsOf(raw, name) { const out = []; (function walk(v, key) { if (v == null) return; if (typeof v === 'string') { if (v === name && key) out.push(key); return; } if (Array.isArray(v)) { v.forEach(x => walk(x, key)); return; } if (typeof v === 'object') { if ((v.agent === name || v.name === name) && key) out.push(key); for (const k of Object.keys(v)) if (k !== 'agent' && k !== 'name') walk(v[k], Object.keys(ROLE_SLOT).concat(Object.values(ROLE_SLOT), ['orchestrator', 'ops']).includes(k) ? k : key); } })(raw, null); return [...new Set(out)].sort(); }

// ---------- duplicate analysis ----------
function sentencesOf(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*#/.test(line) || !line.trim()) return;
    const body = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
    body.split(/(?<=[.!?])\s+(?=[A-Z`"(*])/).forEach(s => {
      const norm = s.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().replace(/[.;:,!]+$/, '').toLowerCase();
      if (norm.length >= 25) out.push({ line: i + 1, text: s.trim(), norm });
    });
  });
  return out;
}
function dupClusters(agents) {
  const map = new Map();
  for (const a of agents) for (const d of a.docs) if (d.status === 'ok') for (const s of sentencesOf(d.text)) {
    if (!map.has(s.norm)) map.set(s.norm, []);
    map.get(s.norm).push({ agent: a.name, file: d.file, line: s.line, text: s.text });
  }
  const clusters = [];
  for (const [norm, occ] of map) {
    if (occ.length < 2) continue;
    const ag = [...new Set(occ.map(o => o.agent))].sort(cmpStr);
    const kind = ag.length >= 2 ? 'cross-agent' : new Set(occ.map(o => o.file)).size >= 2 ? 'inter-file' : 'intra-file';
    clusters.push({ norm, kind, agents: ag, occ });
  }
  return clusters.sort((x, y) => cmpStr(x.kind, y.kind) || y.occ.length - x.occ.length || cmpStr(x.norm, y.norm));
}

// =====================================================================
// COLLECT
// =====================================================================
function collect(o) {
  const home = o.home || die('--home required'); const work = o.work || die('--work required');
  const mcp = readJson(path.join(work, 'mcp.json'));
  const scope = mcp.scope || die('mcp.json: scope missing');
  if (!['single', 'team', 'orchestrator', 'project'].includes(scope.mode)) die('scope.mode must be single|team|orchestrator|project');
  const list = agentsOf(mcp.agentList); if (!list.length) die('mcp.json: agentList empty (paste raw agent_list output)');
  const byName = Object.fromEntries(list.map(a => [a.name, a]));
  const cfgOf = n => { const p = path.join(home, 'agents', n, 'config.json'); return fs.existsSync(p) ? readJson(p) : null; };
  let names = [], anomalies = [];
  if (scope.mode === 'single') { if (!byName[scope.target]) die('unknown agent', scope.target); names = [scope.target]; }
  if (scope.mode === 'team') { const t = scope.targets || die('scope.targets required for team'); t.forEach(n => byName[n] || die('unknown agent', n)); names = [...t]; }
  if (scope.mode === 'orchestrator') {
    if (!byName[scope.target]) die('unknown agent', scope.target);
    const set = new Set([scope.target]); let grew = true;
    while (grew) { grew = false; for (const a of list) if (a.reports_to && set.has(a.reports_to) && !set.has(a.name)) { set.add(a.name); grew = true; } }
    names = [...set];
  }
  if (scope.mode === 'project') {
    const slug = scope.target; const rolesRaw = (mcp.projectRoles || {})[slug];
    if (rolesRaw === undefined) die(`mcp.json: projectRoles["${slug}"] missing (paste raw project_roles output)`);
    for (const a of list) { const c = cfgOf(a.name); if ((c && c.project === slug) || a.name.startsWith(slug + '.') || slotsOf(rolesRaw, a.name).length) names.push(a.name); }
  }
  names = [...new Set(names)].sort(cmpStr);
  if (!names.length) die('scope resolved to 0 agents');
  const firstName = names[0];
  const scopeSlug = scope.mode === 'single' ? `agent-${scope.target}` : scope.mode === 'team' ? `team-${firstName}-plus-${names.length - 1}` : scope.mode === 'orchestrator' ? `tree-${scope.target}` : `project-${scope.target}`;

  const agents = names.map(name => {
    const dir = path.join(home, 'agents', name);
    const cfgM = measure(path.join(dir, 'config.json'));
    let cfg = null; if (cfgM.status === 'ok') { try { cfg = JSON.parse(cfgM.text); } catch (e) { cfgM.status = 'not accessible'; cfgM.error = 'invalid JSON'; } }
    let mdFiles = [];
    if (fs.existsSync(dir)) mdFiles = fs.readdirSync(dir).filter(f => /\.md$/i.test(f) && fs.statSync(path.join(dir, f)).isFile());
    const ordered = [...STD_DOCS.filter(f => mdFiles.includes(f)), ...mdFiles.filter(f => !STD_DOCS.includes(f)).sort(cmpStr)];
    const docs = ordered.map(f => ({ file: f, ...measure(path.join(dir, f)) }));
    const memDir = path.join(dir, 'memory');
    const memory = fs.existsSync(memDir) ? fs.readdirSync(memDir).sort(cmpStr).map(f => { const m = measure(path.join(memDir, f)); return { file: f, bytes: fs.statSync(path.join(memDir, f)).size, lines: /\.(jsonl|md)$/i.test(f) && m.bytes < 5e6 ? m.lines : null }; }) : null;
    const meta = byName[name] || {};
    return { name, dirStatus: fs.existsSync(dir) ? 'ok' : 'not present', config: cfg, configStatus: cfgM.status, configText: cfgM.text,
      role: (cfg && cfg.role) || meta.role || null, reportsTo: (cfg && 'reports_to' in cfg ? cfg.reports_to : meta.reports_to) || null,
      project: (cfg && cfg.project) || null, cwd: (cfg && cfg.cwd) || null, orchestrator: !!meta.orchestrator, docs, memory,
      missingStd: STD_DOCS.filter(f => !mdFiles.includes(f)) };
  });

  const globalInstr = measure(path.join(home, 'global-instructions.md'));
  const cwds = [...new Set(agents.map(a => a.cwd).filter(Boolean))].sort(cmpStr);
  const workspace = cwds.map(cwd => {
    const files = ['AGENTS.md', 'CLAUDE.md', path.join('.github', 'copilot-instructions.md')].map(f => ({ file: f, ...measure(path.join(cwd, f)) }));
    const instrDir = path.join(cwd, '.github', 'instructions');
    const inst = fs.existsSync(instrDir) ? fs.readdirSync(instrDir).filter(f => /\.instructions\.md$/i.test(f)).sort(cmpStr) : [];
    if (inst.length) inst.forEach(f => files.push({ file: path.join('.github', 'instructions', f), ...measure(path.join(instrDir, f)) }));
    else files.push({ file: path.join('.github', 'instructions', '*.instructions.md'), path: instrDir, status: 'not present', bytes: 0, chars: 0, lines: 0, tok: 0, text: '' });
    return { cwd, files };
  });
  const clusters = dupClusters(agents);
  const collected = { version: VERSION, asOf: mcp.asOf || nowStamp(), home, scope: { ...scope, slug: safeSlug(scopeSlug) }, names, anomalies, agents, globalInstructions: globalInstr, workspace, clusters };
  fs.writeFileSync(path.join(work, 'collected.json'), JSON.stringify(collected, null, 1));

  // digest for the judgment phase
  let d = `# Audit digest — ${scopeSlug} — ${collected.asOf}\n\nSelected agents (${names.length}): ${names.join(', ')}\n\n`;
  d += `Phase B: add to mcp.json for EACH agent above: rules.agent[name], skills[name], skillReads[name]; plus rules.global, rules.role, rules.project[slug], projectMemory[slug], importSkillChars[id].\n\n`;
  d += `global-instructions.md: ${globalInstr.status} (${globalInstr.bytes} B)\n`;
  workspace.forEach(w => w.files.forEach(f => d += `workspace ${w.cwd}\\${f.file}: ${f.status} (${f.bytes} B)\n`));
  if (globalInstr.status === 'ok') d += `\n## global-instructions.md\n\n${globalInstr.text.split(/\r?\n/).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n')}\n`;
  workspace.forEach(w => w.files.filter(f => f.status === 'ok').forEach(f => d += `\n## ${w.cwd}\\${f.file}\n\n${f.text.split(/\r?\n/).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n')}\n`));
  for (const a of agents) {
    d += `\n# AGENT ${a.name}  (role ${a.role}, reports_to ${a.reportsTo}, project ${a.project})\n\nconfig.json (${a.configStatus}):\n${a.configText}\n`;
    for (const doc of a.docs) d += `\n## ${a.name} / ${doc.file}  (${doc.bytes} B, ${doc.lines} lines, ~${doc.tok} tok)\n\n${doc.text.split(/\r?\n/).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n')}\n`;
    d += `\nmemory folder: ${a.memory ? a.memory.map(m => `${m.file} (${m.bytes} B)`).join(', ') || 'empty' : 'not present'}\n`;
  }
  if (Array.isArray(mcp.skillList)) {
    d += `\n# INSTALLED SKILLS (${mcp.skillList.length}) — for K1/K2/K3 judgment\n\n`;
    [...mcp.skillList].sort((x, y) => cmpStr(x.id, y.id)).forEach(s => { d += `- ${s.id} (${s.size} B): ${String(s.description || '').replace(/\s+/g, ' ')}\n`; });
    names.forEach(n => { const r = mcp.skills && mcp.skills[n]; const rd = mcp.skillReads && mcp.skillReads[n]; d += `\n${n}: resolved = ${r && Array.isArray(r.skills) ? r.skills.map(s => s.id + '(' + s.mode + ')').join(', ') || 'none' : 'not yet in mcp.json'}; reads = ${rd && rd.skills ? Object.entries(rd.skills).map(([k, v]) => k + '×' + v.reads).join(', ') || 'none' : 'n/a'}\n`; });
  } else d += '\n# INSTALLED SKILLS: run collect again after phase B (skillList not yet in mcp.json)\n';
  d += `\n# EXACT DUPLICATE SENTENCES (engine emits R1/R3 for these — do NOT re-report them in judgment.json)\n`;
  clusters.forEach((c, i) => { d += `\n[${i + 1}] ${c.kind} — "${c.occ[0].text}"\n` + c.occ.map(o => `    ${o.agent} / ${o.file}:${o.line}`).join('\n') + '\n'; });
  if (!clusters.length) d += '\n(none)\n';
  fs.writeFileSync(path.join(work, 'digest.md'), d);
  console.log(JSON.stringify({ scopeSlug: collected.scope.slug, agents: names, clusters: clusters.length, digest: path.join(work, 'digest.md') }, null, 1));
}

// =====================================================================
// RENDER
// =====================================================================
function render(o) {
  const work = o.work || die('--work required'); const outDir = o['out-dir'] || die('--out-dir required');
  const C = readJson(path.join(work, 'collected.json'));
  const M = readJson(path.join(work, 'mcp.json'));
  const J = readJson(path.join(work, 'judgment.json'));
  const errors = [];
  const backends = (M.backends && M.backends.backends) || die('mcp.json: backends (raw backends_list) missing');
  const defaultBackend = M.backends.defaultBackend || 'claude';
  const rulesIn = M.rules || die('mcp.json: rules missing');
  const notAcc = v => v && typeof v === 'object' && !Array.isArray(v) && v.status === 'not accessible';
  const reqKey = (obj, key, label) => { if (!obj || !(key in obj)) errors.push(`mcp.json: ${label} missing (use {"status":"not accessible","reason":"…"} if the tool failed)`); return obj ? obj[key] : undefined; };
  if (!('global' in rulesIn)) errors.push('mcp.json: rules.global missing'); if (!('role' in rulesIn)) errors.push('mcp.json: rules.role missing');
  const projects = [...new Set(C.agents.map(a => a.project).filter(Boolean))].sort(cmpStr);
  projects.forEach(p => { reqKey(rulesIn.project, p, `rules.project["${p}"]`); reqKey(M.projectMemory, p, `projectMemory["${p}"]`); reqKey(M.projectRoles, p, `projectRoles["${p}"]`); });
  C.names.forEach(n => { reqKey(rulesIn.agent, n, `rules.agent["${n}"]`); reqKey(M.skills, n, `skills["${n}"]`); reqKey(M.skillReads, n, `skillReads["${n}"]`); });
  if (!Array.isArray(M.skillList)) errors.push('mcp.json: skillList missing (paste raw skill_list output)');
  if (!Array.isArray(M.skillAttachments)) errors.push('mcp.json: skillAttachments missing (paste raw skill_attachment_list output, no filter)');

  const arr = v => (Array.isArray(v) ? v : []);
  const allRules = [];
  arr(rulesIn.global).forEach(r => allRules.push({ ...r, scope: 'global' }));
  arr(rulesIn.role).forEach(r => allRules.push({ ...r, scope: 'role' }));
  Object.entries(rulesIn.project || {}).forEach(([p, l]) => arr(l).forEach(r => allRules.push({ ...r, scope: 'project', project: p })));
  Object.entries(rulesIn.agent || {}).forEach(([a, l]) => arr(l).forEach(r => allRules.push({ ...r, scope: 'agent', agent: a })));
  const ruleById = Object.fromEntries(allRules.map(r => [String(r.id), r]));
  const active = r => !r.status || r.status === 'active';

  // ---- agent model ----
  const A = C.agents.map((a, i) => {
    const cfg = a.config || {};
    const beId = cfg.backend || defaultBackend; const be = backends.find(b => b.id === beId);
    const model = cfg.model || (be && be.defaultModel) || null;
    const applies = r => active(r) && ((r.scope === 'global') || (r.scope === 'role' && r.role === a.role) || (r.scope === 'project' && r.project === a.project) || (r.scope === 'agent' && r.agent === a.name));
    const mine = allRules.filter(applies).sort((x, y) => cmpStr(x.scope, y.scope) || (x.id - y.id));
    const core = mine.filter(r => r.tier === 'core'), normal = mine.filter(r => r.tier !== 'core');
    const sk = M.skills && M.skills[a.name]; const skills = notAcc(sk) ? null : arr(sk && sk.skills);
    const reads = M.skillReads && M.skillReads[a.name];
    const importSkills = (skills || []).filter(s => s.mode === 'import' && !BUILTIN_SKILLS.includes(s.id)).map(s => { const c = M.importSkillChars && M.importSkillChars[s.id]; if (c == null) errors.push(`mcp.json: importSkillChars["${s.id}"] missing (import skill of ${a.name})`); return { ...s, chars: c || 0, tok: tok(c || 0) }; });
    const docTok = a.docs.reduce((s, d) => s + d.tok, 0), docBytes = a.docs.reduce((s, d) => s + d.bytes, 0);
    const coreTok = core.reduce((s, r) => s + tok([...String(r.text)].length), 0), normalTok = normal.reduce((s, r) => s + tok([...String(r.text)].length), 0);
    const importTok = importSkills.reduce((s, x) => s + x.tok, 0); const globalTok = C.globalInstructions.tok;
    const rolesRaw = a.project && M.projectRoles ? M.projectRoles[a.project] : undefined;
    const slots = rolesRaw ? slotsOf(rolesRaw, a.name) : [];
    return { ...a, idx: i, short: a.name.includes('.') ? a.name.slice(a.name.indexOf('.') + 1) : a.name, cfg, beId, be, beSrc: cfg.backend ? 'explicit' : 'inherited default', model, modelSrc: cfg.model ? 'explicit' : 'inherited default',
      core, normal, skills, reads, importSkills, docTok, docBytes, coreTok, normalTok, importTok, globalTok, alwaysOn: globalTok + docTok + importTok + coreTok, slots };
  });
  const byName = Object.fromEntries(A.map(a => [a.name, a]));
  const listAll = agentsOf(M.agentList); const listByName = Object.fromEntries(listAll.map(a => [a.name, a]));
  const multi = A.length >= 2;

  // ---- evidence helpers ----
  const ev = { doc: (agent, file, quote) => ({ doc: { agent, file, quote } }), note: t => ({ note: t }), table: (head, rows) => ({ table: { head, rows } }), rule: id => ({ rule: id }), config: (agent, quote) => ({ config: { agent, quote } }) };
  const F = [];
  const add = f => F.push({ origin: 'engine', ...f });
  const fmtB = b => `${b.toLocaleString('en')} B (~${tok(b)} tok)`;

  // M1
  A.forEach(a => {
    const slugs = a.be ? arr(a.be.models).map(m => m.slug) : [];
    if (!a.be) add({ check: 'M1', agents: [a.name], title: `Backend "${a.beId}" of ${a.name} is not in backends_list`, evidence: [ev.config(a.name, `"backend": "${a.beId}"`), ev.note(`backends_list ids: ${backends.map(b => '`' + b.id + '`').join(', ')}`)], impact: 'Spawns target a backend this install does not offer.', rec: 'Set a listed backend and a model from its catalog.', fix: `agent_update({ "name": "${a.name}", "backend": "${defaultBackend}" })` });
    else if (a.model && !slugs.includes(a.model)) add({ check: 'M1', agents: [a.name], title: `Model ${a.model} of ${a.name} is absent from the ${a.beId} catalog`, evidence: [a.modelSrc === 'explicit' ? ev.config(a.name, `"model": "${a.model}"`) : ev.note(`inherited default model \`${a.model}\``), ev.note(`Live \`backends_list\` ${a.beId} slugs: ${slugs.map(s => '`' + s + '`').join(', ')} (default \`${a.be.defaultModel}\`).`)], impact: 'Every spawn of this agent depends on an unknown slug: the backend rejects it or runs another model.', rec: `Set a slug from the ${a.beId} catalog (closest name match first, else the backend default \`${a.be.defaultModel}\`).`, fix: `agent_update({ "name": "${a.name}", "backend": "${a.beId}", "model": "<slug from backends_list>" })` });
    else if (a.be.signedIn === false) add({ check: 'M1', agents: [a.name], title: `Backend ${a.beId} of ${a.name} is signed out`, evidence: [ev.note(`backends_list: \`${a.beId}\` signedIn = false.`)], impact: 'Spawns fail until the host signs in.', rec: `Run the sign-in command \`${a.be.signInCommand || '?'}\` on the host, or move the agent to a signed-in backend.`, fix: `${a.be.signInCommand || ''}` });
  });
  // M2 (tier)
  const tierOf = m => (!m ? 'unknown' : LIGHT_MODEL.test(m) ? 'light' : TOP_MODEL.test(m) ? 'top' : 'mid');
  A.forEach(a => {
    const t = tierOf(a.model), r = String(a.role || '').toLowerCase();
    if (t === 'light' && REASONING_ROLES.includes(r)) add({ check: 'M2', agents: [a.name], title: `${a.name} (${a.role}) runs on a lightweight model (${a.model})`, evidence: [a.modelSrc === 'explicit' ? ev.config(a.name, `"model": "${a.model}"`) : ev.note(`inherited default \`${a.model}\``), ev.note(`Tier rule: /${LIGHT_MODEL.source}/ = light; role \`${a.role}\` is a reasoning/authoring role.`)], impact: 'A lightweight model on a reasoning/authoring role raises the risk of shallow or wrong output.', rec: `Move to a mid-tier model of the same backend${a.be ? ` (default \`${a.be.defaultModel}\`)` : ''}.`, fix: `agent_update({ "name": "${a.name}", "model": "<mid-tier slug from backends_list>" })` });
    if (t === 'top' && MECHANICAL_ROLES.includes(r)) add({ check: 'M2', agents: [a.name], title: `${a.name} (${a.role}) runs on a top-tier model (${a.model})`, evidence: [ev.config(a.name, `"model": "${a.model}"`), ev.note(`Tier rule: /${TOP_MODEL.source}/ = top; role \`${a.role}\` is mechanical.`)], impact: 'Top-tier cost on a mechanical role.', rec: 'Move to a mid or light model.', fix: `agent_update({ "name": "${a.name}", "model": "<lighter slug from backends_list>" })` });
  });
  // M3
  const coders = A.filter(a => ['coder', 'code'].includes(String(a.role).toLowerCase())), reviewers = A.filter(a => ['reviewer', 'review'].includes(String(a.role).toLowerCase()));
  coders.forEach(c => reviewers.forEach(r => { if (c.project === r.project && c.beId === r.beId && c.model === r.model) add({ check: 'M3', agents: [c.name, r.name], title: `Coder and reviewer share ${c.beId}/${c.model}`, evidence: [ev.note(`${c.name}: \`${c.beId}/${c.model}\`; ${r.name}: \`${r.beId}/${r.model}\`.`)], impact: 'Same model writes and reviews: correlated blind spots.', rec: 'Put the reviewer on another vendor or model family.', fix: `agent_update({ "name": "${r.name}", "backend": "<other backend>", "model": "<slug>" })` }); }));
  // S1/S2/S3/S4
  A.forEach(a => {
    a.docs.forEach(d => { if (d.bytes > T.S1[0]) add({ check: 'S1', sev: d.bytes > T.S1[1] ? 'high' : 'medium', auto: true, agents: [a.name], title: `${a.name} / ${d.file} is ${fmtB(d.bytes)}`, evidence: [ev.note(`${d.file}: ${d.bytes} B, ${d.lines} lines, ~${d.tok} tok. Thresholds: medium > 4 KB, high > 10 KB.`)], impact: 'Injected on every turn of every mission of this agent.', rec: 'Move task-specific sections (templates, tables, procedures) into a catalogue (include) skill.', fix: `agent_doc_put ${a.name} ${d.file}  → trimmed version; skill_put + skill_attach (include) for the extracted part` }); });
    if (a.docBytes > T.S2[0]) add({ check: 'S2', sev: a.docBytes > T.S2[1] ? 'high' : 'medium', auto: true, agents: [a.name], title: `${a.name} identity docs total ${fmtB(a.docBytes)}`, evidence: [ev.table(['File', 'Bytes', '~tok'], a.docs.map(d => [d.file, String(d.bytes), String(d.tok)]))], impact: 'Always-on weight on every turn.', rec: 'Trim duplicated and task-specific content.', fix: `agent_doc_put ${a.name} <file>` });
    a.importSkills.forEach(s => { if (s.chars > T.S4) add({ check: 'S4', agents: [a.name], title: `Import-mode skill ${s.id} (${s.chars} chars) injected on every turn of ${a.name}`, evidence: [ev.note(`skill_resolve: \`${s.id}\` mode import via ${s.via}; ${s.chars} chars (~${s.tok} tok) > 4 KB.`)], impact: 'Task-specific content paid on every turn.', rec: 'Attach in include (catalogue) mode unless needed on every task.', fix: `skill_attach({ "skill": "${s.id}", "agent": "${a.name}", "mode": "include" })` }); });
  });
  const g = C.globalInstructions; if (g.status === 'ok' && g.bytes > T.S3[0]) add({ check: 'S3', sev: g.bytes > T.S3[1] ? 'high' : 'medium', auto: true, agents: C.names, title: `global-instructions.md is ${fmtB(g.bytes)}`, evidence: [ev.note(`${g.bytes} B, ${g.lines} lines, ~${g.tok} tok, multiplied across every agent.`)], impact: 'Paid by every agent on every turn.', rec: 'Move scoped content to role/project rules or skills.', fix: 'Edit <TIMON_HOME>\\global-instructions.md' });
  // R1 / R3 exact
  const cl = C.clusters || [];
  A.forEach(a => {
    const mineCl = cl.filter(c => c.kind !== 'cross-agent' && c.agents[0] === a.name);
    if (mineCl.length) add({ check: 'R1', agents: [a.name], title: `Exact duplicate sentences inside ${a.name} docs${mineCl.some(c => c.kind === 'intra-file') ? ' [intra-file]' : ''}`, evidence: mineCl.flatMap(c => c.occ.map(o => ev.doc(o.agent, o.file, o.text))).concat([ev.note(`Exact-match clusters (normalized sentences ≥ 25 chars): ${mineCl.length}.`)]), impact: 'Same instruction stated twice; edits drift.', rec: 'Keep one occurrence (rules.md for prohibitions, directives.md for procedure, style.md for format).', fix: `agent_doc_put ${a.name} <file>  → remove the duplicate occurrence` });
  });
  const cross = cl.filter(c => c.kind === 'cross-agent');
  if (cross.length) add({ check: 'R3', agents: [...new Set(cross.flatMap(c => c.agents))].sort(cmpStr), title: `${cross.length} sentence(s) copied verbatim across agents`, evidence: [ev.table(['Text', 'Files', 'Agents'], cross.map(c => [c.occ[0].text, [...new Set(c.occ.map(o => o.file))].join(', '), `${c.agents.length}/${A.length}`]))], impact: `Identical text injected once per agent; a wording change needs ${cross.reduce((s, c) => s + c.occ.length, 0)} edits.`, rec: 'Move shared lines to one project/role-scope core DB rule (or a shared skill), then remove them from the agent docs.', fix: `memory_rule_add({ "scope": "project", "project": "<slug>", "tier": "core", "kind": "preference", "text": "<merged rule>" })` });
  // H1
  A.forEach(a => { if (a.memory && a.memory.some(m => /^pieges\.md$/i.test(m.file))) add({ check: 'H1', agents: [a.name], title: `${a.name} has a dead pieges.md`, evidence: [ev.note('memory/pieges.md present; it is never injected.')], impact: 'Rules written there have no effect.', rec: 'Port live rules to DB rules, then archive the file.', fix: `memory_rule_add(...) for each live rule` }); });
  // H3
  A.forEach(a => (a.skills || []).filter(s => s.mode === 'include' && !BUILTIN_SKILLS.includes(s.id)).forEach(s => {
    const r = a.reads && a.reads.skills && a.reads.skills[s.id]; const n = r ? r.reads : 0;
    if (!notAcc(a.reads) && n === 0) add({ check: 'H3', agents: [a.name], title: `Catalogue skill ${s.id} never read by ${a.name} (0 / ${a.reads && a.reads.missions != null ? a.reads.missions : '?'} missions, 30 d)`, evidence: [ev.note(`skill_resolve: \`${s.id}\` include via ${s.via}. skill_reads: 0 reads.`)], impact: 'The catalogue line costs tokens without being used.', rec: 'Improve the skill description so the agent reaches for it, or detach it.', fix: `skill_detach({ "skill": "${s.id}", "agent": "${a.name}" })` });
  }));
  // H4
  const projSlugs = arr(M.projects).map(p => p.slug);
  A.forEach(a => {
    const pre = a.name.includes('.') ? a.name.split('.')[0] : null;
    if (pre && projSlugs.includes(pre) && a.project !== pre) add({ check: 'H4', agents: [a.name], title: `${a.name} is missing project "${pre}" in config`, evidence: [ev.note(`config.json project = \`${a.project}\`.`)], impact: 'Project-scope rules and roles do not reach this agent.', rec: 'Set the project.', fix: `agent_update({ "name": "${a.name}", "project": "${pre}" })` });
    if (a.reportsTo && !listByName[a.reportsTo]) add({ check: 'H4', agents: [a.name], ghost: { label: a.reportsTo, sub: 'reports_to target missing', from: [a.name] }, title: `${a.name} reports to a missing agent "${a.reportsTo}"`, evidence: [ev.config(a.name, `"reports_to": "${a.reportsTo}"`)], impact: 'Escalations go nowhere.', rec: 'Point reports_to at an existing agent.', fix: `agent_update({ "name": "${a.name}", "reports_to": "<agent>" })` });
    if (!a.reportsTo && !a.orchestrator && a.project) add({ check: 'H4', agents: [a.name], title: `${a.name} has no reports_to`, evidence: [ev.note('reports_to is null and the agent is not an orchestrator.')], impact: 'No referent for unattended questions.', rec: "Set reports_to to the project's orchestrator.", fix: `agent_update({ "name": "${a.name}", "reports_to": "<orchestrator>" })` });
  });
  const cyc = new Set(); A.forEach(a => { const seen = []; let n = a.name; while (n && listByName[n] && !seen.includes(n)) { seen.push(n); n = listByName[n].reports_to; } if (n && seen.includes(n)) seen.slice(seen.indexOf(n)).forEach(x => cyc.add(x)); });
  if (cyc.size) add({ check: 'H4', agents: [...cyc].sort(cmpStr).filter(n => byName[n]), title: 'Cycle in reports_to', evidence: [ev.note(`Cycle members: ${[...cyc].sort(cmpStr).join(' → ')}`)], impact: 'Escalation loops.', rec: 'Break the cycle.', fix: 'agent_update({ "name": "<member>", "reports_to": "<root>" })' });
  projects.forEach(p => {
    const raw = M.projectRoles[p]; if (notAcc(raw)) return;
    const holders = A.filter(a => a.project === p && ROLE_SLOT[String(a.role).toLowerCase()]);
    const missing = holders.filter(a => !a.slots.includes(ROLE_SLOT[String(a.role).toLowerCase()]));
    if (missing.length) add({ check: 'H4', agents: missing.map(a => a.name), title: `${missing.length} agent(s) of ${p} hold a role but no project role slot`, evidence: [ev.note(`project_roles("${p}") → \`${JSON.stringify(raw)}\``), ev.table(['Agent', 'Role', 'Expected slot'], missing.map(a => [a.name, a.role, ROLE_SLOT[String(a.role).toLowerCase()]]))], impact: 'Per project_set_role: a project with no role holder makes every dispatch of that type fail.', rec: 'Assign each slot.', fix: missing.map(a => `project_set_role({ "slug": "${p}", "role": "${ROLE_SLOT[String(a.role).toLowerCase()]}", "agent": "${a.name}" })`).join('\n') });
  });
  // H5
  if (multi) A.forEach(a => { const peers = new Set(A.filter(b => b !== a).flatMap(b => b.docs.map(d => d.file))); const miss = a.missingStd.filter(f => peers.has(f)); if (miss.length) add({ check: 'H5', agents: [a.name], title: `${a.name} lacks ${miss.join(', ')} present on peers`, evidence: [ev.note(`Missing: ${miss.join(', ')}.`)], impact: 'Uneven identity coverage in the team.', rec: 'Add the missing docs.', fix: miss.map(f => `agent_doc_put ${a.name} ${f}`).join('\n') }); });

  // ---- K: skills ----
  const skillList = arr(M.skillList); const installed = Object.fromEntries(skillList.map(s => [s.id, s]));
  const attachments = arr(M.skillAttachments).filter(x => !x.exclude);
  const descOf = id => (installed[id] ? String(installed[id].description || '') : '');
  const descBroken = d => { const t = ws(d); return t.length < 40 || /^[>|][-+]?$/.test(t) || /[,:;(]$/.test(t); };
  const routesOf = (name, role, project) => attachments.filter(x => (x.scope === 'agent' && x.target === name) || (x.scope === 'role' && x.target === role) || (x.scope === 'project' && project && x.target === project) || x.scope === 'global');
  const fam = r => ROLE_SLOT[String(r || '').toLowerCase()] || String(r || '').toLowerCase();
  const groupBy = (items, key) => { const m = new Map(); items.forEach(it => { const k = key(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it); }); return [...m.entries()].sort((x, y) => cmpStr(x[0], y[0])); };
  A.forEach(a => {
    a.resolvedIds = (a.skills || []).map(s => s.id);
    a.catalogue = (a.skills || []).filter(s => s.mode === 'include' && !BUILTIN_SKILLS.includes(s.id)).map(s => ({ id: s.id, chars: [...ws(descOf(s.id))].length }));
    a.catChars = a.catalogue.reduce((t, x) => t + x.chars, 0);
  });
  // K1a — attached but not installed
  A.forEach(a => {
    const bad = routesOf(a.name, a.role, a.project).filter(x => !installed[x.skill]).sort((x, y) => cmpStr(x.skill, y.skill));
    if (bad.length) add({ check: 'K1', sev: 'high', auto: true, agents: [a.name], title: `${a.name} has ${bad.length} attachment(s) to skills that are not installed`, evidence: [ev.table(['Attachment id', 'Skill', 'Scope', 'Target', 'Mode'], bad.map(x => [String(x.id), x.skill, x.scope, x.target, x.mode])), ev.note('Not in skill_list: the agent is told the skill exists but cannot read it.')], impact: 'The catalogue line or import points at nothing; the agent fails or improvises when it reaches for it.', rec: 'Install the skill, or remove the attachment.', fix: bad.map(x => `skill_detach({ "skill": "${x.skill}", "${x.scope === 'agent' ? 'agent' : x.scope}": "${x.target}" })`).join('\n') });
  });
  // K1b — installed skill named in prose or in an applying DB rule, not resolved for the agent
  A.forEach(a => {
    const hits = [];
    skillList.filter(s => s.id.includes('-') && s.id.length >= 6 && !BUILTIN_SKILLS.includes(s.id) && !a.resolvedIds.includes(s.id)).forEach(s => {
      const re = new RegExp('(?<![\\w-])' + s.id.replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch) + '(?![\\w-])');
      a.docs.forEach(d => d.text.split(/\r?\n/).forEach(line => { if (re.test(line)) hits.push({ id: s.id, e: ev.doc(a.name, d.file, line.trim()) }); }));
      [...a.core, ...a.normal].forEach(r => { if (re.test(String(r.text))) hits.push({ id: s.id, e: ev.rule(r.id) }); });
    });
    groupBy(hits, h => h.id).forEach(([id, hs]) => add({ check: 'K1', agents: [a.name], title: `${a.name} names skill ${id} but it is not attached`, evidence: [...hs.map(h => h.e), ev.note(`Installed skill \`${id}\`: ${descOf(id) || '(no description)'}`)], impact: 'The instruction relies on guidance the agent never receives in its catalogue.', rec: 'Attach the skill in include mode, or reword the prose so it does not depend on it.', fix: `skill_attach({ "skill": "${id}", "agent": "${a.name}", "mode": "include" })` }));
  });
  // K2a — read with skill_get but not attached
  const readHits = [];
  A.forEach(a => { const rs = (a.reads && a.reads.skills) || {}; Object.keys(rs).sort(cmpStr).forEach(id => { if (!a.resolvedIds.includes(id) && installed[id] && !BUILTIN_SKILLS.includes(id) && rs[id].reads >= K_T.readsMin) readHits.push({ id, a, r: rs[id] }); }); });
  groupBy(readHits, h => h.id).forEach(([id, hs]) => add({ check: 'K2', agents: hs.map(h => h.a.name), title: `Skill ${id} is read on demand but not attached (${hs.map(h => h.r.reads).reduce((x, y) => x + y, 0)} reads / 30 d)`, evidence: [ev.table(['Agent', 'Reads', 'Missions'], hs.map(h => [h.a.name, String(h.r.reads), String(h.r.missions)])), ev.note(`Description: ${descOf(id)}`)], impact: 'The agent needs it repeatedly but only finds it through a task or by chance.', rec: 'Attach in include mode.', fix: hs.map(h => `skill_attach({ "skill": "${id}", "agent": "${h.a.name}", "mode": "include" })`).join('\n') }));
  // K2b — adopted by most role peers
  const peerHits = [];
  A.forEach(a => {
    const peers = listAll.filter(p => p.name !== a.name && fam(p.role) === fam(a.role));
    if (peers.length < K_T.peerMin) return;
    const cnt = {}; peers.forEach(p => new Set(routesOf(p.name, p.role, null).map(x => x.skill)).forEach(id => { cnt[id] = (cnt[id] || 0) + 1; }));
    Object.keys(cnt).sort(cmpStr).forEach(id => { if (installed[id] && !BUILTIN_SKILLS.includes(id) && !a.resolvedIds.includes(id) && cnt[id] / peers.length >= K_T.peerShare) peerHits.push({ id, a, n: cnt[id], of: peers.length }); });
  });
  groupBy(peerHits, h => h.id).forEach(([id, hs]) => add({ check: 'K2', sev: 'info', auto: true, agents: hs.map(h => h.a.name), title: `Skill ${id} is attached to most role peers but not to ${hs.length} audited agent(s)`, evidence: [ev.table(['Agent', 'Role', 'Peers with skill'], hs.map(h => [h.a.name, h.a.role, `${h.n}/${h.of}`])), ev.note(`Rule: ≥ ${K_T.peerMin} peers of the same role family and ≥ ${K_T.peerShare * 100}% of them attach it (agent and role attachments). Description: ${descOf(id)}`)], impact: 'Possible capability gap compared with agents of the same role.', rec: 'Attach in include mode if the agent does this kind of work; else dismiss with a reason.', fix: hs.map(h => `skill_attach({ "skill": "${id}", "agent": "${h.a.name}", "mode": "include" })`).join('\n') }));
  // K3 — overhead
  A.forEach(a => {
    if (a.catChars > K_T.catChars || a.catalogue.length > K_T.catCount) add({ check: 'K3', agents: [a.name], title: `${a.name} carries ${a.catalogue.length} catalogue skill(s), ${a.catChars} description chars (~${tok(a.catChars)} tok) per turn`, evidence: [ev.table(['Skill', 'Description chars'], a.catalogue.map(c => [c.id, String(c.chars)]))], impact: 'Every catalogue line is injected on every turn.', rec: `Detach skills the agent never reads (see H3); keep descriptions short. Thresholds: > ${K_T.catChars} chars or > ${K_T.catCount} skills.`, fix: 'skill_detach({ "skill": "<id>", "agent": "' + a.name + '" })' });
    if (a.importTok * 4 > K_T.importTotal) add({ check: 'K3', sev: 'high', auto: true, agents: [a.name], title: `${a.name} imports ~${a.importTok} tok of skills on every turn`, evidence: [ev.table(['Skill', 'Chars'], a.importSkills.map(s => [s.id, String(s.chars)]))], impact: 'Import-mode bodies are paid on every turn.', rec: 'Switch task-specific skills to include mode.', fix: a.importSkills.map(s => `skill_attach({ "skill": "${s.id}", "agent": "${a.name}", "mode": "include" })`).join('\n') });
    const dup = groupBy(routesOf(a.name, a.role, a.project).filter(x => installed[x.skill]), x => x.skill).filter(([, l]) => l.length > 1);
    if (dup.length) add({ check: 'K3', sev: 'low', auto: true, agents: [a.name], title: `${a.name} receives ${dup.length} skill(s) through several attachments`, evidence: [ev.table(['Skill', 'Routes'], dup.map(([id, l]) => [id, l.map(x => `#${x.id} ${x.scope}:${x.target} (${x.mode})`).join('; ')]))], impact: 'Redundant attachments; mode conflicts are resolved silently.', rec: 'Keep one attachment per skill at the widest correct scope.', fix: dup.map(([id]) => `skill_detach({ "skill": "${id}", "agent": "${a.name}" })  # keep the role/project route`).join('\n') });
  });
  const big = []; A.forEach(a => a.catalogue.forEach(c => { const sz = installed[c.id] && installed[c.id].size; if (sz > K_T.bigBody) big.push({ id: c.id, a, sz }); }));
  groupBy(big, h => h.id).forEach(([id, hs]) => add({ check: 'K3', sev: 'low', auto: true, agents: hs.map(h => h.a.name), title: `Catalogue skill ${id} is ${Math.round(hs[0].sz / 1024)} KB: one read costs ~${tok(hs[0].sz)} tok`, evidence: [ev.note(`skill_list size: ${hs[0].sz} B. Threshold: ${K_T.bigBody} B.`)], impact: 'Each read fills the context; repeated reads multiply it.', rec: 'Split into a short SKILL.md plus reference files read on demand (skill_get with file).', fix: `skill_put  ${id}  → short SKILL.md + references/*.md` }));
  // K4 — broken descriptions
  const broken = []; A.forEach(a => (a.skills || []).filter(s => s.mode === 'include' && !BUILTIN_SKILLS.includes(s.id) && installed[s.id] && descBroken(descOf(s.id))).forEach(s => broken.push({ id: s.id, a })));
  groupBy(broken, h => h.id).forEach(([id, hs]) => {
    add({ check: 'K4', agents: hs.map(h => h.a.name), title: `Catalogue description of ${id} is broken: "${ws(descOf(id)).slice(0, 60)}"`, evidence: [ev.note(`skill_list description: \`${ws(descOf(id)) || '(empty)'}\` (${ws(descOf(id)).length} chars). Rule: < 40 chars, a bare YAML block marker (> or |), or ends with , : ; (`), ev.note(`Path: \`${installed[id].path}\``)], impact: 'The catalogue line is the only thing the agent sees; a truncated or empty description gives it no reason to open the skill (see H3 for this skill).', rec: 'Write the description on one line in the front matter (no folded > block, no line break), with a WHEN: list.', fix: `skill_put  ${id}  → front matter "description: <one line, what + when>"` });
    F.filter(f => f.check === 'H3' && f.title.includes(`skill ${id} `)).forEach(f => f.evidence.push(ev.note(`Probable root cause: the catalogue description of \`${id}\` is broken (K4).`)));
  });

  // ---- judgment findings ----
  const jf = arr(J.findings); const notes = J.checkNotes || {};
  jf.forEach((f, i) => {
    const where = `judgment.findings[${i}]`;
    const cat = CATALOG[f.check]; if (!cat) { errors.push(`${where}: unknown check ${f.check}`); return; }
    if (cat[2] === 'script') errors.push(`${where}: ${f.check} is engine-only; do not author it`);
    if (MULTI_AGENT_CHECKS.includes(f.check) && !multi) errors.push(`${where}: ${f.check} needs ≥2 agents in scope`);
    ['title', 'impact', 'rec'].forEach(k => { if (!f[k]) errors.push(`${where}: ${k} missing`); });
    if (!arr(f.agents).length) errors.push(`${where}: agents missing`);
    arr(f.agents).forEach(n => { if (!byName[n]) errors.push(`${where}: agent ${n} not in scope`); });
    if (f.sev && f.sev !== cat[1] && !f.severityJustification) errors.push(`${where}: sev changed from ${cat[1]} to ${f.sev} without severityJustification`);
    if (f.sev && !SEVS.includes(f.sev)) errors.push(`${where}: bad sev ${f.sev}`);
    if (!arr(f.evidence).length) errors.push(`${where}: evidence missing`);
    F.push({ origin: 'judgment', ...f, agents: arr(f.agents) });
  });
  const dismissed = [];
  arr(J.dismiss).forEach((d, i) => {
    const where = `judgment.dismiss[${i}]`;
    if (!d.check || !d.titleContains || !d.reason) { errors.push(`${where}: check, titleContains and reason are required`); return; }
    if (!DISMISSIBLE.includes(d.check)) { errors.push(`${where}: ${d.check} is not dismissible (only ${DISMISSIBLE.join(', ')})`); return; }
    const hits = F.filter(f => f.origin === 'engine' && f.check === d.check && f.title.includes(d.titleContains));
    if (!hits.length) errors.push(`${where}: matches no engine finding`);
    hits.forEach(h => { F.splice(F.indexOf(h), 1); dismissed.push({ check: h.check, title: h.title, reason: d.reason }); });
  });
  Object.keys(CATALOG).filter(k => CATALOG[k][2] !== 'script').forEach(k => {
    if (MULTI_AGENT_CHECKS.includes(k) && !multi) return;
    if (!jf.some(f => f.check === k) && !(notes[k] && String(notes[k]).trim())) errors.push(`judgment.checkNotes.${k} missing: every judgment check needs ≥1 finding or a note saying what was checked and why it found nothing`);
  });

  // ---- evidence verification ----
  const findDoc = (agent, file) => { const a = byName[agent]; return a && a.docs.find(d => d.file === file); };
  const quoteIn = (hay, quote) => { const h = ws(hay); const parts = String(quote).split(/…|\.\.\./).map(ws).filter(Boolean); let pos = 0; for (const p of parts) { const k = h.indexOf(p, pos); if (k < 0) return false; pos = k + p.length; } return parts.length > 0; };
  F.forEach((f, fi) => arr(f.evidence).forEach((e, ei) => {
    const where = `${f.origin} finding "${f.title}" evidence[${ei}]`;
    if (e.doc) { const d = findDoc(e.doc.agent, e.doc.file); if (!d) errors.push(`${where}: doc ${e.doc.agent}/${e.doc.file} not collected`); else if (!quoteIn(d.text, e.doc.quote)) errors.push(`${where}: quote not found in ${e.doc.agent}/${e.doc.file}: "${e.doc.quote}"`); }
    else if (e.config) { const a = byName[e.config.agent]; if (!a) errors.push(`${where}: agent ${e.config.agent} not in scope`); else if (!quoteIn(a.configText, e.config.quote)) errors.push(`${where}: quote not found in ${e.config.agent}/config.json: ${e.config.quote}`); }
    else if (e.rule != null) { if (!ruleById[String(e.rule)]) errors.push(`${where}: DB rule ${e.rule} not in mcp.json rules`); }
    else if (e.file) { const all = [C.globalInstructions, ...C.workspace.flatMap(w => w.files)]; const src = all.find(x => x.path && normPath(x.path) === normPath(e.file.path)); if (!src || src.status !== 'ok') errors.push(`${where}: file ${e.file.path} not collected`); else if (!quoteIn(src.text, e.file.quote)) errors.push(`${where}: quote not found in ${e.file.path}`); }
    else if (!e.note && !e.table && !e.source) errors.push(`${where}: unknown evidence type`);
  }));
  if (errors.length) { console.error(errors.map(e => ' - ' + e).join('\n')); die(`${errors.length} validation error(s); nothing written`); }

  // ---- sort & number ----
  F.forEach(f => { f.sev = f.sev || CATALOG[f.check][1]; f.agents = [...new Set(f.agents)].sort(cmpStr); });
  F.sort((x, y) => SEVS.indexOf(x.sev) - SEVS.indexOf(y.sev) || CATS.indexOf(x.check[0]) - CATS.indexOf(y.check[0]) || cmpStr(x.agents[0], y.agents[0]) || cmpStr(x.check, y.check) || cmpStr(x.title, y.title));
  F.forEach((f, i) => { f.id = 'F' + String(i + 1).padStart(2, '0'); f.dbFlag = /memory_rule_(rm|add)/.test(f.fix || ''); });
  const counts = Object.fromEntries(SEVS.map(s => [s, F.filter(f => f.sev === s).length]));
  A.forEach(a => { a.f = Object.fromEntries(CATS.map(c => [c, 0])); let best = 9; F.filter(f => f.agents.includes(a.name)).forEach(f => { a.f[f.check[0]]++; best = Math.min(best, SEVS.indexOf(f.sev)); }); a.best = best === 9 ? null : SEVS[best]; });

  // ---- auto notes for engine checks with 0 findings ----
  const auto = {
    M1: `${A.length} effective model(s) found in the live catalog of their backend.`,
    M3: coders.length && reviewers.length ? 'No coder/reviewer pair of the same project shares backend + model.' : 'No coder/reviewer pair in scope.',
    S1: (() => { const all = A.flatMap(a => a.docs.map(d => ({ a, d }))); if (!all.length) return 'No identity docs.'; const m = all.reduce((x, y) => (y.d.bytes > x.d.bytes ? y : x)); return `Largest doc ${m.d.bytes} B (${m.a.name}/${m.d.file}) ≤ 4096 B.`; })(),
    S2: (() => { const m = A.reduce((x, y) => (y.docBytes > x.docBytes ? y : x)); return `Largest per-agent total ${m.docBytes} B (${m.name}) ≤ 12288 B.`; })(),
    S3: g.status === 'ok' ? `global-instructions.md ${g.bytes} B ≤ 3072 B.` : `global-instructions.md ${g.status}.`,
    H1: 'No pieges.md in any agent memory folder.', H3: 'Every attached catalogue skill was read at least once in 30 days (or none attached).',
    H4: 'reports_to targets exist, no cycle, project fields and role slots consistent.', H5: multi ? 'All agents carry the standard docs their peers carry.' : 'Single agent: not applicable.',
    K1: 'No attachment to a missing skill; no installed skill id named in prose or rules without being attached.', K2: `No skill read ≥ ${K_T.readsMin} times without attachment; no skill attached to ≥ ${K_T.peerShare * 100}% of ≥ ${K_T.peerMin} role peers missing here.`, K3: `Catalogue ≤ ${K_T.catChars} chars and ≤ ${K_T.catCount} skills per agent; imports ≤ ${K_T.importTotal} chars; no redundant routes; no catalogue body > ${K_T.bigBody} B.`, K4: 'Every attached catalogue skill has a usable description.',
    M2: 'Engine tier rule: no lightweight model on a reasoning role and no top-tier model on a mechanical role.', S4: 'No import-mode skill > 4 KB.', R1: 'No exact duplicate sentence inside one agent.', R3: 'No sentence copied verbatim across agents.',
  };

  // =================== HTML ===================
  const badge = s => `<span class="badge b-${s}">${PL[s][0]} ${PL[s][2]}</span>`;
  const ruleHtml = id => { const r = ruleById[String(id)]; return `<div class="rule"><span class="mono">[${r.id}]</span> <span class="tag">scope: ${esc(r.scope)}${r.role ? ' (' + esc(r.role) + ')' : ''}${r.project ? ' (' + esc(r.project) + ')' : ''}${r.agent ? ' (' + esc(r.agent) + ')' : ''}</span> <span class="tag">tier: ${esc(r.tier)}</span> <span class="tag">kind: ${esc(r.kind)}</span><blockquote>${esc(r.text)}</blockquote></div>`; };
  const evHtml = e => {
    if (e.doc) return `<div class="src"><div class="srcp mono">${esc(e.doc.agent)} / ${esc(e.doc.file)} <span class="ver">verified</span></div><blockquote>${esc(e.doc.quote)}</blockquote></div>`;
    if (e.config) return `<div class="src"><div class="srcp mono">${esc(e.config.agent)} / config.json <span class="ver">verified</span></div><blockquote>${esc(e.config.quote)}</blockquote></div>`;
    if (e.file) return `<div class="src"><div class="srcp mono">${esc(e.file.path)} <span class="ver">verified</span></div><blockquote>${esc(e.file.quote)}</blockquote></div>`;
    if (e.rule != null) return ruleHtml(e.rule);
    if (e.source) return `<div class="src"><div class="srcp mono">${esc(e.source)} <span class="unver">not machine-verified</span></div><blockquote>${esc(e.quote)}</blockquote></div>`;
    if (e.table) return `<table class="mini"><tr>${e.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${e.table.rows.map(r => `<tr>${r.map(c => `<td class="mono">${md(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    return `<p>${md(e.note)}</p>`;
  };
  const tile = f => `<details class="finding" data-sev="${f.sev}" data-cat="${f.check[0]}" data-agents="${esc(f.agents.join('|'))}">
<summary><span class="imp imp-${f.sev}">${PL[f.sev][0]} — ${PL[f.sev][1]}</span>${badge(f.sev)}<span class="chk mono">${f.check}</span><span class="fid mono">${f.id}</span><span class="ttl">${md(f.title)}</span><span class="cnt">${f.agents.length} agent${f.agents.length > 1 ? 's' : ''}</span><span class="orig">${f.origin}</span></summary>
<div class="fbody"><p><b>Affected:</b> ${f.agents.map(n => `<code>${esc(n)}</code>`).join(' ')}</p>${f.sev !== CATALOG[f.check][1] && !f.auto ? `<p class="adj">Severity adjusted from <b>${CATALOG[f.check][1]}</b> to <b>${f.sev}</b>: ${md(f.severityJustification)}</p>` : ''}<h4>Evidence</h4>${arr(f.evidence).map(evHtml).join('')}<h4>Impact</h4><p>${md(f.impact)}</p><h4>Recommendation</h4><p>${md(f.rec)}</p>${f.fix ? `<pre class="snip">${esc(f.fix)}</pre>` : ''}</div></details>`;
  const checksTable = cat => `<table class="mini checks"><tr><th>Check</th><th>Name</th><th>Method</th><th>Default</th><th>Findings</th><th>Evaluation note</th></tr>${Object.keys(CATALOG).filter(k => k[0] === cat).map(k => { const n = F.filter(f => f.check === k).length; const na = MULTI_AGENT_CHECKS.includes(k) && !multi; const own = CATALOG[k][2]; const note = na ? 'Not applicable (single agent).' : [own !== 'judgment' && !F.some(f => f.check === k && f.origin === 'engine') ? auto[k] : null, notes[k] || null, ...dismissed.filter(x => x.check === k).map(x => `Dismissed: ${x.title} — ${x.reason}`)].filter(Boolean).join(' · ') || '—'; return `<tr><td class="mono">${k}</td><td>${CATALOG[k][0]}</td><td>${own === 'script' ? 'engine' : own === 'both' ? 'engine + judgment' : 'judgment'}</td><td>${CATALOG[k][1]}</td><td class="num">${n}</td><td class="small">${md(note)}</td></tr>`; }).join('')}</table>`;
  const section = cat => { const list = F.filter(f => f.check[0] === cat); return checksTable(cat) + (list.length ? list.map(tile).join('\n') : '<p class="empty">0 findings</p>'); };

  // ---- SVG chain ----
  const nodeW = 176, nodeH = 84, gapX = 22, levelH = 150, margin = 24;
  const inScope = new Set(A.map(a => a.name));
  const outParents = [...new Set(A.map(a => a.reportsTo).filter(p => p && !inScope.has(p)))].sort(cmpStr);
  const depthOf = {}; const dfs = (n, seen) => { if (depthOf[n] != null) return depthOf[n]; if (seen.has(n)) return 0; seen.add(n); const p = byName[n].reportsTo; const d = p && inScope.has(p) && !cyc.has(n) ? dfs(p, seen) + 1 : 0; depthOf[n] = d; return d; };
  A.forEach(a => dfs(a.name, new Set()));
  const shift = outParents.length ? 1 : 0;
  const levels = []; if (shift) levels.push(outParents.map(n => ({ id: n, ext: true, dangling: !listByName[n] })));
  const maxD = Math.max(...Object.values(depthOf));
  for (let d = 0; d <= maxD; d++) levels.push(A.filter(a => depthOf[a.name] === d).map(a => ({ id: a.name })));
  const ghosts = []; F.filter(f => f.ghost && !(f.check === 'H4' && outParents.includes(f.ghost.label))).forEach(f => { const g0 = ghosts.find(x => x.label === f.ghost.label); if (g0) { g0.from = [...new Set(g0.from.concat(f.ghost.from))].sort(cmpStr); } else ghosts.push({ label: f.ghost.label, sub: f.ghost.sub || '', from: [...f.ghost.from].sort(cmpStr), fid: f.id }); });
  ghosts.sort((x, y) => cmpStr(x.label, y.label));
  const pos = {}; const maxCount = Math.max(...levels.map(l => l.length), ghosts.length, 1);
  const W = Math.max(960, margin * 2 + maxCount * (nodeW + gapX));
  levels.forEach((lvl, li) => {
    lvl.sort((x, y) => { const px = n => { const p = byName[n.id] && byName[n.id].reportsTo; return p && pos[p] ? pos[p].x : 0; }; return px(x) - px(y) || cmpStr(x.id, y.id); });
    const tw = lvl.length * nodeW + (lvl.length - 1) * gapX; lvl.forEach((n, i) => { pos[n.id] = { x: (W - tw) / 2 + i * (nodeW + gapX), y: 16 + li * levelH, n }; });
  });
  const gy = 16 + levels.length * levelH; const gtw = ghosts.length * (nodeW + gapX) - gapX;
  ghosts.forEach((g, i) => { g.x = (W - gtw) / 2 + i * (nodeW + gapX); g.y = gy; });
  const H = gy + (ghosts.length ? 80 : 0) + 50;
  const sevColor = s => (s ? `var(--${PL[s][0].toLowerCase()})` : 'var(--ok)');
  const curve = (x1, y1, x2, y2, cls, mk) => `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}" class="${cls}"${mk ? ` marker-end="url(#${mk})"` : ''}/>`;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chain" role="img" aria-label="Reporting chain"><defs><marker id="arrw" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="arrw"/></marker></defs>`;
  A.forEach(a => { const p = a.reportsTo; if (p && pos[p]) svg += curve(pos[p].x + nodeW / 2, pos[p].y + nodeH - (pos[p].n.ext ? 20 : 0), pos[a.name].x + nodeW / 2, pos[a.name].y, cyc.has(a.name) && cyc.has(p) ? 'e-cycle' : 'e-solid'); });
  ghosts.forEach(gh => gh.from.forEach(f => { if (pos[f]) svg += curve(pos[f].x + nodeW / 2, pos[f].y + nodeH, gh.x + nodeW / 2, gh.y, 'e-warn', 'arrw'); }));
  outParents.forEach(n => { const p = pos[n]; const meta = listByName[n]; svg += `<g><rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH - 20}" rx="10" class="${meta ? 'ncard oos' : 'ghost'}"/><text x="${p.x + 10}" y="${p.y + 22}" class="nname${meta ? '' : ' warn'}">${esc(n.length > 24 ? n.slice(0, 23) + '…' : n)}</text><text x="${p.x + 10}" y="${p.y + 40}" class="nsub">${meta ? esc(meta.role || '') + ' · out-of-scope parent' : 'missing agent (dangling reports_to)'}</text>${meta ? `<text x="${p.x + 10}" y="${p.y + 55}" class="nsub">reports_to ${esc(meta.reports_to || '—')}</text>` : ''}</g>`; });
  A.forEach(a => { const p = pos[a.name]; const col = sevColor(a.best); const lbl = a.best ? PL[a.best][0] : 'OK'; const sh = a.short.length > 22 ? a.short.slice(0, 21) + '…' : a.short; const mdl = `${a.beId}/${a.model}`;
    svg += `<g class="node" data-agent="${esc(a.name)}" tabindex="0" role="button"><title>${esc(a.name)}</title><rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="10" class="ncard" style="stroke:${col}"/><rect x="${p.x + nodeW - 34}" y="${p.y + 6}" width="28" height="16" rx="4" style="fill:${col}"/><text x="${p.x + nodeW - 20}" y="${p.y + 18}" class="nbadge" text-anchor="middle">${lbl}</text><text x="${p.x + 10}" y="${p.y + 20}" class="nname">${esc(sh)}</text><text x="${p.x + 10}" y="${p.y + 37}" class="nsub">role: ${esc(a.role || '—')}</text><text x="${p.x + 10}" y="${p.y + 52}" class="nsub">slot: ${a.project ? esc(a.slots.join(', ') || 'unassigned') : 'n/a'}</text><text x="${p.x + 10}" y="${p.y + 67}" class="nsub mono">${esc(mdl.length > 30 ? mdl.slice(0, 29) + '…' : mdl)}</text></g>`; });
  ghosts.forEach(gh => { svg += `<g><title>${esc(gh.label)} — ${esc(gh.sub)} (${gh.fid})</title><rect x="${gh.x}" y="${gh.y}" width="${nodeW}" height="54" rx="10" class="ghost"/><text x="${gh.x + 10}" y="${gh.y + 22}" class="nname warn">${esc(gh.label.length > 24 ? gh.label.slice(0, 23) + '…' : gh.label)}</text><text x="${gh.x + 10}" y="${gh.y + 40}" class="nsub">${esc((gh.sub || '').slice(0, 34))}</text></g>`; });
  svg += `<g transform="translate(16,${H - 30})" class="legend"><line x1="0" y1="8" x2="30" y2="8" class="e-solid"/><text x="36" y="12">reports_to</text><line x1="120" y1="8" x2="150" y2="8" class="e-cycle"/><text x="156" y="12">cycle</text><line x1="210" y1="8" x2="240" y2="8" class="e-warn"/><text x="246" y="12">prose escalation to missing/contradicting target</text><rect x="560" y="0" width="22" height="16" rx="3" class="ghost"/><text x="588" y="12">ghost</text><rect x="640" y="0" width="22" height="16" rx="3" class="ncard oos"/><text x="668" y="12">out of scope</text>${SEVS.map((s, i) => `<rect x="${770 + i * 46}" y="0" width="14" height="14" rx="3" style="fill:${sevColor(s)}"/><text x="${788 + i * 46}" y="12">${PL[s][0]}</text>`).join('')}<rect x="${770 + 5 * 46}" y="0" width="14" height="14" rx="3" style="fill:var(--ok)"/><text x="${788 + 5 * 46}" y="12">OK</text></g></svg>`;

  // ---- tables ----
  const maxDocB = Math.max(1, ...A.flatMap(a => a.docs.map(d => d.bytes)));
  const rulesBlock = (title, list) => `<p class="small"><b>${title}</b>${list.length ? '' : ': none'}</p>${list.map(r => ruleHtml(r.id)).join('')}`;
  const drawer = a => `<tr class="drawer" id="dr-${a.idx}"><td colspan="11"><details id="det-${a.idx}"><summary>Details — ${esc(a.name)}</summary><div class="dgrid"><div>
<h4>Identity .md files</h4>${a.docs.length ? a.docs.map(d => `<div class="bar"><span class="mono bl">${esc(d.file)}</span><span class="bt"><span style="width:${Math.round(d.bytes / maxDocB * 100)}%"></span></span><span class="mono">${d.bytes} B · ${d.lines} l · ~${d.tok} tok</span></div>`).join('') : '<p class="small">none</p>'}${a.missingStd.length ? `<p class="small">Standard docs not present: ${a.missingStd.join(', ')}</p>` : ''}<p class="mono small">Total: ${a.docBytes} B · ~${a.docTok} tok</p>
<h4>Provider / model / config</h4><p class="mono small">backend: ${esc(a.beId)} (${a.beSrc})<br>model: ${esc(a.model)} (${a.modelSrc})${a.cfg.reasoningEffort ? '<br>reasoningEffort: ' + esc(a.cfg.reasoningEffort) : ''}<br>permission_mode: ${esc(a.cfg.permission_mode || 'not set')}<br>memory_scope: ${esc(a.cfg.memory_scope || 'not set (default)')}<br>mcp_servers: ${esc(arr(a.cfg.mcp_servers).join(', ') || 'none')}<br>excluded_mcp_servers: ${esc(arr(a.cfg.excluded_mcp_servers).join(', ') || 'none')}<br>allowed_tools: ${esc(arr(a.cfg.allowed_tools).join(', ') || 'not set')}<br>disallowed_tools: ${esc(arr(a.cfg.disallowed_tools).join(', ') || 'not set')}<br>cwd: ${esc(a.cwd)}<br>role prompt note: UI-only (verify in Agent injections widget)</p>
<h4>Memory folder</h4><p class="mono small">${a.memory ? a.memory.map(m => `${esc(m.file)}: ${m.bytes.toLocaleString('en')} B${m.lines != null ? ', ' + m.lines + ' lines' : ''}`).join('<br>') || 'empty' : 'not present'}<br>learnings.jsonl: ${a.memory && a.memory.some(m => m.file === 'learnings.jsonl') ? 'present' : 'not present'} · pieges.md: ${a.memory && a.memory.some(m => /^pieges\.md$/i.test(m.file)) ? 'PRESENT (dead)' : 'not present'}</p></div>
<div><h4>Injected DB rules (full text)</h4>${rulesBlock('Global core', a.core.filter(r => r.scope === 'global'))}${rulesBlock('Project core', a.core.filter(r => r.scope === 'project'))}${rulesBlock('Role core', a.core.filter(r => r.scope === 'role'))}${rulesBlock('Agent core', a.core.filter(r => r.scope === 'agent'))}${rulesBlock('Normal tier (recalled by match)', a.normal)}
<h4>Resolved skills</h4>${a.skills == null ? '<p class="small">not accessible</p>' : a.skills.length ? `<table class="mini"><tr><th>id</th><th>mode</th><th>via</th><th>30-d reads / missions</th><th>~tok</th></tr>${a.skills.map(s => { const r = a.reads && a.reads.skills && a.reads.skills[s.id]; const im = a.importSkills.find(x => x.id === s.id); return `<tr><td class="mono">${esc(s.id)}</td><td>${esc(s.mode)}</td><td>${esc(s.via)}</td><td>${r ? r.reads + ' / ' + r.missions : 0}${a.reads && a.reads.missions != null ? ' (of ' + a.reads.missions + ')' : ''}</td><td>${im ? im.tok : '—'}</td></tr>`; }).join('')}</table>` : '<p class="small">none</p>'}${a.reads && a.reads.skills ? (() => { const extra = Object.keys(a.reads.skills).filter(id => !(a.skills || []).some(s => s.id === id)).sort(cmpStr); return extra.length ? `<p class="small">Read but not attached: ${extra.map(id => `${esc(id)} (${a.reads.skills[id].reads})`).join(', ')}</p>` : ''; })() : ''}</div></div></details></td></tr>`;
  const invRows = A.map(a => `<tr class="arow" data-agent="${esc(a.name)}"><td><a href="#dr-${a.idx}" class="alink">${esc(a.name)}</a></td><td>${esc(a.role)}</td><td class="mono">${esc(a.beId)} / ${esc(a.model)}</td><td class="mono">${esc(a.reportsTo || '—')}</td><td class="num">${a.docs.length}</td><td class="num">${(a.docBytes / 1024).toFixed(2)} KB / ~${a.docTok}</td><td class="num">${a.importSkills.length} (~${a.importTok})</td><td class="num">${a.core.length} (~${a.coreTok})</td><td class="num"><b>~${a.alwaysOn}</b></td><td class="num">${a.catalogue.length} (~${tok(a.catChars)})</td><td class="mono">${CATS.map(c => a.f[c]).join('/')}</td></tr>${drawer(a)}`).join('\n');
  const fitRows = A.map(a => { const slugs = a.be ? arr(a.be.models).map(m => m.slug) : []; const inCat = a.be && slugs.includes(a.model); const t = tierOf(a.model); const r = String(a.role).toLowerCase(); const bad = (t === 'light' && REASONING_ROLES.includes(r)) || (t === 'top' && MECHANICAL_ROLES.includes(r));
    return `<tr><td>${esc(a.name)}</td><td>${esc(a.role)}</td><td class="mono">${esc(a.beId)} (${a.beSrc}) · ${esc(a.be ? a.be.permissionModel : '?')} · signedIn ${a.be ? String(a.be.signedIn) : '?'}</td><td class="mono">${esc(a.model)} (${a.modelSrc})</td><td>${inCat ? '<span class="badge ok">In catalog</span>' : '<span class="badge b-critical">Not in catalog</span>'}</td><td>tier <b>${t}</b> — ${bad ? '<span class="badge b-medium">Mismatch</span>' : 'fit'}</td><td>${!inCat ? 'Fix slug (M1)' : bad ? 'Change tier (M2)' : 'keep'}</td></tr>`; }).join('');
  const stat = s => `<span class="st st-${s.replace(/\s+/g, '-')}">${s}</span>`;
  const mstat = (v, okText) => (v === undefined ? ['not accessible', 'missing in mcp.json'] : notAcc(v) ? ['not accessible', v.reason || ''] : ['ok', okText(v)]);
  const src = [];
  src.push(['backends_list (live catalog)', 'ok', `${backends.length} backends; default ${defaultBackend}`]);
  src.push(['global-instructions.md', g.status, g.path + (g.status === 'ok' ? ` — ${g.bytes} B` : '')]);
  src.push(['Global DB rules', ...mstat(rulesIn.global, v => `${arr(v).length} rule(s), ${arr(v).filter(r => r.tier === 'core').length} core`)]);
  src.push(['Role DB rules', ...mstat(rulesIn.role, v => `${arr(v).length} rule(s); roles: ${[...new Set(arr(v).map(r => r.role))].join(', ') || '—'}`)]);
  projects.forEach(p => { src.push([`Project DB rules (${p})`, ...mstat(rulesIn.project[p], v => `${arr(v).length} rule(s)`)]); src.push([`Project reference memory (${p})`, ...mstat(M.projectMemory[p], v => `${arr(v).length} file(s)`)]); src.push([`project_roles (${p})`, ...mstat(M.projectRoles[p], v => JSON.stringify(v).slice(0, 120))]); });
  C.workspace.forEach(w => w.files.forEach(f => src.push([`Workspace ${f.file}`, f.status, `${w.cwd}\\${f.file}${f.status === 'ok' ? ' — ' + f.bytes + ' B' : ''}`])));
  if (!C.workspace.length) src.push(['Workspace CLI files', 'not present', 'no cwd configured']);
  src.push(['Identity .md docs (disk = agent_doc_get source)', 'ok', `${A.length} agent(s), ${A.reduce((s, a) => s + a.docs.length, 0)} file(s)`]);
  src.push(['Agent DB rules', 'ok', A.map(a => `${a.short}: ${notAcc(rulesIn.agent[a.name]) ? 'n/a' : arr(rulesIn.agent[a.name]).length}`).join(' · ')]);
  src.push(['skill_resolve / skill_get / skill_reads', A.some(a => a.skills == null) ? 'not accessible' : 'ok', `${A.reduce((s, a) => s + a.importSkills.length, 0)} import, ${A.reduce((s, a) => s + (a.skills || []).filter(x => x.mode === 'include').length, 0)} catalogue attachment(s)`]);
  src.push(['Agent memory folders', 'ok', A.map(a => `${a.short}: ${a.memory ? a.memory.length + ' file(s)' : 'none'}`).join(' · ')]);
  src.push(['config.json', A.every(a => a.configStatus === 'ok') ? 'ok' : 'not accessible', `${A.filter(a => a.configStatus === 'ok').length}/${A.length} read (read-only)`]);
  src.push(['Role prompt notes', 'not accessible', 'UI-only (verify in Agent injections widget)']);
  const srcRows = src.map(s => `<tr><td>${esc(s[0])}</td><td>${stat(s[1])}</td><td class="mono small">${esc(s[2])}</td></tr>`).join('');
  const actions = F.filter(f => f.fix).map(f => `<li data-sev="${f.sev}"><div class="ah">${badge(f.sev)} <span class="mono">${f.id} · ${f.check}</span> ${md(f.title)} ${f.dbFlag ? '<span class="badge fresh">DB rule change → fresh_conversation on next mission</span>' : ''}</div><div class="snipw"><pre class="snip">${esc(f.fix)}</pre><button class="copy">Copy</button></div></li>`).join('\n');
  const totalAlways = A.reduce((s, a) => s + a.alwaysOn, 0); const maxA = A.reduce((m, a) => (a.alwaysOn > m.alwaysOn ? a : m));
  const beSummary = backends.map(b => `${esc(b.id)} (default <code>${esc(b.defaultModel)}</code>, ${esc(b.permissionModel)}, signedIn ${String(b.signedIn)}: ${arr(b.models).map(m => esc(m.slug)).join(', ')})`).join(' · ');
  const hash = crypto.createHash('sha256').update(JSON.stringify([C, M, J])).digest('hex').slice(0, 16);
  const scopeLabel = C.scope.mode === 'team' ? C.names.join(', ') : C.scope.target;
  const title = `Agent Config Consistency Audit — ${C.scope.slug}`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#f7f7f9;--fg:#1d1f24;--mut:#5d6370;--card:#fff;--bd:#dcdfe5;--code:#f0f1f4;--p0:#d92d20;--p1:#e8700a;--p2:#c99400;--p3:#2f6fdb;--p4:#64748b;--ok:#16a34a;--warn:#d92d20}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e6e8ec;--mut:#9aa1ad;--card:#1d2026;--bd:#323741;--code:#262a31}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:1240px;margin:0 auto;padding:20px}h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--bd)}h3{font-size:15px}h4{margin:12px 0 4px;font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.03em}
.mono,code,pre{font-family:ui-monospace,Consolas,Menlo,monospace;font-size:12.5px}code{background:var(--code);padding:1px 4px;border-radius:4px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--bd);padding:6px 8px;text-align:left;vertical-align:top}th{font-size:12px;color:var(--mut)}
.tw{overflow-x:auto}.num{text-align:right;white-space:nowrap}.small{font-size:12px}.mini td,.mini th{padding:3px 6px;font-size:12px}.checks{margin:6px 0 10px;background:var(--card);border:1px solid var(--bd);border-radius:8px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.kpi{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px;border-top:4px solid var(--mut)}.kpi .v{font-size:24px;font-weight:700}.kpi .l{font-size:12px;color:var(--mut)}
.badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11.5px;font-weight:600;color:#fff;white-space:nowrap}.b-critical{background:var(--p0)}.b-high{background:var(--p1)}.b-medium{background:var(--p2)}.b-low{background:var(--p3)}.b-info{background:var(--p4)}.badge.ok{background:var(--ok)}.badge.fresh{background:#7c3aed}
.st{font-size:11.5px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd)}.st-ok{color:var(--ok)}.st-not-present{color:var(--mut)}.st-not-accessible{color:var(--p1)}
details.finding{background:var(--card);border:1px solid var(--bd);border-radius:10px;margin:8px 0}details.finding>summary{cursor:pointer;padding:10px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;list-style:none}details.finding>summary::-webkit-details-marker{display:none}
details.finding[data-sev=critical]{border-left:5px solid var(--p0)}details.finding[data-sev=high]{border-left:5px solid var(--p1)}details.finding[data-sev=medium]{border-left:5px solid var(--p2)}details.finding[data-sev=low]{border-left:5px solid var(--p3)}details.finding[data-sev=info]{border-left:5px solid var(--p4)}
.imp{font-weight:700;font-size:12px}.imp-critical{color:var(--p0)}.imp-high{color:var(--p1)}.imp-medium{color:var(--p2)}.imp-low{color:var(--p3)}.imp-info{color:var(--p4)}.chk,.fid{background:var(--code);padding:0 6px;border-radius:4px}.ttl{font-weight:600;flex:1 1 300px}.cnt,.orig{color:var(--mut);font-size:12px}
.fbody{padding:0 14px 12px}.src{margin:6px 0}.srcp{color:var(--mut);font-size:12px}.ver{color:var(--ok)}.unver{color:var(--p1)}.adj{color:var(--p1);font-size:12.5px}.caveat{margin:10px 0 14px;padding:10px 14px;border:1px solid var(--p2);border-left:5px solid var(--p2);border-radius:8px;background:var(--card);font-size:13px}.caveat b{color:var(--p2)}blockquote{margin:2px 0 6px;padding:6px 10px;background:var(--code);border-left:3px solid var(--bd);border-radius:4px;white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
.rule{margin:6px 0}.tag{font-size:11px;color:var(--mut);border:1px solid var(--bd);border-radius:4px;padding:0 4px}
.snip{background:var(--code);padding:8px 10px;border-radius:6px;white-space:pre-wrap;margin:6px 0}.snipw{position:relative}.copy{position:absolute;top:6px;right:6px;font-size:11px}
.filters{position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-bottom:1px solid var(--bd)}
select,button{font:inherit;font-size:12.5px;padding:4px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--card);color:var(--fg);cursor:pointer}
.empty{color:var(--mut);font-style:italic;padding:8px 12px;background:var(--card);border:1px dashed var(--bd);border-radius:8px}
.chain{width:100%;height:auto;background:var(--card);border:1px solid var(--bd);border-radius:10px}.ncard{fill:var(--card);stroke-width:2.5}.ncard.oos{stroke:var(--mut);stroke-dasharray:2 3}.ghost{fill:none;stroke:var(--warn);stroke-dasharray:6 4;stroke-width:1.5}
.nname{font-weight:700;font-size:13px;fill:var(--fg)}.nname.warn{fill:var(--warn)}.nsub{font-size:10.5px;fill:var(--mut)}.nbadge{font-size:10px;font-weight:700;fill:#fff}.e-solid{stroke:var(--mut);stroke-width:1.6;fill:none}.e-cycle{stroke:var(--p0);stroke-width:2;fill:none}.e-warn{stroke:var(--warn);stroke-width:1.2;stroke-dasharray:5 4;fill:none;opacity:.7}.arrw{fill:var(--warn)}
.legend text{font-size:11px;fill:var(--mut)}.node{cursor:pointer}.node:hover .ncard,.node:focus .ncard{stroke-width:4}
.dgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:8px}@media(max-width:800px){.dgrid{grid-template-columns:1fr}}
.bar{display:flex;align-items:center;gap:8px;margin:3px 0}.bl{width:130px}.bt{flex:1;height:8px;background:var(--code);border-radius:4px;overflow:hidden}.bt span{display:block;height:100%;background:var(--p3)}
tr.drawer>td{padding:0 8px;border-bottom:1px solid var(--bd)}tr.drawer summary{cursor:pointer;color:var(--mut);font-size:12px;padding:4px 0}
ol.actions li{margin:8px 0}tr.hl{outline:2px solid var(--p3)}footer{color:var(--mut);font-size:11.5px;margin:30px 0 10px}
@media print{.filters,button{display:none}body{background:#fff;color:#000}}
</style></head><body><main>
<section id="s1"><h1>${esc(title)}</h1>
<div class="caveat" role="note"><b>⚠ Indicative screening — verify before acting.</b> Findings show where the configuration <i>could</i> cause problems, not proof that it does; this audit reads configuration only, not mission behaviour, so it does not necessarily show the smoking gun of an incident (use mission traces for that). A clean result is not a guarantee of a healthy configuration. Judgment findings are model opinions; thresholds are rules of thumb.</div>
<p class="small">Scope mode: <b>${esc(C.scope.mode)}</b> · target: <code>${esc(scopeLabel)}</code> · as-of: <b>${esc(C.asOf)}</b> · skill <code>agent-config-consistency-audit</code> v${VERSION} · engine <code>audit.js</code> v${VERSION} · agents: <b>${A.length}</b>${M.auditor ? ' · auditor: ' + esc(M.auditor) : ''} · read-only</p>
<div class="card small"><b>Live backends_list:</b> ${beSummary}. Default backend: ${esc(defaultBackend)}.<br><b>Selected agents:</b> ${C.names.map(n => `<code>${esc(n)}</code>`).join(' ')}${arr(M.envNotes).length ? '<br><b>Environment notes:</b> ' + arr(M.envNotes).map(md).join(' · ') : ''}</div>
<h4>Sources inspected</h4><div class="tw"><table><tr><th>Source</th><th>Status</th><th>Detail</th></tr>${srcRows}</table></div></section>
<section id="s2"><h2>2. Executive KPIs</h2><div class="kpis">
<div class="kpi"><div class="v">${A.length}</div><div class="l">Agents Audited</div></div>
<div class="kpi"><div class="v">~${totalAlways.toLocaleString('en')}</div><div class="l">Total Always-On (~tok) · avg ~${Math.round(totalAlways / A.length)} · max ~${maxA.alwaysOn} (${esc(maxA.short)})</div></div>
<div class="kpi" style="border-top-color:var(--p0)"><div class="v">${counts.critical}</div><div class="l">Critical (P0)</div></div>
<div class="kpi" style="border-top-color:var(--p1)"><div class="v">${counts.high}</div><div class="l">High (P1)</div></div>
<div class="kpi" style="border-top-color:var(--p2)"><div class="v">${counts.medium}</div><div class="l">Medium (P2)</div></div>
<div class="kpi" style="border-top-color:var(--p3)"><div class="v">${counts.low} / ${counts.info}</div><div class="l">Low / Info (P3–P4)</div></div></div>
<p class="small">Always-on = global-instructions.md (${C.globalInstructions.tok}) + identity .md + import skills + core DB rules (est_tokens = ceil(chars/4)). Not counted: normal-tier DB rules, catalogue skills, workspace CLI files, Timon built-in preamble and role prompt.</p></section>
<div class="filters"><b>Filter findings:</b>
<label>Severity <select id="fs"><option value="">All</option>${SEVS.map(s => `<option value="${s}">${PL[s][2]}</option>`).join('')}</select></label>
<label>Category <select id="fc"><option value="">All</option>${CATS.map(c => `<option>${c}</option>`).join('')}</select></label>
<label>Agent <select id="fa"><option value="">All</option>${A.map(a => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('')}</select></label>
<button id="ex">Expand All</button><button id="co">Collapse All</button><span id="fcount" class="small"></span></div>
<section id="s3"><h2>3. Reporting Chain, Agent Inventory &amp; Full DB Rules</h2>${svg}
<p class="small">Click an agent node to open its drawer and filter findings to it.</p>
<div class="tw"><table><tr><th>Agent</th><th>Role</th><th>Provider / Model</th><th>Reports To</th><th>.md Files</th><th>.md Weight (KB / ~tok)</th><th>Import Skills (~tok)</th><th>Core DB Rules</th><th>Total Always-On (~tok)</th><th>Catalogue (~tok)</th><th>Findings (${CATS.join('/')})</th></tr>${invRows}</table></div></section>
<section id="s4"><h2>4. Provider &amp; Model Evaluation by Role (M1–M3)</h2><div class="tw"><table><tr><th>Agent</th><th>Role</th><th>Effective Provider</th><th>Effective Model</th><th>Catalog Status</th><th>Role Fit</th><th>Recommendation</th></tr>${fitRows}</table></div><p class="small">Tier rule (fixed): light = /${LIGHT_MODEL.source}/, top = /${TOP_MODEL.source}/, else mid. Reasoning roles: ${REASONING_ROLES.join(', ')}. Mechanical roles: ${MECHANICAL_ROLES.join(', ')}.</p>${section('M')}</section>
<section id="s5"><h2>5. Contradictions &amp; Conflicts (C1–C5, Intra-File &amp; Inter-File)</h2>${section('C')}</section>
<section id="s6"><h2>6. Size &amp; Always-On Context Bloat (S1–S4)</h2>${section('S')}</section>
<section id="s7"><h2>7. Skills: Missing, Suggested &amp; Overhead (K1–K4)</h2><div class="tw"><table class="mini"><tr><th>Agent</th><th>Resolved skills (mode)</th><th>Catalogue lines (~tok)</th><th>Import (~tok)</th><th>Read but not attached</th></tr>${A.map(a => `<tr><td>${esc(a.name)}</td><td class="mono">${esc((a.skills || []).map(s => s.id + ' (' + s.mode + ')').join(', ') || '—')}</td><td class="num">${a.catalogue.length} (~${tok(a.catChars)})</td><td class="num">${a.importSkills.length} (~${a.importTok})</td><td class="mono">${esc(Object.keys((a.reads && a.reads.skills) || {}).filter(id => !a.resolvedIds.includes(id)).sort(cmpStr).map(id => id + ' ×' + a.reads.skills[id].reads).join(', ') || '—')}</td></tr>`).join('')}</table></div><p class="small">Installed skills: ${skillList.length}. Attachments in Timon: ${attachments.length}. Fixed thresholds: catalogue > ${K_T.catChars} chars or > ${K_T.catCount} skills; import total > ${K_T.importTotal} chars; catalogue body > ${K_T.bigBody} B; read-not-attached ≥ ${K_T.readsMin} reads; peer adoption ≥ ${K_T.peerShare * 100}% of ≥ ${K_T.peerMin} same-role peers.</p>${section('K')}</section>
<section id="s8"><h2>8. Redundancies &amp; Scope Consolidation (R1–R4, Intra-File &amp; Inter-File)</h2>${section('R')}</section>
<section id="s9"><h2>9. Hygiene Drift (H1–H5) &amp; Prioritized Action Plan</h2>${section('H')}
<h3>Prioritized Action Plan</h3><p class="small">Apply in this order, after approval. Never delete <code>system-prompt.md</code>. Doc edits: <code>agent_doc_put</code> / <code>agent_doc_rm</code>; model fixes: <code>agent_update</code> with slugs from <code>backends_list</code>; skills: <code>skill_attach</code> / <code>skill_detach</code>; global/workspace/role changes: global-instructions.md, AGENTS.md or <b>Manage roles</b>.</p>${actions ? `<ol class="actions">${actions}</ol>` : '<p class="empty">0 actions</p>'}</section>
<footer>Generated by audit.js v${VERSION} · input fingerprint ${hash} · ${F.length} findings (${F.filter(f => f.origin === 'engine').length} engine, ${F.filter(f => f.origin === 'judgment').length} judgment)</footer>
</main>
<script>
(function(){var fs=document.getElementById('fs'),fc=document.getElementById('fc'),fa=document.getElementById('fa'),cnt=document.getElementById('fcount');
function apply(){var s=fs.value,c=fc.value,a=fa.value,n=0;document.querySelectorAll('details.finding').forEach(function(d){var ok=(!s||d.dataset.sev===s)&&(!c||d.dataset.cat===c)&&(!a||d.dataset.agents.split('|').indexOf(a)>=0);d.style.display=ok?'':'none';if(ok)n++;});cnt.textContent=n+' finding(s) shown';document.querySelectorAll('tr.arow').forEach(function(r){r.classList.toggle('hl',!!a&&r.dataset.agent===a);});}
[fs,fc,fa].forEach(function(e){e.addEventListener('change',apply);});
document.getElementById('ex').onclick=function(){document.querySelectorAll('details.finding').forEach(function(d){if(d.style.display!=='none')d.open=true;});};
document.getElementById('co').onclick=function(){document.querySelectorAll('details.finding').forEach(function(d){d.open=false;});};
function goAgent(name){fa.value=name;apply();var row=document.querySelector('tr.arow[data-agent="'+name.replace(/"/g,'\\\\"')+'"]');if(!row)return;var dr=row.nextElementSibling;var det=dr&&dr.querySelector('details');if(det){det.open=true;dr.scrollIntoView({behavior:'smooth',block:'center'});}}
document.querySelectorAll('.node').forEach(function(g){g.addEventListener('click',function(){goAgent(g.dataset.agent);});g.addEventListener('keydown',function(e){if(e.key==='Enter')goAgent(g.dataset.agent);});});
document.querySelectorAll('.alink').forEach(function(l){l.addEventListener('click',function(e){e.preventDefault();goAgent(l.closest('tr').dataset.agent);});});
function fallback(t){var ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e){}document.body.removeChild(ta);}
document.querySelectorAll('button.copy').forEach(function(b){b.onclick=function(){var t=b.previousElementSibling.textContent;function done(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy';},1200);}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,function(){fallback(t);done();});}else{fallback(t);done();}};});
apply();})();
</script></body></html>`;

  // ---- verification ----
  const v = [];
  if (/<(script|link|img|iframe)[^>]+(src|href)\s*=\s*["']?https?:/i.test(html)) v.push('external asset URL found');
  if ((html.match(/<details class="finding"/g) || []).length !== F.length) v.push('tile count != findings');
  if (SEVS.reduce((s, k) => s + counts[k], 0) !== F.length) v.push('KPI sum != findings');
  for (let i = 1; i <= 9; i++) if (!html.includes(`id="s${i}"`)) v.push(`section ${i} missing`);
  if (!html.includes('class="caveat"')) v.push('indicative-screening banner missing');
  if (!html.includes('<svg')) v.push('diagram missing');
  if (v.length) die('report verification failed: ' + v.join('; '));
  fs.mkdirSync(outDir, { recursive: true });
  const date = String(C.asOf).slice(0, 10);
  const out = path.join(outDir, `agent-config-audit-${C.scope.slug}-${date}.html`);
  fs.writeFileSync(out, html);
  const bytes = Buffer.byteLength(html);
  console.log(JSON.stringify({ out, bytes, uiRenderOk: bytes <= 512 * 1024, fingerprint: hash, counts, total: F.length, findings: F.map(f => `${f.id} ${PL[f.sev][0]} ${f.check} ${f.title}`), alwaysOn: Object.fromEntries(A.map(a => [a.name, a.alwaysOn])) }, null, 1));
}

const o = args(process.argv.slice(2));
if (o._[0] === 'collect') collect(o);
else if (o._[0] === 'render') render(o);
else { console.log('usage: node audit.js collect --home <TIMON_HOME> --work <dir> | render --work <dir> --out-dir <dir>'); process.exit(2); }
