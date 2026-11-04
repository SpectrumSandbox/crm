import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // Type-checking still gates the build; linting runs separately so a missing ESLint setup never blocks deploys.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

// Gives `next dev` access to Cloudflare bindings (D1 `DB`) via getCloudflareContext().
initOpenNextCloudflareForDev();
