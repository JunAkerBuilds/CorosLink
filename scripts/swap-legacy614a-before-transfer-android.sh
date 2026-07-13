#!/system/bin/sh
# One-shot emulator test helper for COROS's custom-face compiler.
#
# The app compiles export.bin and immediately opens it for BLE transfer.  A
# CLOSE_WRITE watcher races too late.  On the *first* MODIFY notification we
# stop the whole app process, replace the pathname atomically, then resume it.
# The compiler continues writing to its now-unlinked compact-file descriptor;
# the later transfer open resolves to the verified legacy BIN at TARGET_FILE.
#
# Required environment:
#   TARGET_FILE   the app-private export.bin
#   PAYLOAD_FILE  verified 614A legacy BIN, 2,438,628 bytes
#   APP_PACKAGE   com.yf.smart.coros.dist
#
# Run with `inotifyd ... <template-dir>:m` and only on a rooted test emulator.

event="$1"
watched="$2"
entry="$3"

case "$event" in
  c|m) ;;
  *) exit 0 ;;
esac
[ -n "$TARGET_FILE" ] || exit 2
[ -n "$PAYLOAD_FILE" ] || exit 2
[ -n "$APP_PACKAGE" ] || exit 2

# A target-file watch has an empty third argument; retain directory-watch
# support for diagnostics, but reject unrelated directory entries.
if [ -n "$entry" ]; then
  [ "$entry" = "export.bin" ] || exit 0
else
  [ "$watched" = "$TARGET_FILE" ] || exit 0
fi

done_file="/data/local/tmp/coroslink-legacy-swap-complete"
[ -e "$done_file" ] && exit 0
[ -f "$TARGET_FILE" ] || exit 0
[ -f "$PAYLOAD_FILE" ] || exit 2

# Ignore our own legacy payload and wait for the compact compiler output.
size=$(stat -c '%s' "$TARGET_FILE" 2>/dev/null) || exit 0
[ "$size" -gt 0 ] && [ "$size" -lt 1000000 ] || exit 0

pids=$(pidof "$APP_PACKAGE")
[ -n "$pids" ] || exit 1
touch "$done_file"
kill -STOP $pids || exit 1

tmp="$TARGET_FILE.coroslink.$$"
rm -f "$tmp"
dd if="$PAYLOAD_FILE" of="$tmp" conv=fsync status=none || {
  rm -f "$tmp"
  kill -CONT $pids
  exit 1
}
mode=$(stat -c '%a' "$TARGET_FILE" 2>/dev/null) || mode=600
uid=$(stat -c '%u' "$TARGET_FILE" 2>/dev/null) || uid=10223
gid=$(stat -c '%g' "$TARGET_FILE" 2>/dev/null) || gid=10223
chmod "$mode" "$tmp" && chown "$uid:$gid" "$tmp" && mv -f "$tmp" "$TARGET_FILE" || {
  rm -f "$tmp"
  kill -CONT $pids
  exit 1
}

final_size=$(stat -c '%s' "$TARGET_FILE" 2>/dev/null) || final_size=0
echo "CorosLink early legacy BIN swap event=$event compact_size=$size final_size=$final_size pids=$pids" >&2
kill -CONT $pids
