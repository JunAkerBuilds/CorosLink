#pragma once
#include <stddef.h>
#include <stdint.h>

/* A minimal loader for the user's Android arm64 COROS compiler libraries.
 * Apple Silicon executes the same instructions, so only the dynamic linking,
 * the bionic libc ABI and Android's TLS stack canary need to be bridged. */

typedef struct elf_lib elf_lib;

/* Loads and relocates one shared object. Dependencies are looked up among the
 * libraries loaded before it; libc/libm/libdl/liblog come from bionic.c. */
elf_lib *elf_load(const char *path, char *error, size_t error_size);
/* Runs DT_INIT and DT_INIT_ARRAY after every library has been relocated. */
void elf_init(elf_lib *lib);
void *elf_symbol(const elf_lib *lib, const char *name);

/* Writes "soname+0xoffset" for an address inside a loaded library (debugging). */
int elf_describe(uint64_t address, char *out, size_t size);

/* bionic's dl_iterate_phdr, used by libunwind to find .eh_frame_hdr. */
int elf_dl_iterate_phdr(int (*callback)(void *info, size_t size, void *data), void *data);

/* Provided by bionic.c. */
void *bionic_symbol(const char *name);
void bionic_init(void);
