import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.trycloudflare.com"],
  ...(process.env.NODE_ENV !== "production" ? {
    experimental: {
      serverActions: {
        allowedOrigins: ["*.trycloudflare.com"],
      },
    },
  } : {}),
  turbopack: {
    root: path.join(__dirname),
  },
  outputFileTracingExcludes: {
    "/*": ["./prisma/**/*.db*", "./storage/**/*", "./.env*", "./.next/dev/**/*", "./.next/cache/**/*"],
  },
};

export default nextConfig;
