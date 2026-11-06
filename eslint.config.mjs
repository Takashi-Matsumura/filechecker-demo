import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import regexp from "eslint-plugin-regexp";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 正規表現が、入力によって極端に遅くならないこと（長さの二乗以上の時間がかかる書き方を禁止する）。
  // 検出のルールは社員のファイルの中身という信頼できない入力を読み、同期処理なので遅いとサーバ全体が止まる。
  // 文字列から組み立てる正規表現はここでは調べられないので、tests/regex-safety.test.ts で調べる
  {
    plugins: { regexp },
    rules: {
      "regexp/no-super-linear-backtracking": "error",
      "regexp/no-super-linear-move": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
