import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    // old bookmarks / installed PWAs keep working after the restructure
    return [
      { source: "/recovery", destination: "/sleep", permanent: true },
      { source: "/training", destination: "/load", permanent: true },
      { source: "/activities", destination: "/load", permanent: true },
    ];
  },
};

export default nextConfig;
