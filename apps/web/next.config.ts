import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  transpilePackages: ["@commucal/core"],
  poweredByHeader: false,
};

export default nextConfig;
