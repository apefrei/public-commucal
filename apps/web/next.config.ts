import type { NextConfig } from "next";

// Baseline security headers for every response (NFR-1). The Content-Security-Policy follows with the public pages
// (WP-1.7), where it needs per-request nonces.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  transpilePackages: ["@commucal/core", "@commucal/db", "@commucal/auth"],
  // Node libraries with native or worker-thread internals are loaded at runtime instead of bundled.
  serverExternalPackages: ["pg", "pg-boss", "pino", "iovalkey"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
