#!/usr/bin/env bash
set -euo pipefail

if find . -path './node_modules' -prune -o -path './contracts/lib' -prune -o -type f -name '.env' -print | grep -q .; then
  echo "실제 .env 파일은 저장소 작업영역에 둘 수 없다. .env.example만 사용해야 한다." >&2
  exit 1
fi

if rg -n --hidden \
  --glob '!node_modules/**' \
  --glob '!contracts/lib/**' \
  --glob '!scripts/check-no-secrets.sh' \
  --glob '!.git/**' \
  '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|PRIVATE_KEY=[^[:space:]]+|MNEMONIC=[^[:space:]]+)' .; then
  echo "개인키 또는 니모닉으로 보이는 값이 발견됐다." >&2
  exit 1
fi

echo "secret hygiene check passed"
