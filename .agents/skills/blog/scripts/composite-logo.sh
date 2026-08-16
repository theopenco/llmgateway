#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
	echo "usage: $0 <background.png> <output.png> [logo.svg]" >&2
	exit 2
fi

for tool in rsvg-convert ffmpeg ffprobe; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "missing required tool: $tool" >&2
		exit 1
	fi
done

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../../../.." && pwd)
background=$1
output=$2
logo=${3:-"$repo_root/apps/ui/public/brand/logo-with-name-white.svg"}

if [ ! -f "$background" ]; then
	echo "background not found: $background" >&2
	exit 1
fi
if [ ! -f "$logo" ]; then
	echo "logo not found: $logo" >&2
	exit 1
fi

temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT

background_dimensions=$(ffprobe -v error -select_streams v:0 \
	-show_entries stream=width,height -of csv=s=x:p=0 "$background")
if [ "$background_dimensions" != "1536x1024" ]; then
	echo "unexpected background dimensions: $background_dimensions" >&2
	exit 1
fi

rsvg-convert -h 84 "$logo" -o "$temp_dir/logo.png"
ffmpeg -loglevel error -y -i "$background" -i "$temp_dir/logo.png" \
	-filter_complex "[0:v][1:v]overlay=72:72:format=auto" -frames:v 1 "$output"

dimensions=$(ffprobe -v error -select_streams v:0 \
	-show_entries stream=width,height -of csv=s=x:p=0 "$output")
if [ "$dimensions" != "1536x1024" ]; then
	echo "unexpected output dimensions: $dimensions" >&2
	exit 1
fi
