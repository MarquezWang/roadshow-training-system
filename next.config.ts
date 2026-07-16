import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "105mb",
    serverActions: {
      bodySizeLimit: "256mb",
    },
  },
};

export default nextConfig;
