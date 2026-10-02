#!/usr/bin/env bash
# Malware-scans release files with ClamAV before they are published.
#
# ClamAV reports files over its size limits, archives past its file-count or
# nesting limits, and directories deeper than 15 levels as clean without
# scanning them, and an unpacked Electron app goes deeper than that. So this
# unpacks every installer (and the app.asar inside each app) itself, raises
# the limits, and turns anything still over them into a detection
# (--alert-exceeds-max) rather than a silent skip.
#
#   scripts/scan-release-artifacts.sh <release-dir>
#
# Needs bash 4+, clamscan with current signatures, unzip, 7z, unsquashfs, and
# node with this repo's npm dependencies installed (for @electron/asar). CI
# runs it on ubuntu-latest; see .github/workflows/release.yml.
set -euo pipefail
shopt -s globstar nullglob

release_dir=$(realpath "${1:?usage: scan-release-artifacts.sh <release-dir>}")
repo_root=$(realpath "$(dirname "$0")/..")
work=$(mktemp -d)
trap 'chmod -R u+w "$work"; rm -rf "$work"' EXIT

clamscan_args=(
  --recursive
  --infected
  --alert-exceeds-max=yes
  --max-filesize=2000M
  --max-scansize=4000M
  --max-files=100000
  --max-recursion=40
  --max-dir-recursion=100
  --max-scantime=0
)
failures=()
unpacked=0

# Scans the given paths, recording a failure instead of stopping so that every
# installer gets a verdict.
scan() {
  local label=$1
  shift
  local status=0
  echo "::group::ClamAV: $label"
  clamscan "${clamscan_args[@]}" "$@" || status=$?
  echo "::endgroup::"
  case $status in
    0) echo "$label: clean" ;;
    1) failures+=("$label: flagged by ClamAV (Heuristics.Limits.Exceeded means a file could not be scanned in full)") ;;
    *) failures+=("$label: ClamAV could not finish the scan (exit $status)") ;;
  esac
}

clamscan --version

# The files as published. ClamAV opens the DMGs itself; the zips carry the same
# signed app and are unpacked below.
scan "release files" "$release_dir"

for installer in "$release_dir"/**/*.{zip,AppImage,exe}; do
  name=$(basename "$installer")
  destination="$work/$name"
  echo "Unpacking $name"

  case $installer in
    *.zip)
      unzip -q "$installer" -d "$destination"
      ;;
    *.AppImage)
      # An AppImage is an ELF runtime followed by a squashfs image. Unpack the
      # image at the end of the ELF section table instead of running the file.
      offset=$(node -e '
        const fs = require("node:fs");
        const header = Buffer.alloc(64);
        fs.readSync(fs.openSync(process.argv[1], "r"), header, 0, 64, 0);
        console.log(Number(header.readBigUInt64LE(0x28)) + header.readUInt16LE(0x3a) * header.readUInt16LE(0x3c));
      ' "$installer")
      unsquashfs -no-progress -no-xattrs -offset "$offset" -dest "$destination" "$installer" >/dev/null
      ;;
    *.exe)
      # 7-Zip opens the NSIS installer, which carries the app as a nested 7z.
      7z x -y -bso0 -bsp0 -o"$destination" "$installer"
      for payload in "$destination"/**/*.7z; do
        7z x -y -bso0 -bsp0 -o"${payload%.7z}" "$payload"
      done
      ;;
  esac

  # app.asar holds all of the app's JavaScript in a format ClamAV can't open.
  while IFS= read -r -d '' asar; do
    node -e 'require(process.argv[1]).extractAll(process.argv[2], process.argv[3])' \
      "$repo_root/node_modules/@electron/asar" "$asar" "$asar.contents"
  done < <(find "$destination" -name '*.asar' -type f -print0)

  scan "$name (unpacked)" "$destination"
  chmod -R u+w "$destination"
  rm -rf "$destination"
  unpacked=$((unpacked + 1))
done

if ((unpacked == 0)); then
  failures+=("no installers (.zip, .AppImage, .exe) found in $release_dir")
fi

if ((${#failures[@]} > 0)); then
  for failure in "${failures[@]}"; do
    echo "::error::$failure" >&2
  done
  exit 1
fi

echo "ClamAV found nothing in the release files or the $unpacked unpacked installers."
