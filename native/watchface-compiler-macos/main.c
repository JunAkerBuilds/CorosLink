/* coros-watchface-compiler: compiles a final COROS watch face archive to a
 * device BIN with the user's own COROS compiler libraries, natively on Apple
 * Silicon. This replaces booting an Android emulator for every compile.
 *
 *   coros-watchface-compiler --libs DIR --input FACE.dat --output DIR --face-id N
 *   coros-watchface-compiler --libs DIR --probe
 *
 * One JSON line is written to stdout. Exit status: 0 success, 2 the face did
 * not compile, 3 the compiler libraries could not be loaded, 64 usage. */
#include "loader.h"
#include <errno.h>
#include <signal.h>
#include <sys/ucontext.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static int json_fd = 1;

static void json_string(const char *text) {
  dprintf(json_fd, "\"");
  for (const unsigned char *c = (const unsigned char *)text; *c; c++) {
    if (*c == '"' || *c == '\\') dprintf(json_fd, "\\%c", *c);
    else if (*c < 0x20) dprintf(json_fd, "\\u%04x", *c);
    else dprintf(json_fd, "%c", *c);
  }
  dprintf(json_fd, "\"");
}

static int finish(int status, const char *error) {
  dprintf(json_fd, "{\"ok\":false,\"error\":");
  json_string(error);
  dprintf(json_fd, "}\n");
  _exit(status);
}

static double now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}

/* COROS_COMPILER_DEBUG: report a crash as library offsets, walking frame pointers. */
static void crash_report(int signal, siginfo_t *info, void *context) {
  ucontext_t *uc = context;
  uint64_t pc = uc->uc_mcontext->__ss.__pc, lr = uc->uc_mcontext->__ss.__lr, fp = uc->uc_mcontext->__ss.__fp;
  char where[96];
  elf_describe(pc, where, sizeof where);
  dprintf(2, "coros-watchface-compiler: signal %d at %s (fault address %p)\n", signal, where, info->si_addr);
  elf_describe(lr, where, sizeof where);
  dprintf(2, "  lr %s\n", where);
  for (int depth = 0; fp && depth < 24; depth++) {
    uint64_t *frame = (uint64_t *)fp;
    elf_describe(frame[1], where, sizeof where);
    dprintf(2, "  #%d %s\n", depth, where);
    if (frame[0] <= fp) break;
    fp = frame[0];
  }
  _exit(128 + signal);
}

typedef void *(*operator_new_fn)(unsigned long);
typedef void (*constructor_fn)(void *);
typedef uint64_t (*parse_fn)(void *, const char *, const char *);
typedef uint64_t (*export_bin_fn)(void *, const char *, const char *, unsigned, int, int, int);

int main(int argc, char **argv) {
  const char *libs = NULL, *input = NULL, *output = NULL, *layout = "watchface_416x416";
  unsigned long face_id = 0;
  int probe = 0;
  for (int i = 1; i < argc; i++) {
    const char *value = i + 1 < argc ? argv[i + 1] : NULL;
    if (strcmp(argv[i], "--probe") == 0) probe = 1;
    else if (value && strcmp(argv[i], "--libs") == 0) libs = argv[++i];
    else if (value && strcmp(argv[i], "--input") == 0) input = argv[++i];
    else if (value && strcmp(argv[i], "--output") == 0) output = argv[++i];
    else if (value && strcmp(argv[i], "--layout") == 0) layout = argv[++i];
    else if (value && strcmp(argv[i], "--face-id") == 0) face_id = strtoul(argv[++i], NULL, 10);
    else finish(64, "Unknown argument.");
  }
  if (!libs || (!probe && (!input || !output || face_id == 0 || face_id > UINT32_MAX))) finish(64, "Missing arguments.");
  if (strchr(layout, '/') || strlen(layout) > 64) finish(64, "Invalid layout name.");

  /* Keep stdout for the JSON result; the libraries' own output goes to stderr. */
  if (getenv("COROS_COMPILER_DEBUG")) {
    struct sigaction action = { 0 };
    action.sa_sigaction = crash_report;
    action.sa_flags = SA_SIGINFO;
    sigaction(SIGSEGV, &action, NULL);
    sigaction(SIGBUS, &action, NULL);
    sigaction(SIGABRT, &action, NULL);
  }
  json_fd = dup(1);
  dup2(2, 1);
  bionic_init();

  double started = now_ms();
  static const char *names[] = { "libc++_shared.so", "libprotobuf.so", "libw4-watchface.so" };
  elf_lib *loaded[3];
  char path[PATH_MAX], error[600];
  for (int i = 0; i < 3; i++) {
    snprintf(path, sizeof path, "%s/%s", libs, names[i]);
    loaded[i] = elf_load(path, error, sizeof error);
    if (!loaded[i]) finish(3, error);
  }
  for (int i = 0; i < 3; i++) elf_init(loaded[i]);
  operator_new_fn operator_new = (operator_new_fn)elf_symbol(loaded[0], "_Znwm");
  constructor_fn construct = (constructor_fn)elf_symbol(loaded[2], "_ZN9watchface16WFTemplateParserC1Ev");
  parse_fn parse = (parse_fn)elf_symbol(loaded[2], "_ZN9watchface16WFTemplateParser5ParseEPKcS2_");
  export_bin_fn export_bin = (export_bin_fn)elf_symbol(loaded[2], "_ZN9watchface16WFTemplateParser9ExportBinEPKcS2_jiii");
  if (!operator_new || !construct || !parse || !export_bin) finish(3, "The COROS compiler library does not export the expected parser.");
  double loaded_at = now_ms();
  if (probe) {
    dprintf(json_fd, "{\"ok\":true,\"loadMs\":%.0f}\n", loaded_at - started);
    _exit(0);
  }

  /* WFTemplateParser is 0x48 bytes, as nativeCreate allocates it. */
  void *parser = operator_new(0x48);
  construct(parser);
  if (!(parse(parser, input, output) & 0xff)) finish(2, "The COROS compiler could not read this watch face.");
  char bin[PATH_MAX];
  snprintf(bin, sizeof bin, "%s/%s.bin", output, layout);
  /* Same export as the COROS app's nativeExportBin(layout, bin, id, 0, -1, 1). */
  if (!(export_bin(parser, layout, bin, (unsigned)face_id, 0, -1, 1) & 0xff)) finish(2, "The COROS compiler could not export this watch face.");
  struct stat st;
  if (stat(bin, &st) != 0 || !S_ISREG(st.st_mode)) finish(2, "The COROS compiler did not produce a BIN.");
  double done = now_ms();
  dprintf(json_fd, "{\"ok\":true,\"bytes\":%lld,\"loadMs\":%.0f,\"compileMs\":%.0f}\n", (long long)st.st_size,
    loaded_at - started, done - loaded_at);
  /* Skip static destructors: the libraries never registered any with us. */
  _exit(0);
}
