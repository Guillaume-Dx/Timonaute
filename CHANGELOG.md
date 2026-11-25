# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org). The versions of each skill, role and agent model are in [`manifest.json`](manifest.json).

## [1.3.0] - 2026-11-25

### Added
- Skill `agent-config-consistency-audit` (2.2.0): audits the configuration consistency of an agent, a team, an orchestrator's tree or a project and produces an HTML report. Its findings are indicative signals to check, not verdicts.

## [1.2.0] - 2026-11-24

### Added
- Skill `audit-token-context-consumption` (4.0.0): audits where the tokens and context of a project go and produces an HTML report. Its analyses are leads to investigate, not a verdict.

## [1.1.0] - 2026-11-24

### Added
- Anti-loop rules in the `rules.md` of all 14 agent models: limit of 2 attempts, no active waiting, blocked-task handling, confirmation before costly work, rate-limit and duplicate-mission rules.

### Changed
- Agent models: all 14 move to 1.1.0. Skill and roles stay at 1.0.0.

## [1.0.0] - 2026-11-21

First versioned release.

### Added
- 14 agent models: Orchestrator, Coder, Reviewer, Merger, SystemArchitect, DataArchitect, Writer, Researcher, Troubleshooter, ThreatModeler, SecurityOfficer, ComplianceOfficer, DPO, DataOwner.
- 7 custom roles: `systemarchitect`, `dataarchitect`, `threatmodeler`, `securityofficer`, `complianceofficer`, `dpo`, `dataowner`.
- Skill `project-team-create`.
- MIT license.
