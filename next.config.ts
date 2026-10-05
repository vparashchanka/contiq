import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    serverActions: {
      // Allow multipart metadata in addition to a 25 MB file.
      bodySizeLimit: '26mb',
    },
  },
};

export default nextConfig;
