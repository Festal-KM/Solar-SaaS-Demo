// ESLint flat config — applied to the entire monorepo.
//
// Layers (composed in order):
//  1. @eslint/js recommended
//  2. typescript-eslint recommended (non type-checked) + a typed slice for app code
//  3. eslint-plugin-import recommended (TS resolver)
//  4. eslint-config-next via FlatCompat (Next.js 15 + core-web-vitals)
//  5. eslint-config-prettier — disables stylistic rules that conflict with Prettier
//
// Type-information-using rules are scoped to `apps/**` / `packages/**` source
// folders to keep config files / scripts cheap to lint.

import { fileURLToPath } from "node:url";
import path from "node:path";

import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import globals from "globals";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/*.tsbuildinfo",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      "**/.next/types/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    plugins: {
      import: importPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: [
            "./tsconfig.base.json",
            "./apps/*/tsconfig.json",
            "./packages/*/tsconfig.json",
            "./tests/*/tsconfig.json",
          ],
        },
        node: true,
      },
      "import/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx"],
      },
    },
    rules: {
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", ["parent", "sibling", "index"], "type"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/no-duplicates": "error",
      "import/no-self-import": "error",
      "import/newline-after-import": "warn",
    },
  },

  // Next.js rules only inside apps/web. Applying them globally produces
  // noisy "Pages directory cannot be found" / "react package not installed"
  // warnings in every backend / pure-TS package.
  ...compat
    .extends("next/core-web-vitals")
    .map((cfg) => ({ ...cfg, files: ["apps/web/**/*.{ts,tsx,js,jsx}"] })),

  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },

  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/worker/**/*.ts", "packages/*/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },

  {
    files: ["**/*.config.{js,mjs,cjs,ts}", "**/*.cjs", "**/scripts/**", "eslint.config.mjs"],
    rules: {
      "@typescript-eslint/no-var-requires": "off",
      "no-console": "off",
      "import/order": "off",
    },
  },

  prettier,
];
