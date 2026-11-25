import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// The web app's rules that matter here: TypeScript's and React's hooks and compiler rules (the React Compiler
// builds these screens, so its rules are errors).
// The shared screens keep the web app's `eslint-disable @next/next/no-img-element` comments; on the desktop the
// rule has nothing to say (there is no next/image optimiser), so it exists here only to keep those comments valid.
const nextStandIn = { rules: { "no-img-element": { create: () => ({}) } } };

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "desktop/main/apiRoutes.gen.ts"] },
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  {
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { "@next/next": nextStandIn },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
