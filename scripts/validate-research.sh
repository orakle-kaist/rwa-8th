#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
research_topic="${repo_root}/research/korean-equity-rwa"
research_skill_home="${CODEX_HOME:-${HOME}/.codex}"
research_validator="${RWA_RESEARCH_VALIDATOR:-${research_skill_home}/skills/rwa-institutional-research/scripts/validate_research.py}"

if [[ ! -f "${research_validator}" ]]; then
  echo "RWA research validator not found: ${research_validator}" >&2
  echo "Set RWA_RESEARCH_VALIDATOR to the validator path." >&2
  exit 1
fi

git -C "${repo_root}" diff --check
git -C "${repo_root}" diff --cached --check
python3 "${repo_root}/scripts/validate_active_research.py"
python3 "${research_validator}" "${research_topic}"
python3 "${research_validator}" --candidate "${research_topic}"

echo "Research master validation passed."
