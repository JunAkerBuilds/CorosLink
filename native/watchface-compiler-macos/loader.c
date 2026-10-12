#include "loader.h"
#include <errno.h>
#include <fcntl.h>
#include <libkern/OSCacheControl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#define PAGE 0x4000ULL
#define TRUNC(x) ((x) & ~(PAGE - 1))
#define ROUND(x) TRUNC((x) + PAGE - 1)

typedef struct { unsigned char ident[16]; uint16_t type, machine; uint32_t version; uint64_t entry, phoff, shoff;
  uint32_t flags; uint16_t ehsize, phentsize, phnum, shentsize, shnum, shstrndx; } Ehdr;
typedef struct { uint32_t type, flags; uint64_t offset, vaddr, paddr, filesz, memsz, align; } Phdr;
typedef struct { int64_t tag; uint64_t val; } Dyn;
typedef struct { uint32_t name; unsigned char info, other; uint16_t shndx; uint64_t value, size; } Sym;
typedef struct { uint64_t offset, info; int64_t addend; } Rela;

enum { PT_LOAD = 1, PT_DYNAMIC = 2, PT_TLS = 7, PF_X = 1, PF_W = 2, PF_R = 4 };
enum { DT_NULL = 0, DT_NEEDED = 1, DT_PLTRELSZ = 2, DT_STRTAB = 5, DT_SYMTAB = 6, DT_RELA = 7, DT_RELASZ = 8,
  DT_INIT = 12, DT_SONAME = 14, DT_REL = 17, DT_PLTREL = 20, DT_TEXTREL = 22, DT_JMPREL = 23, DT_INIT_ARRAY = 25,
  DT_INIT_ARRAYSZ = 27, DT_RELR = 36, DT_ANDROID_REL = 0x6000000f, DT_ANDROID_RELA = 0x60000011 };
#define DT_GNU_HASH 0x6ffffef5
enum { R_AARCH64_NONE = 0, R_AARCH64_ABS64 = 257, R_AARCH64_GLOB_DAT = 1025, R_AARCH64_JUMP_SLOT = 1026,
  R_AARCH64_RELATIVE = 1027 };
enum { STB_LOCAL = 0, STB_GLOBAL = 1, STB_WEAK = 2, STT_TLS = 6, STT_GNU_IFUNC = 10 };

#define MAX_LIBS 8
#define MAX_NEEDED 16

struct elf_lib {
  char path[1024];
  const char *soname;
  uint8_t *base;
  size_t size;
  const Phdr *phdr;
  uint16_t phnum;
  const Sym *symtab;
  const char *strtab;
  const uint32_t *gnu_hash;
  const Rela *rela, *jmprel;
  size_t rela_count, jmprel_count;
  uint64_t init;
  const uint64_t *init_array;
  size_t init_count;
  const elf_lib *scope[MAX_LIBS];
  int scope_count;
  int initialized;
};

static elf_lib *loaded[MAX_LIBS];
static int loaded_count;

static void fail(char *error, size_t size, const char *format, ...) {
  va_list args;
  va_start(args, format);
  vsnprintf(error, size, format, args);
  va_end(args);
}

/* Reached through any unresolved strong import; the load reports the names. */
static void unresolved_import(void) {
  static const char message[] = "coros-watchface-compiler: called an unresolved Android import\n";
  write(2, message, sizeof message - 1);
  abort();
}

static uint32_t gnu_hash_name(const char *name) {
  uint32_t hash = 5381;
  for (const unsigned char *c = (const unsigned char *)name; *c; c++) hash = hash * 33 + *c;
  return hash;
}

static const Sym *lookup(const elf_lib *lib, const char *name) {
  const uint32_t *table = lib->gnu_hash;
  if (!table) return NULL;
  uint32_t buckets = table[0], offset = table[1], bloom_size = table[2], shift = table[3];
  const uint64_t *bloom = (const uint64_t *)(table + 4);
  const uint32_t *bucket = (const uint32_t *)(bloom + bloom_size), *chain = bucket + buckets;
  uint32_t hash = gnu_hash_name(name);
  uint64_t word = bloom[(hash / 64) % bloom_size], mask = (1ULL << (hash % 64)) | (1ULL << ((hash >> shift) % 64));
  if ((word & mask) != mask) return NULL;
  for (uint32_t index = bucket[hash % buckets]; index >= offset && index != 0; index++) {
    const Sym *sym = &lib->symtab[index];
    uint32_t entry = chain[index - offset];
    if ((hash | 1) == (entry | 1) && strcmp(name, lib->strtab + sym->name) == 0) {
      int bind = sym->info >> 4;
      if (sym->shndx != 0 && (bind == STB_GLOBAL || bind == STB_WEAK)) return sym;
    }
    if (entry & 1) break;
  }
  return NULL;
}

void *elf_symbol(const elf_lib *lib, const char *name) {
  const Sym *sym = lookup(lib, name);
  return sym ? lib->base + sym->value : NULL;
}

static uint64_t resolve(const elf_lib *lib, uint32_t index, char *missing, size_t missing_size) {
  const Sym *sym = &lib->symtab[index];
  const char *name = lib->strtab + sym->name;
  if (sym->shndx != 0 && (sym->info >> 4) == STB_LOCAL) return (uint64_t)(lib->base + sym->value);
  for (int i = 0; i < lib->scope_count; i++) {
    const Sym *found = lookup(lib->scope[i], name);
    if (!found) continue;
    int type = found->info & 15;
    if (type == STT_TLS || type == STT_GNU_IFUNC) {
      snprintf(missing, missing_size, "%s (unsupported symbol type)", name);
      return (uint64_t)unresolved_import;
    }
    return (uint64_t)(lib->scope[i]->base + found->value);
  }
  void *shim = bionic_symbol(name);
  if (shim) return (uint64_t)shim;
  if ((sym->info >> 4) == STB_WEAK) return 0;
  size_t used = strlen(missing);
  if (used + strlen(name) + 3 < missing_size) snprintf(missing + used, missing_size - used, "%s%s", used ? ", " : "", name);
  return (uint64_t)unresolved_import;
}

static int relocate(elf_lib *lib, const Rela *table, size_t count, char *missing, size_t missing_size) {
  for (size_t i = 0; i < count; i++) {
    const Rela *r = &table[i];
    uint32_t type = (uint32_t)r->info, index = (uint32_t)(r->info >> 32);
    if (r->offset + 8 > lib->size) return -1;
    uint64_t *where = (uint64_t *)(lib->base + r->offset);
    switch (type) {
      case R_AARCH64_NONE: break;
      case R_AARCH64_RELATIVE: *where = (uint64_t)lib->base + (uint64_t)r->addend; break;
      case R_AARCH64_ABS64:
      case R_AARCH64_GLOB_DAT:
      case R_AARCH64_JUMP_SLOT:
        *where = (index ? resolve(lib, index, missing, missing_size) : 0) + (uint64_t)r->addend;
        break;
      default: return (int)type;
    }
  }
  return 0;
}

/* Android keeps the stack-protector canary at [TPIDR_EL0 + 0x28]. XNU clears
 * TPIDR_EL0 on context switches, so each `mrs Xt, TPIDR_EL0` becomes an
 * `adrp Xt, canary_page` that points at a private page holding a canary. */
static size_t patch_tls_reads(uint8_t *code, size_t size, const uint8_t *canary_page) {
  size_t patched = 0;
  for (size_t offset = 0; offset + 4 <= size; offset += 4) {
    uint32_t *insn = (uint32_t *)(code + offset);
    if ((*insn & 0xffffffe0u) != 0xd53bd040u) continue;
    int64_t pages = (int64_t)((uint64_t)canary_page >> 12) - (int64_t)((uint64_t)insn >> 12);
    if (pages < -(1 << 20) || pages >= (1 << 20)) continue;
    *insn = 0x90000000u | ((uint32_t)(pages & 3) << 29) | ((uint32_t)((pages >> 2) & 0x7ffff) << 5) | (*insn & 31);
    patched++;
  }
  return patched;
}

static void add_scope(elf_lib *lib, const elf_lib *dependency) {
  for (int i = 0; i < lib->scope_count; i++)
    if (lib->scope[i] == dependency) return;
  if (lib->scope_count < MAX_LIBS) lib->scope[lib->scope_count++] = dependency;
}

static const char *basename_of(const char *path) {
  const char *slash = strrchr(path, '/');
  return slash ? slash + 1 : path;
}

elf_lib *elf_load(const char *path, char *error, size_t error_size) {
  if (loaded_count >= MAX_LIBS) { fail(error, error_size, "too many libraries"); return NULL; }
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) { fail(error, error_size, "cannot open %s: %s", basename_of(path), strerror(errno)); return NULL; }
  struct stat st;
  uint8_t *file = NULL;
  elf_lib *lib = NULL;
  if (fstat(fd, &st) != 0 || st.st_size < (off_t)sizeof(Ehdr) || st.st_size > 64 * 1024 * 1024) {
    fail(error, error_size, "%s has an unexpected size", basename_of(path));
    goto out;
  }
  file = malloc((size_t)st.st_size);
  if (!file || pread(fd, file, (size_t)st.st_size, 0) != st.st_size) {
    fail(error, error_size, "cannot read %s", basename_of(path));
    goto out;
  }
  const Ehdr *eh = (const Ehdr *)file;
  if (memcmp(eh->ident, "\177ELF", 4) != 0 || eh->ident[4] != 2 || eh->ident[5] != 1 || eh->type != 3 ||
      eh->machine != 183 || eh->phentsize != sizeof(Phdr) ||
      eh->phoff + (uint64_t)eh->phnum * sizeof(Phdr) > (uint64_t)st.st_size) {
    fail(error, error_size, "%s is not an Android arm64 shared library", basename_of(path));
    goto out;
  }
  const Phdr *ph = (const Phdr *)(file + eh->phoff);
  uint64_t end = 0;
  const Phdr *dynamic = NULL;
  for (int i = 0; i < eh->phnum; i++) {
    if (ph[i].type == PT_TLS) { fail(error, error_size, "%s uses ELF TLS", basename_of(path)); goto out; }
    if (ph[i].type == PT_DYNAMIC) dynamic = &ph[i];
    if (ph[i].type != PT_LOAD) continue;
    if (ph[i].offset + ph[i].filesz > (uint64_t)st.st_size || ph[i].filesz > ph[i].memsz ||
        (ph[i].vaddr - ph[i].offset) % PAGE != 0) {
      fail(error, error_size, "%s has an unsupported segment layout", basename_of(path));
      goto out;
    }
    if (ph[i].vaddr + ph[i].memsz > end) end = ph[i].vaddr + ph[i].memsz;
  }
  if (!dynamic || end == 0 || end > 256 * 1024 * 1024) {
    fail(error, error_size, "%s has no loadable dynamic image", basename_of(path));
    goto out;
  }

  lib = calloc(1, sizeof *lib);
  if (!lib) goto out;
  snprintf(lib->path, sizeof lib->path, "%s", path);
  lib->size = ROUND(end);
  uint8_t *base = mmap(NULL, lib->size + PAGE, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
  if (base == MAP_FAILED) { fail(error, error_size, "cannot map %s", basename_of(path)); free(lib); lib = NULL; goto out; }
  lib->base = base;
  uint8_t *canary_page = base + lib->size;
  arc4random_buf(canary_page + 0x28, 8);
  for (int i = 0; i < eh->phnum; i++)
    if (ph[i].type == PT_LOAD) memcpy(base + ph[i].vaddr, file + ph[i].offset, ph[i].filesz);
  lib->phdr = (const Phdr *)(base + eh->phoff);
  lib->phnum = eh->phnum;

  const char *needed[MAX_NEEDED];
  uint64_t needed_offsets[MAX_NEEDED], soname = 0, rela = 0, rela_size = 0, jmprel = 0, plt_size = 0;
  uint64_t init_array = 0, init_array_size = 0;
  int needed_count = 0;
  for (const Dyn *d = (const Dyn *)(base + dynamic->vaddr); d->tag != DT_NULL; d++) {
    switch (d->tag) {
      case DT_NEEDED: if (needed_count < MAX_NEEDED) needed_offsets[needed_count++] = d->val; break;
      case DT_SONAME: soname = d->val; break;
      case DT_STRTAB: lib->strtab = (const char *)(base + d->val); break;
      case DT_SYMTAB: lib->symtab = (const Sym *)(base + d->val); break;
      case DT_GNU_HASH: lib->gnu_hash = (const uint32_t *)(base + d->val); break;
      case DT_RELA: rela = d->val; break;
      case DT_RELASZ: rela_size = d->val; break;
      case DT_JMPREL: jmprel = d->val; break;
      case DT_PLTRELSZ: plt_size = d->val; break;
      case DT_PLTREL: if (d->val != DT_RELA) { fail(error, error_size, "%s uses REL relocations", basename_of(path)); goto unmap; } break;
      case DT_INIT: lib->init = d->val; break;
      case DT_INIT_ARRAY: init_array = d->val; break;
      case DT_INIT_ARRAYSZ: init_array_size = d->val; break;
      case DT_REL: case DT_RELR: case DT_ANDROID_REL: case DT_ANDROID_RELA: case DT_TEXTREL:
        fail(error, error_size, "%s uses an unsupported relocation format", basename_of(path));
        goto unmap;
    }
  }
  if (!lib->strtab || !lib->symtab || !lib->gnu_hash) {
    fail(error, error_size, "%s has no GNU symbol table", basename_of(path));
    goto unmap;
  }
  for (int i = 0; i < needed_count; i++) needed[i] = lib->strtab + needed_offsets[i];
  lib->soname = soname ? lib->strtab + soname : basename_of(lib->path);
  lib->rela = (const Rela *)(base + rela);
  lib->rela_count = rela ? rela_size / sizeof(Rela) : 0;
  lib->jmprel = (const Rela *)(base + jmprel);
  lib->jmprel_count = jmprel ? plt_size / sizeof(Rela) : 0;
  lib->init_array = (const uint64_t *)(base + init_array);
  lib->init_count = init_array ? init_array_size / 8 : 0;

  /* Lookup scope: the library, then its loaded dependencies breadth-first. */
  lib->scope[lib->scope_count++] = lib;
  for (int i = 0; i < needed_count; i++)
    for (int j = 0; j < loaded_count; j++)
      if (strcmp(loaded[j]->soname, needed[i]) == 0) add_scope(lib, loaded[j]);
  for (int s = 1; s < lib->scope_count; s++)
    for (int k = 1; k < lib->scope[s]->scope_count; k++) add_scope(lib, lib->scope[s]->scope[k]);

  char missing[1024] = "";
  int bad = relocate(lib, lib->rela, lib->rela_count, missing, sizeof missing);
  if (!bad) bad = relocate(lib, lib->jmprel, lib->jmprel_count, missing, sizeof missing);
  if (bad) { fail(error, error_size, "%s has unsupported relocation type %d", basename_of(path), bad); goto unmap; }
  if (missing[0]) fprintf(stderr, "coros-watchface-compiler: %s imports unavailable symbols: %s\n", lib->soname, missing);

  for (int i = 0; i < eh->phnum; i++) {
    if (ph[i].type != PT_LOAD || !(ph[i].flags & PF_X)) continue;
    patch_tls_reads(base + ph[i].vaddr, ph[i].filesz, canary_page);
    uint64_t start = TRUNC(ph[i].vaddr), stop = ROUND(ph[i].vaddr + ph[i].memsz);
    sys_icache_invalidate(base + start, stop - start);
    if (mprotect(base + start, stop - start, PROT_READ | PROT_EXEC) != 0) {
      fail(error, error_size, "cannot make %s executable: %s", basename_of(path), strerror(errno));
      goto unmap;
    }
  }
  mprotect(canary_page, PAGE, PROT_READ);
  if (getenv("COROS_COMPILER_DEBUG")) fprintf(stderr, "coros-watchface-compiler: %s at %p\n", lib->soname, (void *)base);
  loaded[loaded_count++] = lib;
  goto out;

unmap:
  munmap(lib->base, lib->size + PAGE);
  free(lib);
  lib = NULL;
out:
  free(file);
  close(fd);
  return lib;
}

void elf_init(elf_lib *lib) {
  if (lib->initialized) return;
  lib->initialized = 1;
  static char *argv[] = { "coros-watchface-compiler", NULL }, *envp[] = { NULL };
  if (lib->init) ((void (*)(void))(lib->base + lib->init))();
  for (size_t i = 0; i < lib->init_count; i++) {
    uint64_t fn = lib->init_array[i];
    if (fn && fn != UINT64_MAX) ((void (*)(int, char **, char **))fn)(1, argv, envp);
  }
}

int elf_describe(uint64_t address, char *out, size_t size) {
  for (int i = 0; i < loaded_count; i++) {
    uint64_t base = (uint64_t)loaded[i]->base;
    if (address >= base && address < base + loaded[i]->size) {
      snprintf(out, size, "%s+0x%llx", loaded[i]->soname, (unsigned long long)(address - base));
      return 1;
    }
  }
  snprintf(out, size, "0x%llx", (unsigned long long)address);
  return 0;
}

/* struct dl_phdr_info as bionic lays it out on arm64. */
typedef struct {
  uint64_t addr;
  const char *name;
  const void *phdr;
  uint16_t phnum;
  unsigned long long adds, subs;
  size_t tls_modid;
  void *tls_data;
} bionic_dl_phdr_info;

int elf_dl_iterate_phdr(int (*callback)(void *info, size_t size, void *data), void *data) {
  for (int i = 0; i < loaded_count; i++) {
    bionic_dl_phdr_info info = { (uint64_t)loaded[i]->base, loaded[i]->path, loaded[i]->phdr, loaded[i]->phnum,
      (unsigned long long)loaded_count, 0, 0, NULL };
    int result = callback(&info, sizeof info, data);
    if (result) return result;
  }
  return 0;
}
