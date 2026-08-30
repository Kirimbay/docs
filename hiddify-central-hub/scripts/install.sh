#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f config/servers.yaml ]]; then
  cp config/servers.example.yaml config/servers.yaml
  echo "Created config/servers.yaml — отредактируйте его перед запуском."
fi

python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e .

echo "Установка завершена. Команды:"
echo "  hiddify-hub health"
echo "  hiddify-hub serve"
