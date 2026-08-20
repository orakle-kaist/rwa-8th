#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

git diff --check
python3 scripts/validate_design.py
npx --yes @redocly/cli@2.46.1 lint specs/openapi.yaml
SUPPRESS_NO_CONFIG_WARNING=true npx --yes @asyncapi/cli@6.0.2 validate specs/asyncapi.yaml
npx --yes gherkin-lint@4.2.4 specs/bdd/*.feature

research_validator="${RWA_RESEARCH_VALIDATOR:-${HOME}/.codex/skills/rwa-institutional-research/scripts/validate_research.py}"
if [[ -f "$research_validator" ]]; then
  python3 "$research_validator" research/korean-equity-rwa
  python3 "$research_validator" research/korean-equity-rwa --candidate
else
  printf '%s\n' "warning: RWA research validator not found; set RWA_RESEARCH_VALIDATOR to enable it"
fi

printf '%s\n' "ok: all available design validations passed"
