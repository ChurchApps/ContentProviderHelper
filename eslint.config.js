import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { globalIgnores } from "eslint/config";

export default tseslint.config([
  globalIgnores(["dist", "playground", "cli", "node_modules"]),
  {
    files: ["**/*.ts"],
    ignores: ["node_modules", ".github", ".vscode"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // TypeScript relaxations (matching B1Admin)
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-case-declarations": "off",
      "no-constant-binary-expression": "off",

      // Compact if statements and blocks
      curly: ["error", "multi-line"],
      "brace-style": ["error", "1tbs", { allowSingleLine: true }],
      "nonblock-statement-body-position": ["error", "beside"],

      // Object and array formatting - prefer compact single-line objects
      "object-curly-spacing": ["error", "always"],
      "object-curly-newline": [
        "error",
        {
          ObjectExpression: { multiline: true, minProperties: 6, consistent: true },
          ObjectPattern: { multiline: true, minProperties: 6, consistent: true },
          ImportDeclaration: { multiline: true, minProperties: 8, consistent: true },
          ExportDeclaration: { multiline: true, minProperties: 8, consistent: true },
        },
      ],
      "object-property-newline": ["error", { allowAllPropertiesOnSameLine: true }],
      "array-bracket-spacing": ["error", "never"],
      "array-bracket-newline": ["error", { multiline: true, minItems: 8 }],
      "array-element-newline": ["error", { ArrayExpression: "consistent", ArrayPattern: { minItems: 8 } }],

      // Function formatting - allow compact
      "function-paren-newline": ["error", "consistent"],
      "function-call-argument-newline": ["error", "consistent"],

      // Line length and spacing
      "max-len": [
        "warn",
        {
          code: 250,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreComments: true,
          ignoreUrls: true,
          ignoreRegExpLiterals: true,
        },
      ],

      // Semicolons, commas, and quotes
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
      "comma-dangle": ["error", "only-multiline"],
      "comma-spacing": ["error", { before: false, after: true }],

      // Additional compact formatting rules
      indent: ["error", 2, { SwitchCase: 1 }],
      "no-multi-spaces": ["error", { ignoreEOLComments: true }],
      "key-spacing": ["error", { beforeColon: false, afterColon: true, mode: "strict" }],

      // Block formatting - encourage single line for simple blocks
      "block-spacing": ["error", "always"],
      "keyword-spacing": ["error", { before: true, after: true }],
    },
  },
  prettier,
  // Re-enable quotes after prettier (prettier disables it)
  {
    files: ["**/*.ts"],
    rules: {
      quotes: ["error", "double", { avoidEscape: true }],
    },
  },
]);
