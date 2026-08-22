#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH=$(git branch --show-current)
git fetch origin

BEHIND=$(git rev-list --count HEAD.."origin/$BRANCH")
if [ "$BEHIND" -eq 0 ]; then
  echo "✅ Já está atualizado ($BRANCH)"
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  Existem mudanças locais não commitadas. Abortando para não perder nada."
  echo "   Rode 'git stash' ou faça commit antes de atualizar."
  exit 1
fi

echo "⬇️  $BEHIND commit(s) atrás de origin/$BRANCH, atualizando..."
git pull --ff-only
npm ci
npm run build

echo "🎉 Atualizado para $(git rev-parse --short HEAD)"
