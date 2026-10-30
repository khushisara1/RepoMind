import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { agentFeedback: true },
};

export default nextConfig;
