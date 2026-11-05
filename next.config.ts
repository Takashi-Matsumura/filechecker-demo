import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ネイティブモジュール / PDF.js はバンドルせず Node から直接読み込む
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "unpdf"],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
