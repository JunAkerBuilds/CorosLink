#!/system/bin/sh
# inotifyd handler for one physical-device legacy-BIN test.
#
# Required environment:
#   TARGET_FILE  app-private export.bin that COROS recompiles before transfer
#   PAYLOAD_FILE verified legacy test BIN to put back after compilation
#
# Run via inotifyd against TARGET_FILE's parent directory. The handler only
# swaps a compact (< 1 MB) compiler result, so its own write does not recurse.

event="$1"
watched="$2"
entry="$3"

[ "$entry" = "export.bin" ] || exit 0
[ -n "$TARGET_FILE" ] || exit 2
[ -n "$PAYLOAD_FILE" ] || exit 2
[ -f "$TARGET_FILE" ] || exit 0
[ -f "$PAYLOAD_FILE" ] || exit 2

size=$(stat -c '%s' "$TARGET_FILE" 2>/dev/null) || exit 0
[ "$size" -lt 1000000 ] || exit 0

# `w` is IN_CLOSE_WRITE, so the native exporter has already closed its final
# descriptor. Do not add a delay here: the app opens the file for Bluetooth
# transfer immediately after the compiler returns.
size=$(stat -c '%s' "$TARGET_FILE" 2>/dev/null) || exit 0
[ "$size" -lt 1000000 ] || exit 0

# Build the large payload beside the destination, then rename it into place.
# Writing directly into export.bin leaves a short window where the app can open
# the path and read a partially-written legacy BIN.
tmp="$TARGET_FILE.coroslink.$$"
rm -f "$tmp"
dd if="$PAYLOAD_FILE" of="$tmp" conv=fsync status=none || { rm -f "$tmp"; exit 1; }
mode=$(stat -c '%a' "$TARGET_FILE" 2>/dev/null) || { rm -f "$tmp"; exit 1; }
uid=$(stat -c '%u' "$TARGET_FILE" 2>/dev/null) || { rm -f "$tmp"; exit 1; }
gid=$(stat -c '%g' "$TARGET_FILE" 2>/dev/null) || { rm -f "$tmp"; exit 1; }
chmod "$mode" "$tmp" || { rm -f "$tmp"; exit 1; }
chown "$uid:$gid" "$tmp" || { rm -f "$tmp"; exit 1; }
mv -f "$tmp" "$TARGET_FILE" || { rm -f "$tmp"; exit 1; }
final_size=$(stat -c '%s' "$TARGET_FILE" 2>/dev/null) || exit 1
[ "$final_size" -eq 2438628 ] || exit 1
echo "CorosLink legacy BIN atomically swapped after event=$event source_size=$size final_size=$final_size" >&2
