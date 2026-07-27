import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The old /smg and /guest-satisfaction tabs were replaced by the survey-data
  // tab, which now carries the "SMG" name. Anyone holding a bookmark to either
  // old page lands on the tab that superseded it rather than a 404. Temporary
  // rather than permanent, so it stays easy to reclaim /smg as a real route.
  async redirects() {
    return [
      { source: "/smg", destination: "/survey-data", permanent: false },
      { source: "/guest-satisfaction", destination: "/survey-data", permanent: false },
    ];
  },
};

export default nextConfig;
