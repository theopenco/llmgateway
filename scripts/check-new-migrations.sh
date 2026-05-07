#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <base-ref> <head-ref>" >&2
  exit 1
fi

base_ref=$1
head_ref=$2

mapfile -t new_migrations < <(
  git diff --name-only --diff-filter=A "$base_ref" "$head_ref" -- 'packages/db/migrations/*.sql'
)

count=${#new_migrations[@]}

if (( count <= 1 )); then
  echo "Migration check passed: found $count new migration file(s)."
  exit 0
fi

echo "Migration check failed: found $count new migration files; at most 1 is allowed." >&2
printf 'New migrations:\n' >&2
printf ' - %s\n' "${new_migrations[@]}" >&2
exit 1
