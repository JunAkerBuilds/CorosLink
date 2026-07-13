#!/bin/sh
# Capture overlapping snapshots of Android's rolling Bluetooth HCI log.
#
# Use this before an official COROS watch-face send. BTSnoop files roll before
# a complete transfer fits in one file; short-interval snapshots preserve the
# transfer-start records for later de-duplication.

set -eu

serial="${1:-emulator-5554}"
output_dir="${2:-/tmp/coros-hci-stream-$(date +%Y%m%d-%H%M%S)}"
interval_seconds="${CAPTURE_INTERVAL_SECONDS:-2}"
remote_path="/data/misc/bluetooth/logs/btsnoop_hci.log"

mkdir -p "$output_dir"
printf 'serial=%s\nremote_path=%s\ninterval_seconds=%s\nstarted_at=%s\n' \
  "$serial" "$remote_path" "$interval_seconds" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$output_dir/session.txt"

echo "Capturing local Bluetooth HCI snapshots to $output_dir"
echo "BTSnoop files can contain session material. Keep them local and inspect only with scripts/inspect-coros-btsnoop.mjs, which redacts payload contents."

index=0
while :; do
  index=$((index + 1))
  destination=$(printf '%s/snapshot-%06d.log' "$output_dir" "$index")
  adb -s "$serial" pull "$remote_path" "$destination" >/dev/null 2>&1 || rm -f "$destination"
  sleep "$interval_seconds"
done
