#!/bin/bash
# Removes preinstalled runner toolchains the Docker builds never use. The
# deletions run in parallel because removing them one by one takes minutes.
set -euo pipefail

dirs=(
	/usr/share/dotnet
	/usr/local/lib/android
	/opt/ghc
	/opt/hostedtoolcache/CodeQL
)

pids=()
for dir in "${dirs[@]}"; do
	sudo rm -rf "$dir" &
	pids+=($!)
done

for pid in "${pids[@]}"; do
	wait "$pid"
done

df -h /
