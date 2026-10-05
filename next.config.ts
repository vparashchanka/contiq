import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    // Proxy also buffers upload requests before they reach the server action.
    proxyClientMaxBodySize: '26mb',
    serverActions: {
      // Allow multipart metadata in addition to a 25 MB file.
      bodySizeLimit: '26mb',
    },
  },
};

export default nextConfig;
