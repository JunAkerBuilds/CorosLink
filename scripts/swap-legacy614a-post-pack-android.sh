#!/system/bin/sh
# Two-stage rooted-emulator helper for COROS watch-face transfer experiments.
#
# COROS first compiles a compact export.bin. A first replacement with a legacy
# raw BIN is then followed by a second in-place packing pass that rewrites its
# header identity and declared payload length. This script re-arms a fresh
# inode watch after that first replacement and replaces the path a second time
# once the packer closes it. The following transfer open therefore resolves to
# the unmodified raw BIN.
#
# Required environment:
#   TARGET_FILE   active app-private export.bin path
#   PAYLOAD_FILE  verified legacy 614A payload
#   APP_PACKAGE   com.yf.smart.coros.dist
#   SWAP_PHASE    1 for the compiler-close watcher, 2 for post-pack close

event="$1"
watched="$2"

[ "$event" = "c" ] || exit 0
[ "$watched" = "$TARGET_FILE" ] || exit 0
[ -n "$TARGET_FILE" ] || exit 2
[ -n "$PAYLOAD_FILE" ] || exit 2
[ -n "$APP_PACKAGE" ] || exit 2
[ -f "$TARGET_FILE" ] || exit 0
[ -f "$PAYLOAD_FILE" ] || exit 2

state_file="/data/local/tmp/coroslink-post-pack-swap-state"
done_file="/data/local/tmp/coroslink-post-pack-swap-complete"
log_file="/data/local/tmp/coroslink-post-pack-swap.log"
[ -e "$done_file" ] && exit 0

replace_target() {
  pids=$(pidof "$APP_PACKAGE")
  [ -n "$pids" ] || exit 1
  kill -STOP $pids || exit 1

  tmp="$TARGET_FILE.coroslink-post-pack.$$"
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
  echo "$pids $final_size"
}

case "${SWAP_PHASE:-1}" in
  1)
    [ -e "$state_file" ] && exit 0
    size=$(stat -c '%s' "$TARGET_FILE" 2>/dev/null) || exit 0
    [ "$size" -gt 0 ] && [ "$size" -lt 1000000 ] || exit 0
    result=$(replace_target) || exit $?
    touch "$state_file"
    SWAP_PHASE=2 TARGET_FILE="$TARGET_FILE" PAYLOAD_FILE="$PAYLOAD_FILE" APP_PACKAGE="$APP_PACKAGE" \
      nohup inotifyd "$0" "$TARGET_FILE:c" >>"$log_file" 2>&1 &
    echo "CorosLink post-pack swap phase=1 compact_size=$size final_size=${result#* }" >>"$log_file"
    kill -CONT ${result%% *}
    ;;
  2)
    [ -e "$state_file" ] || exit 0
    result=$(replace_target) || exit $?
    touch "$done_file"
    echo "CorosLink post-pack swap phase=2 final_size=${result#* }" >>"$log_file"
    kill -CONT ${result%% *}
    ;;
  *) exit 2 ;;
esac
