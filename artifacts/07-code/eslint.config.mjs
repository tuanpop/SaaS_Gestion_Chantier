// eslint.config.mjs — ClawBTP Sprint 2
// Configuration ESLint avec Next.js strict + règles ClawBTP
// Règles obligatoires (CLAUDE.md) :
//   - no-console : jamais console.log en production (utiliser lib/logger.ts)
//   - @typescript-eslint/no-explicit-any : zéro any implicite (sauf eslint-disable explicite)

import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // CLAUDE.md hard rule : jamais console.log en code production
      "no-console": ["error", { allow: ["warn", "error"] }],
      // Typage strict — toujours préférer unknown à any
      "@typescript-eslint/no-explicit-any": "warn",
      // Pas de variables inutilisées (sauf préfixées par _)
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Tests et scripts : règles assouplies
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
];

export default eslintConfig;
