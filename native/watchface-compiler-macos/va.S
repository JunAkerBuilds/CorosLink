// AAPCS64 variadic entry points for bionic.c.
//
// Android callers pass variadic arguments in x0-x7/q0-q7 before the stack,
// while Apple's variadic callees read them from the stack. Each trampoline
// spills the argument registers, builds an AAPCS64 va_list describing them
// and calls `impl(fixed..., &va_list)`.
//
// Frame (above the saved x29/x30):
//   [sp, #0]   va_list { stack, gr_top, vr_top, gr_offs, vr_offs }
//   [sp, #32]  q0-q7 save area (vr_top = sp + 160)
//   [sp, #160] x0-x7 save area (gr_top = sp + 224)

.text
.p2align 2

.macro VA_TRAMPOLINE name, impl, fixed
.globl \name
\name:
  stp x29, x30, [sp, #-16]!
  mov x29, sp
  sub sp, sp, #224
  stp x0, x1, [sp, #160]
  stp x2, x3, [sp, #176]
  stp x4, x5, [sp, #192]
  stp x6, x7, [sp, #208]
  stp q0, q1, [sp, #32]
  stp q2, q3, [sp, #64]
  stp q4, q5, [sp, #96]
  stp q6, q7, [sp, #128]
  add x9, x29, #16
  str x9, [sp, #0]
  add x9, sp, #224
  str x9, [sp, #8]
  add x9, sp, #160
  str x9, [sp, #16]
  mov w9, #(-(8 - \fixed) * 8)
  str w9, [sp, #24]
  mov w9, #-128
  str w9, [sp, #28]
  mov x\fixed, sp
  bl \impl
  mov sp, x29
  ldp x29, x30, [sp], #16
  ret
.endm

VA_TRAMPOLINE _bionic_printf, _bionic_printf_va, 1
VA_TRAMPOLINE _bionic_fprintf, _bionic_fprintf_va, 2
VA_TRAMPOLINE _bionic_sscanf, _bionic_sscanf_va, 2
VA_TRAMPOLINE _bionic_syslog, _bionic_syslog_va, 2
VA_TRAMPOLINE _bionic_snprintf, _bionic_snprintf_va, 3
VA_TRAMPOLINE _bionic_swprintf, _bionic_swprintf_va, 3
