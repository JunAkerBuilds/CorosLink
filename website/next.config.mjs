import path from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(websiteRoot, "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.buymeacoffee.com",
        pathname: "/uploads/profile_pictures/**",
      },
    ],
  },
};

export default nextConfig;
