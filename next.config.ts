import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "60mb",
    serverActions: {
      bodySizeLimit: "512kb",
    },
  },
};

export default nextConfig;
