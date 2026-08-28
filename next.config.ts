import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's dev server blocks JS chunks/HMR for any origin other than
  // localhost by default. Without this, opening the site from a phone on
  // the LAN loads the bare HTML but React never hydrates — every tap
  // falls back to a full page reload, which looks like "the join page
  // keeps refreshing and never lets me in." This only matters for `next
  // dev`; production builds have no such restriction.
  allowedDevOrigins: ["192.168.88.12"],
};

export default nextConfig;
