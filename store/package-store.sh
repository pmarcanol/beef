#!/bin/sh
set -eu

extension_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
version=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$extension_root/manifest.json" | head -n 1)
output_dir="$extension_root/dist"
output_file="$output_dir/beef-$version.zip"

mkdir -p "$output_dir"
rm -f "$output_file"
cd "$extension_root"
zip -qr "$output_file" \
	manifest.json background.js content.js privacy.html \
	assets/icons lib popup review sidepanel
unzip -tq "$output_file"
printf '%s\n' "$output_file"
