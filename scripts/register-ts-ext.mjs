// Registers the ts-ext resolve hook via the non-deprecated module API so test
// scripts can import extensionless `.ts` source modules under strip-types.
import { register } from "node:module";
register("./ts-ext-loader.mjs", import.meta.url);
