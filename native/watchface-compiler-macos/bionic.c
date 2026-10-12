/* bionic libc for the COROS compiler libraries, implemented on macOS libc.
 *
 * Most functions are ABI-identical on Apple arm64 and are bound directly.
 * The rest differ in one of these ways and are bridged here:
 *  - variadic calls: AAPCS64 passes variadic arguments in registers and
 *    va_list is a 32-byte struct; Apple passes them on the stack (va.S);
 *  - long double is IEEE binary128 on Android and double on macOS;
 *  - struct stat/dirent/statvfs and pthread object layouts;
 *  - O_*, AT_*, CLOCK_*, LC_*, _SC_* and _PC_* constants;
 *  - bionic-only entry points (__sF, __errno, FORTIFY *_chk, liblog). */
#include "loader.h"
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <locale.h>
#include <math.h>
#include <pthread.h>
#include <sched.h>
#include <setjmp.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <time.h>
#include <unistd.h>
#include <wchar.h>
#include <wctype.h>
#include <xlocale.h>

_Static_assert(sizeof(va_list) == sizeof(char *), "Apple arm64 va_list is a pointer to 8-byte slots");

/* ---- AAPCS64 va_list ---------------------------------------------------- */

typedef struct { char *stack, *gr_top, *vr_top; int32_t gr_offs, vr_offs; } aapcs_va;

static uint64_t va_gp(aapcs_va *va) {
  uint64_t value;
  if (va->gr_offs < 0) { memcpy(&value, va->gr_top + va->gr_offs, 8); va->gr_offs += 8; }
  else { memcpy(&value, va->stack, 8); va->stack += 8; }
  return value;
}

static double va_fp(aapcs_va *va) {
  double value;
  if (va->vr_offs < 0) { memcpy(&value, va->vr_top + va->vr_offs, 8); va->vr_offs += 16; }
  else { memcpy(&value, va->stack, 8); va->stack += 8; }
  return value;
}

static double quad_to_double(const void *quad) {
  uint64_t lo, hi;
  memcpy(&lo, quad, 8);
  memcpy(&hi, (const char *)quad + 8, 8);
  int exponent = (int)((hi >> 48) & 0x7fff);
  uint64_t mantissa = ((hi & 0xffffffffffffULL) << 4) | (lo >> 60), bits;
  if (exponent == 0x7fff) bits = (0x7ffULL << 52) | (mantissa ? mantissa | (1ULL << 51) : 0);
  else if (exponent == 0) bits = 0;
  else {
    int scaled = exponent - 16383 + 1023;
    bits = scaled >= 0x7ff ? 0x7ffULL << 52 : scaled <= 0 ? 0 : ((uint64_t)scaled << 52) | mantissa;
  }
  bits |= hi & (1ULL << 63);
  double value;
  memcpy(&value, &bits, 8);
  return value;
}

static void double_to_quad(double value, void *quad) {
  uint64_t bits, hi, lo;
  memcpy(&bits, &value, 8);
  int exponent = (int)((bits >> 52) & 0x7ff);
  uint64_t fraction = bits & ((1ULL << 52) - 1);
  if (exponent == 0x7ff) { hi = (0x7fffULL << 48) | (fraction >> 4); lo = fraction << 60; }
  else if (exponent == 0 && fraction == 0) { hi = 0; lo = 0; }
  else {
    int64_t scaled = exponent - 1023 + 16383;
    if (exponent == 0) {
      int top = 63 - __builtin_clzll(fraction);
      fraction = (fraction << (52 - top)) & ((1ULL << 52) - 1);
      scaled = top - 1074 + 16383;
    }
    hi = ((uint64_t)scaled << 48) | (fraction >> 4);
    lo = fraction << 60;
  }
  hi |= bits & (1ULL << 63);
  memcpy(quad, &lo, 8);
  memcpy((char *)quad + 8, &hi, 8);
}

static double va_quad(aapcs_va *va) {
  const char *slot;
  if (va->vr_offs < 0) { slot = va->vr_top + va->vr_offs; va->vr_offs += 16; }
  else {
    va->stack = (char *)(((uintptr_t)va->stack + 15) & ~(uintptr_t)15);
    slot = va->stack;
    va->stack += 16;
  }
  return quad_to_double(slot);
}

/* An Android long double, returned in q0 like AAPCS64 expects. */
typedef uint64_t bionic_long_double __attribute__((vector_size(16)));
static bionic_long_double long_double_of(double value) {
  bionic_long_double result;
  double_to_quad(value, &result);
  return result;
}

#define MAX_VA 96
static int in_set(const char *set, uint32_t c) { return c && c < 128 && strchr(set, (int)c); }

/* Moves the arguments named by a printf format into Apple's 8-byte slots. */
static int printf_slots(const void *format, int wide, aapcs_va *va, uint64_t *slot) {
#define CH(k) (wide ? (uint32_t)((const int32_t *)format)[k] : (uint32_t)((const unsigned char *)format)[k])
  int count = 0;
  size_t i = 0;
  while (CH(i)) {
    if (CH(i++) != '%') continue;
    if (CH(i) == '%') { i++; continue; }
    while (in_set("-+ #0'", CH(i))) i++;
    if (CH(i) == '*') { slot[count++] = va_gp(va); i++; }
    else while (CH(i) >= '0' && CH(i) <= '9') i++;
    if (CH(i) == '.') {
      i++;
      if (CH(i) == '*') { slot[count++] = va_gp(va); i++; }
      else while (CH(i) >= '0' && CH(i) <= '9') i++;
    }
    int long_double = 0;
    while (in_set("hlLqjzt", CH(i))) long_double |= CH(i++) == 'L';
    uint32_t conversion = CH(i);
    if (!conversion) break;
    i++;
    if (in_set("diouxXcCpsSn", conversion)) slot[count++] = va_gp(va);
    else if (in_set("eEfFgGaA", conversion)) {
      double value = long_double ? va_quad(va) : va_fp(va);
      memcpy(&slot[count++], &value, 8);
    }
    if (count > MAX_VA - 2) return -1;
  }
  return count;
#undef CH
}

static int format_va(char *buffer, size_t size, const char *format, aapcs_va *va) {
  uint64_t slot[MAX_VA] = {0};
  if (printf_slots(format, 0, va, slot) < 0) { errno = EINVAL; return -1; }
  return vsnprintf(buffer, size, format, (va_list)(char *)slot);
}

int bionic_vsnprintf(char *buffer, size_t size, const char *format, aapcs_va *va) {
  return format_va(buffer, size, format, va);
}
int bionic_snprintf_va(char *buffer, size_t size, const char *format, aapcs_va *va) {
  return format_va(buffer, size, format, va);
}
static int bionic_vsnprintf_chk(char *buffer, size_t size, int flags, size_t capacity, const char *format, aapcs_va *va) {
  (void)flags;
  if (size > capacity) abort();
  return format_va(buffer, size, format, va);
}
static int bionic_vsprintf_chk(char *buffer, int flags, size_t capacity, const char *format, aapcs_va *va) {
  (void)flags;
  return format_va(buffer, capacity > INT32_MAX ? INT32_MAX : capacity, format, va);
}
static int bionic_vasprintf(char **result, const char *format, aapcs_va *va) {
  uint64_t slot[MAX_VA] = {0};
  if (printf_slots(format, 0, va, slot) < 0) { errno = EINVAL; return -1; }
  return vasprintf(result, format, (va_list)(char *)slot);
}
int bionic_swprintf_va(wchar_t *buffer, size_t size, const wchar_t *format, aapcs_va *va) {
  uint64_t slot[MAX_VA] = {0};
  if (printf_slots(format, 1, va, slot) < 0) { errno = EINVAL; return -1; }
  return vswprintf(buffer, size, format, (va_list)(char *)slot);
}

/* ---- stdio -------------------------------------------------------------- */

/* bionic's FILE __sF[3]; stderr is __sF + 0x130 (sizeof(FILE) == 152). */
static char bionic_sF[3 * 152] __attribute__((aligned(16)));
static FILE *bionic_stderr;

static FILE *F(void *stream) {
  uintptr_t address = (uintptr_t)stream, first = (uintptr_t)bionic_sF;
  if (address >= first && address < first + sizeof bionic_sF) {
    size_t index = (address - first) / 152;
    return index == 0 ? stdin : index == 1 ? stdout : stderr;
  }
  return stream;
}

int bionic_fprintf_va(void *stream, const char *format, aapcs_va *va) {
  uint64_t slot[MAX_VA] = {0};
  if (printf_slots(format, 0, va, slot) < 0) { errno = EINVAL; return -1; }
  return vfprintf(F(stream), format, (va_list)(char *)slot);
}
static int bionic_vfprintf(void *stream, const char *format, aapcs_va *va) { return bionic_fprintf_va(stream, format, va); }
int bionic_printf_va(const char *format, aapcs_va *va) { return bionic_fprintf_va(stdout, format, va); }
int bionic_syslog_va(int priority, const char *format, aapcs_va *va) {
  char line[1024];
  format_va(line, sizeof line, format, va);
  fprintf(stderr, "[syslog %d] %s\n", priority & 7, line);
  return 0;
}
static void bionic_openlog(const char *ident, int option, int facility) { (void)ident; (void)option; (void)facility; }
static void bionic_closelog(void) {}

static int scanf_va(const char *input, const char *format, aapcs_va *va) {
  uint64_t slot[MAX_VA] = {0};
  void *quad_target[MAX_VA] = {0};
  double quad_value[MAX_VA];
  int count = 0;
  for (size_t i = 0; format[i];) {
    if (format[i++] != '%') continue;
    if (format[i] == '%') { i++; continue; }
    int suppress = format[i] == '*';
    if (suppress) i++;
    while (isdigit((unsigned char)format[i])) i++;
    if (format[i] == '$') { errno = EINVAL; return -1; }
    int long_double = 0;
    while (in_set("hlLqjztm", (unsigned char)format[i])) long_double |= format[i++] == 'L';
    char conversion = format[i];
    if (!conversion) break;
    i++;
    if (conversion == '[') {
      if (format[i] == '^') i++;
      if (format[i] == ']') i++;
      while (format[i] && format[i] != ']') i++;
      if (format[i]) i++;
    }
    if (suppress) continue;
    void *target = (void *)va_gp(va);
    if (long_double && in_set("eEfFgGaA", (unsigned char)conversion)) {
      quad_target[count] = target;
      quad_value[count] = quad_to_double(target);
      target = &quad_value[count];
    }
    slot[count++] = (uint64_t)target;
    if (count > MAX_VA - 2) { errno = EINVAL; return -1; }
  }
  int result = vsscanf(input, format, (va_list)(char *)slot);
  for (int i = 0; i < count; i++)
    if (quad_target[i]) double_to_quad(quad_value[i], quad_target[i]);
  return result;
}
int bionic_sscanf_va(const char *input, const char *format, aapcs_va *va) { return scanf_va(input, format, va); }
static int bionic_vsscanf(const char *input, const char *format, aapcs_va *va) { return scanf_va(input, format, va); }

static FILE *bionic_fopen(const char *path, const char *mode) {
  char host[16];
  size_t used = 0;
  for (const char *m = mode; *m && used + 1 < sizeof host; m++)
    if (*m != 'e') host[used++] = *m;
  host[used] = 0;
  FILE *file = fopen(path, host);
  if (file && strchr(mode, 'e')) fcntl(fileno(file), F_SETFD, FD_CLOEXEC);
  return file;
}
static void bionic_clearerr(void *f) { clearerr(F(f)); }
static int bionic_fclose(void *f) { return fclose(F(f)); }
static int bionic_ferror(void *f) { return ferror(F(f)); }
static int bionic_fflush(void *f) { return fflush(f ? F(f) : NULL); }
static int bionic_fileno(void *f) { return fileno(F(f)); }
static int bionic_fputc(int c, void *f) { return fputc(c, F(f)); }
static int bionic_fputs(const char *s, void *f) { return fputs(s, F(f)); }
static wint_t bionic_fputwc(wchar_t c, void *f) { return fputwc(c, F(f)); }
static size_t bionic_fread(void *p, size_t s, size_t n, void *f) { return fread(p, s, n, F(f)); }
static int bionic_fseek(void *f, long o, int w) { return fseek(F(f), o, w); }
static int bionic_fseeko(void *f, off_t o, int w) { return fseeko(F(f), o, w); }
static long bionic_ftell(void *f) { return ftell(F(f)); }
static off_t bionic_ftello(void *f) { return ftello(F(f)); }
static size_t bionic_fwrite(const void *p, size_t s, size_t n, void *f) { return fwrite(p, s, n, F(f)); }
static size_t bionic_fwrite_chk(const void *p, size_t s, size_t n, void *f, size_t capacity) {
  (void)capacity;
  return fwrite(p, s, n, F(f));
}
static int bionic_getc(void *f) { return getc(F(f)); }
static wint_t bionic_getwc(void *f) { return getwc(F(f)); }
static int bionic_ungetc(int c, void *f) { return ungetc(c, F(f)); }
static wint_t bionic_ungetwc(wint_t c, void *f) { return ungetwc(c, F(f)); }

/* ---- FORTIFY and bionic internals -------------------------------------- */

/* The compiler leaves unused palette slots uninitialized; zeroed allocations
 * make every BIN reproducible from its source (and compress them better). */
static void *bionic_malloc(size_t size) { return calloc(1, size); }

static void *bionic_memcpy_chk(void *d, const void *s, size_t n, size_t capacity) {
  if (n > capacity) abort();
  return memcpy(d, s, n);
}
static ssize_t bionic_read_chk(int fd, void *p, size_t n, size_t capacity) { (void)capacity; return read(fd, p, n); }
static ssize_t bionic_write_chk(int fd, const void *p, size_t n, size_t capacity) { (void)capacity; return write(fd, p, n); }
static size_t bionic_strlen_chk(const char *s, size_t capacity) { (void)capacity; return strlen(s); }
static void bionic_stack_chk_fail(void) {
  fputs("coros-watchface-compiler: stack corruption detected\n", stderr);
  abort();
}
static void bionic_assert2(const char *file, int line, const char *function, const char *message) {
  fprintf(stderr, "coros-watchface-compiler: assertion %s failed in %s (%s:%d)\n", message, function, file, line);
  abort();
}
static void bionic_set_abort_message(const char *message) { fprintf(stderr, "coros-watchface-compiler: %s\n", message); }
static int bionic_log_write(int priority, const char *tag, const char *text) {
  static int verbose = -1;
  if (verbose < 0) verbose = getenv("COROS_COMPILER_VERBOSE") != NULL;
  if (verbose || priority >= 5) fprintf(stderr, "[%s] %s\n", tag ? tag : "w4", text ? text : "");
  return 1;
}
static int bionic_system_property_get(const char *name, char *value) { (void)name; value[0] = 0; return 0; }
static unsigned long bionic_getauxval(unsigned long type) { (void)type; return 0; }
static int bionic_cxa_atexit(void (*f)(void *), void *a, void *d) { (void)f; (void)a; (void)d; return 0; }
static void bionic_cxa_finalize(void *d) { (void)d; }
static int bionic_cxa_thread_atexit_impl(void (*f)(void *), void *a, void *d) { (void)f; (void)a; (void)d; return 0; }
static int bionic_register_atfork(void (*a)(void), void (*b)(void), void (*c)(void), void *d) {
  (void)a; (void)b; (void)c; (void)d;
  return 0;
}
static size_t bionic_mb_cur_max(void) { return MB_CUR_MAX; }

/* ---- files and directories --------------------------------------------- */

typedef struct {
  uint64_t dev, ino;
  uint32_t mode, nlink, uid, gid;
  uint64_t rdev, pad1;
  int64_t size;
  int32_t blksize, pad2;
  int64_t blocks;
  struct timespec atim, mtim, ctim;
  uint32_t unused[2];
} bionic_stat;
_Static_assert(sizeof(bionic_stat) == 128, "bionic arm64 struct stat");

static int to_bionic_stat(int result, const struct stat *s, bionic_stat *b) {
  if (result != 0) return result;
  memset(b, 0, sizeof *b);
  b->dev = (uint64_t)s->st_dev;
  b->ino = s->st_ino;
  b->mode = s->st_mode;
  b->nlink = s->st_nlink;
  b->uid = s->st_uid;
  b->gid = s->st_gid;
  b->rdev = (uint64_t)s->st_rdev;
  b->size = s->st_size;
  b->blksize = s->st_blksize;
  b->blocks = s->st_blocks;
  b->atim = s->st_atimespec;
  b->mtim = s->st_mtimespec;
  b->ctim = s->st_ctimespec;
  return 0;
}
static int bionic_stat_(const char *p, bionic_stat *b) { struct stat s; return to_bionic_stat(stat(p, &s), &s, b); }
static int bionic_lstat(const char *p, bionic_stat *b) { struct stat s; return to_bionic_stat(lstat(p, &s), &s, b); }
static int bionic_fstat(int fd, bionic_stat *b) { struct stat s; return to_bionic_stat(fstat(fd, &s), &s, b); }

typedef struct {
  unsigned long bsize, frsize;
  uint64_t blocks, bfree, bavail, files, ffree, favail;
  unsigned long fsid, flag, namemax;
  uint32_t reserved[6];
} bionic_statvfs;
static int bionic_statvfs_(const char *path, bionic_statvfs *b) {
  struct statvfs s;
  if (statvfs(path, &s) != 0) return -1;
  memset(b, 0, sizeof *b);
  b->bsize = s.f_bsize; b->frsize = s.f_frsize; b->blocks = s.f_blocks; b->bfree = s.f_bfree; b->bavail = s.f_bavail;
  b->files = s.f_files; b->ffree = s.f_ffree; b->favail = s.f_favail; b->fsid = s.f_fsid; b->flag = s.f_flag;
  b->namemax = s.f_namemax;
  return 0;
}

static int open_flags(int linux_flags) {
  int flags = linux_flags & O_ACCMODE;
  if (linux_flags & 0x40) flags |= O_CREAT;
  if (linux_flags & 0x80) flags |= O_EXCL;
  if (linux_flags & 0x100) flags |= O_NOCTTY;
  if (linux_flags & 0x200) flags |= O_TRUNC;
  if (linux_flags & 0x400) flags |= O_APPEND;
  if (linux_flags & 0x800) flags |= O_NONBLOCK;
  if (linux_flags & 0x1000) flags |= O_DSYNC;
  if (linux_flags & 0x4000) flags |= O_DIRECTORY;
  if (linux_flags & 0x8000) flags |= O_NOFOLLOW;
  if (linux_flags & 0x80000) flags |= O_CLOEXEC;
  if ((linux_flags & 0x101000) == 0x101000) flags |= O_SYNC;
  return flags;
}
static int at_fd(int fd) { return fd == -100 ? AT_FDCWD : fd; }
static int at_flags(int linux_flags) {
  return (linux_flags & 0x100 ? AT_SYMLINK_NOFOLLOW : 0) | (linux_flags & 0x200 ? AT_REMOVEDIR : 0) |
    (linux_flags & 0x400 ? AT_SYMLINK_FOLLOW : 0);
}
/* Variadic mode arrives in a register under AAPCS64, so a fixed parameter reads it. */
static int bionic_open(const char *p, int flags, unsigned mode) { return open(p, open_flags(flags), (mode_t)mode); }
static int bionic_openat(int fd, const char *p, int flags, unsigned mode) {
  return openat(at_fd(fd), p, open_flags(flags), (mode_t)mode);
}
static int bionic_unlinkat(int fd, const char *p, int flags) { return unlinkat(at_fd(fd), p, at_flags(flags)); }
static int bionic_fchmodat(int fd, const char *p, unsigned mode, int flags) {
  return fchmodat(at_fd(fd), p, (mode_t)mode, at_flags(flags));
}
static int bionic_utimensat(int fd, const char *p, const struct timespec times[2], int flags) {
  struct timespec host[2];
  if (times) {
    for (int i = 0; i < 2; i++) {
      host[i] = times[i];
      if (times[i].tv_nsec == (1L << 30) - 1) host[i].tv_nsec = UTIME_NOW;
      else if (times[i].tv_nsec == (1L << 30) - 2) host[i].tv_nsec = UTIME_OMIT;
    }
  }
  return utimensat(at_fd(fd), p, times ? host : NULL, at_flags(flags));
}
static int bionic_mkdir(const char *p, unsigned mode) { return mkdir(p, (mode_t)mode); }
static int bionic_fchmod(int fd, unsigned mode) { return fchmod(fd, (mode_t)mode); }

static ssize_t bionic_sendfile(int out, int in, off_t *offset, size_t count) {
  char buffer[65536];
  size_t done = 0;
  off_t position = offset ? *offset : 0;
  while (done < count) {
    size_t want = count - done < sizeof buffer ? count - done : sizeof buffer;
    ssize_t got = offset ? pread(in, buffer, want, position) : read(in, buffer, want);
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) break;
    for (ssize_t written = 0; written < got;) {
      ssize_t now = write(out, buffer + written, (size_t)(got - written));
      if (now < 0 && errno == EINTR) continue;
      if (now < 0) return done ? (ssize_t)done : -1;
      written += now;
    }
    done += (size_t)got;
    position += got;
  }
  if (offset) *offset = position;
  return (ssize_t)done;
}

typedef struct { uint64_t ino; int64_t off; uint16_t reclen; uint8_t type; char name[256]; } bionic_dirent;
typedef struct { DIR *dir; bionic_dirent entry; } bionic_dir;
static bionic_dir *wrap_dir(DIR *dir) {
  if (!dir) return NULL;
  bionic_dir *result = calloc(1, sizeof *result);
  if (!result) { closedir(dir); errno = ENOMEM; return NULL; }
  result->dir = dir;
  return result;
}
static bionic_dir *bionic_opendir(const char *p) { return wrap_dir(opendir(p)); }
static bionic_dir *bionic_fdopendir(int fd) { return wrap_dir(fdopendir(fd)); }
static bionic_dirent *bionic_readdir(bionic_dir *d) {
  struct dirent *e = readdir(d->dir);
  if (!e) return NULL;
  d->entry.ino = e->d_ino;
  d->entry.off = (int64_t)e->d_seekoff;
  d->entry.reclen = sizeof d->entry;
  d->entry.type = e->d_type;
  snprintf(d->entry.name, sizeof d->entry.name, "%s", e->d_name);
  return &d->entry;
}
static int bionic_closedir(bionic_dir *d) {
  int result = closedir(d->dir);
  free(d);
  return result;
}

/* ---- system constants --------------------------------------------------- */

static int bionic_clock_gettime(int clock, struct timespec *ts) {
  static const clockid_t clocks[] = { CLOCK_REALTIME, CLOCK_MONOTONIC, CLOCK_PROCESS_CPUTIME_ID,
    CLOCK_THREAD_CPUTIME_ID, CLOCK_MONOTONIC_RAW, CLOCK_REALTIME, CLOCK_MONOTONIC, CLOCK_MONOTONIC };
  if (clock < 0 || clock >= (int)(sizeof clocks / sizeof *clocks)) { errno = EINVAL; return -1; }
  return clock_gettime(clocks[clock], ts);
}
static long bionic_sysconf(int name) {
  switch (name) {
    case 0x00: return sysconf(_SC_ARG_MAX);
    case 0x06: return sysconf(_SC_CLK_TCK);
    case 0x0b: return sysconf(_SC_OPEN_MAX);
    case 0x27: case 0x28: return sysconf(_SC_PAGESIZE);
    case 0x60: return sysconf(_SC_NPROCESSORS_CONF);
    case 0x61: return sysconf(_SC_NPROCESSORS_ONLN);
    case 0x62: return sysconf(_SC_PHYS_PAGES);
  }
  errno = EINVAL;
  return -1;
}
static long bionic_pathconf(const char *path, int name) {
  static const int names[] = { _PC_FILESIZEBITS, _PC_LINK_MAX, _PC_MAX_CANON, _PC_MAX_INPUT, _PC_NAME_MAX,
    _PC_PATH_MAX, _PC_PIPE_BUF };
  if (name < 0 || name >= (int)(sizeof names / sizeof *names)) { errno = EINVAL; return -1; }
  return pathconf(path, names[name]);
}
static int bionic_ioctl(int fd, unsigned long request, void *argument) {
  (void)fd; (void)request; (void)argument;
  errno = ENOTTY;
  return -1;
}
static long bionic_syscall(long number, long a1, long a2, long a3) {
  switch (number) {
    case 98: { /* futex: a spurious wake-up is always allowed */
      int op = (int)a2 & 0x7f;
      if (op == 0 || op == 9) {
        if (atomic_load((_Atomic int *)a1) != (int)a3) { errno = EAGAIN; return -1; }
        struct timespec pause = { 0, 200000 };
        nanosleep(&pause, NULL);
        return 0;
      }
      if (op == 1 || op == 10) return 0;
      break;
    }
    case 178: { uint64_t id; pthread_threadid_np(NULL, &id); return (long)id; }
    case 278: arc4random_buf((void *)a1, (size_t)a2); return a2;
  }
  errno = ENOSYS;
  return -1;
}

/* ---- locale ------------------------------------------------------------- */

static int locale_category(int category) {
  switch (category) {
    case 0: return LC_CTYPE;
    case 1: return LC_NUMERIC;
    case 2: return LC_TIME;
    case 3: return LC_COLLATE;
    case 4: return LC_MONETARY;
    case 5: return LC_MESSAGES;
    case 6: return LC_ALL;
  }
  return -1;
}
static const char *host_locale_name(const char *name) {
  return name && (strcasecmp(name, "C.UTF-8") == 0 || strcasecmp(name, "C.utf8") == 0) ? "en_US.UTF-8" : name;
}
static char *bionic_setlocale(int category, const char *name) {
  int host = locale_category(category);
  if (host < 0) { errno = EINVAL; return NULL; }
  return setlocale(host, host_locale_name(name));
}
static locale_t bionic_newlocale(int mask, const char *name, locale_t base) {
  int host = (mask & 1 ? LC_CTYPE_MASK : 0) | (mask & 2 ? LC_NUMERIC_MASK : 0) | (mask & 4 ? LC_TIME_MASK : 0) |
    (mask & 8 ? LC_COLLATE_MASK : 0) | (mask & 16 ? LC_MONETARY_MASK : 0) | (mask & 32 ? LC_MESSAGES_MASK : 0);
  locale_t result = newlocale(host, host_locale_name(name), base);
  return result ? result : newlocale(host, "C", base);
}

/* bionic's mbstate_t is 8 bytes; macOS writes 128, so use a scratch state. */
static size_t bionic_mbrlen(const char *s, size_t n, void *ps) {
  mbstate_t state = {0};
  return mbrlen(s, n, ps ? &state : NULL);
}
static size_t bionic_mbrtowc(wchar_t *w, const char *s, size_t n, void *ps) {
  mbstate_t state = {0};
  return mbrtowc(w, s, n, ps ? &state : NULL);
}
static size_t bionic_mbsnrtowcs(wchar_t *d, const char **s, size_t n, size_t len, void *ps) {
  mbstate_t state = {0};
  return mbsnrtowcs(d, s, n, len, ps ? &state : NULL);
}
static size_t bionic_mbsrtowcs(wchar_t *d, const char **s, size_t len, void *ps) {
  mbstate_t state = {0};
  return mbsrtowcs(d, s, len, ps ? &state : NULL);
}
static size_t bionic_wcrtomb(char *s, wchar_t w, void *ps) {
  mbstate_t state = {0};
  return wcrtomb(s, w, ps ? &state : NULL);
}
static size_t bionic_wcsnrtombs(char *d, const wchar_t **s, size_t n, size_t len, void *ps) {
  mbstate_t state = {0};
  return wcsnrtombs(d, s, n, len, ps ? &state : NULL);
}
static bionic_long_double bionic_strtold(const char *s, char **end) { return long_double_of(strtod(s, end)); }
static bionic_long_double bionic_strtold_l(const char *s, char **end, locale_t l) { return long_double_of(strtod_l(s, end, l)); }
static bionic_long_double bionic_wcstold(const wchar_t *s, wchar_t **end) { return long_double_of(wcstod(s, end)); }

/* ---- pthreads ------------------------------------------------------------ */

/* bionic mutex/cond/rwlock objects are 40/48/56 bytes with 4-byte alignment.
 * A pointer to the host object lives in an aligned slot after the first
 * word, which keeps bionic's static initializer type bits readable. */
static _Atomic(void *) *host_slot(void *object) {
  return (_Atomic(void *) *)(((uintptr_t)object + 8 + 7) & ~(uintptr_t)7);
}
static void *install(void *object, void *created, void (*destroy)(void *)) {
  void *expected = NULL;
  if (atomic_compare_exchange_strong(host_slot(object), &expected, created)) return created;
  destroy(created);
  return expected;
}
static void free_mutex(void *m) { pthread_mutex_destroy(m); free(m); }
static void free_cond(void *c) { pthread_cond_destroy(c); free(c); }
static void free_rwlock(void *r) { pthread_rwlock_destroy(r); free(r); }

static pthread_mutex_t *new_mutex(int bionic_type) {
  pthread_mutex_t *mutex = malloc(sizeof *mutex);
  pthread_mutexattr_t attr;
  pthread_mutexattr_init(&attr);
  pthread_mutexattr_settype(&attr, bionic_type == 1 ? PTHREAD_MUTEX_RECURSIVE :
    bionic_type == 2 ? PTHREAD_MUTEX_ERRORCHECK : PTHREAD_MUTEX_NORMAL);
  pthread_mutex_init(mutex, &attr);
  pthread_mutexattr_destroy(&attr);
  return mutex;
}
static pthread_mutex_t *mutex_of(void *object) {
  void *host = atomic_load(host_slot(object));
  return host ? host : install(object, new_mutex((int)((*(uint32_t *)object >> 14) & 3)), free_mutex);
}
static pthread_cond_t *cond_of(void *object) {
  void *host = atomic_load(host_slot(object));
  if (host) return host;
  pthread_cond_t *cond = malloc(sizeof *cond);
  pthread_cond_init(cond, NULL);
  return install(object, cond, free_cond);
}
static pthread_rwlock_t *rwlock_of(void *object) {
  void *host = atomic_load(host_slot(object));
  if (host) return host;
  pthread_rwlock_t *lock = malloc(sizeof *lock);
  pthread_rwlock_init(lock, NULL);
  return install(object, lock, free_rwlock);
}

static int bionic_mutexattr_init(long *attr) { *attr = 0; return 0; }
static int bionic_mutexattr_settype(long *attr, int type) {
  if (type < 0 || type > 2) return EINVAL;
  *attr = type;
  return 0;
}
static int bionic_mutexattr_destroy(long *attr) { (void)attr; return 0; }
static int bionic_mutex_init(void *object, const long *attr) {
  atomic_store(host_slot(object), new_mutex(attr ? (int)(*attr & 3) : 0));
  return 0;
}
static int bionic_mutex_destroy(void *object) {
  void *host = atomic_exchange(host_slot(object), NULL);
  if (host) free_mutex(host);
  return 0;
}
static int bionic_mutex_lock(void *m) { return pthread_mutex_lock(mutex_of(m)); }
static int bionic_mutex_trylock(void *m) { return pthread_mutex_trylock(mutex_of(m)); }
static int bionic_mutex_unlock(void *m) { return pthread_mutex_unlock(mutex_of(m)); }
static int bionic_cond_broadcast(void *c) { return pthread_cond_broadcast(cond_of(c)); }
static int bionic_cond_signal(void *c) { return pthread_cond_signal(cond_of(c)); }
static int bionic_cond_wait(void *c, void *m) { return pthread_cond_wait(cond_of(c), mutex_of(m)); }
static int bionic_cond_timedwait(void *c, void *m, const struct timespec *t) {
  return pthread_cond_timedwait(cond_of(c), mutex_of(m), t);
}
static int bionic_cond_destroy(void *object) {
  void *host = atomic_exchange(host_slot(object), NULL);
  if (host) free_cond(host);
  return 0;
}
static int bionic_rwlock_rdlock(void *r) { return pthread_rwlock_rdlock(rwlock_of(r)); }
static int bionic_rwlock_wrlock(void *r) { return pthread_rwlock_wrlock(rwlock_of(r)); }
static int bionic_rwlock_unlock(void *r) { return pthread_rwlock_unlock(rwlock_of(r)); }

static int bionic_once(_Atomic int *once, void (*routine)(void)) {
  int state = 0;
  if (atomic_compare_exchange_strong(once, &state, 1)) {
    routine();
    atomic_store(once, 2);
  } else {
    while (atomic_load(once) != 2) sched_yield();
  }
  return 0;
}
static int bionic_key_create(int *key, void (*destructor)(void *)) {
  pthread_key_t host;
  int result = pthread_key_create(&host, destructor);
  if (result == 0) *key = (int)host;
  return result;
}
static int bionic_key_delete(int key) { return pthread_key_delete((pthread_key_t)key); }
static void *bionic_getspecific(int key) { return pthread_getspecific((pthread_key_t)key); }
static int bionic_setspecific(int key, const void *value) { return pthread_setspecific((pthread_key_t)key, value); }

/* ---- symbol table -------------------------------------------------------- */

int bionic_printf(const char *, ...);
int bionic_fprintf(void *, const char *, ...);
int bionic_snprintf(char *, size_t, const char *, ...);
int bionic_sscanf(const char *, const char *, ...);
int bionic_swprintf(wchar_t *, size_t, const wchar_t *, ...);
void bionic_syslog(int, const char *, ...);

typedef struct { const char *name; void *address; } shim;
#define S(name) { #name, (void *)name }
#define B(name, impl) { #name, (void *)impl }
static const shim shims[] = {
  /* bionic-specific */
  B(__android_log_write, bionic_log_write), B(__assert2, bionic_assert2),
  B(__ctype_get_mb_cur_max, bionic_mb_cur_max), B(__cxa_atexit, bionic_cxa_atexit),
  B(__cxa_finalize, bionic_cxa_finalize), B(__cxa_thread_atexit_impl, bionic_cxa_thread_atexit_impl),
  B(__errno, __error), B(__fwrite_chk, bionic_fwrite_chk), B(__memcpy_chk, bionic_memcpy_chk),
  B(__read_chk, bionic_read_chk), B(__register_atfork, bionic_register_atfork), B(__sF, bionic_sF),
  B(__stack_chk_fail, bionic_stack_chk_fail), B(__strlen_chk, bionic_strlen_chk),
  B(__system_property_get, bionic_system_property_get), B(__vsnprintf_chk, bionic_vsnprintf_chk),
  B(__vsprintf_chk, bionic_vsprintf_chk), B(__write_chk, bionic_write_chk),
  B(android_set_abort_message, bionic_set_abort_message), B(dl_iterate_phdr, elf_dl_iterate_phdr),
  B(getauxval, bionic_getauxval), B(stderr, &bionic_stderr),
  /* variadic and va_list */
  B(printf, bionic_printf), B(fprintf, bionic_fprintf), B(snprintf, bionic_snprintf), B(sscanf, bionic_sscanf),
  B(swprintf, bionic_swprintf), B(syslog, bionic_syslog), B(vasprintf, bionic_vasprintf),
  B(vfprintf, bionic_vfprintf), B(vsnprintf, bionic_vsnprintf), B(vsscanf, bionic_vsscanf),
  B(open, bionic_open), B(openat, bionic_openat), B(ioctl, bionic_ioctl), B(syscall, bionic_syscall),
  B(openlog, bionic_openlog), B(closelog, bionic_closelog),
  /* stdio */
  B(fopen, bionic_fopen), B(clearerr, bionic_clearerr), B(fclose, bionic_fclose), B(ferror, bionic_ferror),
  B(fflush, bionic_fflush), B(fileno, bionic_fileno), B(fputc, bionic_fputc), B(fputs, bionic_fputs),
  B(fputwc, bionic_fputwc), B(fread, bionic_fread), B(fseek, bionic_fseek), B(fseeko, bionic_fseeko),
  B(ftell, bionic_ftell), B(ftello, bionic_ftello), B(fwrite, bionic_fwrite), B(getc, bionic_getc),
  B(getwc, bionic_getwc), B(ungetc, bionic_ungetc), B(ungetwc, bionic_ungetwc), S(fdopen),
  /* files */
  B(stat, bionic_stat_), B(lstat, bionic_lstat), B(fstat, bionic_fstat), B(statvfs, bionic_statvfs_),
  B(unlinkat, bionic_unlinkat), B(fchmodat, bionic_fchmodat), B(utimensat, bionic_utimensat),
  B(mkdir, bionic_mkdir), B(fchmod, bionic_fchmod), B(sendfile, bionic_sendfile),
  B(opendir, bionic_opendir), B(fdopendir, bionic_fdopendir), B(readdir, bionic_readdir),
  B(closedir, bionic_closedir), S(chdir), S(close), S(ftruncate), S(getcwd), S(link), S(lseek), S(read),
  S(readlink), S(realpath), S(remove), S(rename), S(rmdir), S(symlink), S(truncate), S(unlink),
  /* system */
  B(clock_gettime, bionic_clock_gettime), B(sysconf, bionic_sysconf), B(pathconf, bionic_pathconf),
  S(abort), S(arc4random), S(arc4random_buf), S(getenv), S(getpid), S(nanosleep), S(time), S(gmtime),
  S(localtime), S(localtime_r), S(mktime), S(setjmp), S(longjmp),
  /* memory and strings */
  B(malloc, bionic_malloc), S(calloc), S(realloc), S(free), S(posix_memalign), S(memchr), S(memcmp), S(memcpy), S(memmove),
  S(memset), S(strcasecmp), S(strcat), S(strchr), S(strcmp), S(strcpy), S(strdup), S(strerror), S(strerror_r),
  S(strlen), S(strncmp), S(strncpy), S(strpbrk), S(strrchr), S(strstr), S(qsort), S(rand), S(srand),
  S(atof), S(strtod), S(strtof), S(strtol), S(strtoll), S(strtoul), S(strtoull), S(strtoll_l), S(strtoull_l),
  B(strtold, bionic_strtold), B(strtold_l, bionic_strtold_l), S(ldexp),
  /* locale and wide characters */
  B(setlocale, bionic_setlocale), B(newlocale, bionic_newlocale), S(uselocale), S(freelocale), S(localeconv),
  S(strcoll_l), S(strxfrm_l), S(strftime_l), S(wcscoll_l), S(wcsxfrm_l), S(iswalpha_l), S(iswblank_l),
  S(iswcntrl_l), S(iswdigit_l), S(iswlower_l), S(iswprint_l), S(iswpunct_l), S(iswspace_l), S(iswupper_l),
  S(iswxdigit_l), S(towlower_l), S(towupper_l), S(btowc), S(wctob), S(mbtowc), B(mbrlen, bionic_mbrlen),
  B(mbrtowc, bionic_mbrtowc), B(mbsnrtowcs, bionic_mbsnrtowcs), B(mbsrtowcs, bionic_mbsrtowcs),
  B(wcrtomb, bionic_wcrtomb), B(wcsnrtombs, bionic_wcsnrtombs), S(wcslen), S(wmemchr), S(wmemcmp),
  S(wcstod), S(wcstof), S(wcstol), S(wcstoll), S(wcstoul), S(wcstoull), B(wcstold, bionic_wcstold),
  /* pthreads */
  B(pthread_mutexattr_init, bionic_mutexattr_init), B(pthread_mutexattr_settype, bionic_mutexattr_settype),
  B(pthread_mutexattr_destroy, bionic_mutexattr_destroy), B(pthread_mutex_init, bionic_mutex_init),
  B(pthread_mutex_destroy, bionic_mutex_destroy), B(pthread_mutex_lock, bionic_mutex_lock),
  B(pthread_mutex_trylock, bionic_mutex_trylock), B(pthread_mutex_unlock, bionic_mutex_unlock),
  B(pthread_cond_broadcast, bionic_cond_broadcast), B(pthread_cond_signal, bionic_cond_signal),
  B(pthread_cond_wait, bionic_cond_wait), B(pthread_cond_timedwait, bionic_cond_timedwait),
  B(pthread_cond_destroy, bionic_cond_destroy), B(pthread_rwlock_rdlock, bionic_rwlock_rdlock),
  B(pthread_rwlock_wrlock, bionic_rwlock_wrlock), B(pthread_rwlock_unlock, bionic_rwlock_unlock),
  B(pthread_once, bionic_once), B(pthread_key_create, bionic_key_create), B(pthread_key_delete, bionic_key_delete),
  B(pthread_getspecific, bionic_getspecific), B(pthread_setspecific, bionic_setspecific), S(pthread_self),
  S(pthread_detach), S(pthread_join),
};

void *bionic_symbol(const char *name) {
  for (size_t i = 0; i < sizeof shims / sizeof *shims; i++)
    if (strcmp(shims[i].name, name) == 0) return shims[i].address;
  return NULL;
}

void bionic_init(void) { bionic_stderr = stderr; }
