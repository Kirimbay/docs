#!/usr/bin/env bash
# Миграция с одного шведского сервера на мультистрановую схему
set -euo pipefail

NODE_ID="${1:-se-1}"

echo "1) Импорт пользователей с ноды $NODE_ID в центральный хаб..."
hiddify-hub import-from-node "$NODE_ID"

echo "2) Синхронизация всех пользователей на остальные ноды..."
hiddify-hub sync-all

echo "3) Проверка здоровья нод..."
hiddify-hub health

echo "Готово. Выдайте пользователям ссылку: \${PUBLIC_URL}/sub/{uuid}"
