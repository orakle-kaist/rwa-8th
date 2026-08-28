#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
research_topic="${repo_root}/research/korean-equity-rwa"
research_skill_home="${CODEX_HOME:-${HOME}/.codex}"
research_validator="${RWA_RESEARCH_VALIDATOR:-${research_skill_home}/skills/rwa-institutional-research/scripts/validate_research.py}"

# Team-provided source files are immutable and are verified by SHA-256 below.
# Exclude them from whitespace normalization checks so validation never rewrites originals.
git -C "${repo_root}" diff --check -- . ':(exclude)research/korean-equity-rwa/sources/user/**'
git -C "${repo_root}" diff --cached --check -- . ':(exclude)research/korean-equity-rwa/sources/user/**'
python3 "${repo_root}/scripts/validate_active_research.py"

# Run the optional skill validator when it is installed. The repository-owned
# validator remains authoritative so a developer's local Codex setup is not a
# required project dependency.
if [[ -f "${research_validator}" ]]; then
  python3 "${research_validator}" "${research_topic}"
  python3 "${research_validator}" --candidate "${research_topic}"
else
  echo "Optional RWA skill validator not installed; repository validation completed."
fi

echo "Research master validation passed."
