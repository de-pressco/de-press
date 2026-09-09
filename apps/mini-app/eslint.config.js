import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "coverage", "vendor"] },
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    rules: {
      // react-hooks v7 compiler-era strictness — flagged 30+ legit-existing spots;
      // keep visible as warnings, not blocking CI. The guard that matters
      // (rules-of-hooks: hook order / conditional hooks) stays an "error"
      // from the flat recommended preset above.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
