// Minimal ESM resolve hook so test scripts can import source `.ts` modules that
// use TypeScript-style extensionless relative imports (which Node does not
// resolve on its own). Pairs with node --experimental-strip-types.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isRelative =
      specifier.startsWith("./") || specifier.startsWith("../");
    if (isRelative && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    throw err;
  }
}
