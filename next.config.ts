import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets an open tab notice the site was updated (see FreshBuild).
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || "dev" },
  cacheComponents: true,
  // Only the Wade page may show Wade's local frame from this Mac (see features/wade/protocol.ts).
  async headers() {
    return [
      {
        source: "/wade",
        headers: [
          { key: "Content-Security-Policy", value: "frame-src 'self' http://127.0.0.1:8790; frame-ancestors 'self'" },
          { key: "Permissions-Policy", value: 'local-network-access=(self "http://127.0.0.1:8790"), local-network=(self "http://127.0.0.1:8790"), loopback-network=(self "http://127.0.0.1:8790"), autoplay=(self "http://127.0.0.1:8790")' },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
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
