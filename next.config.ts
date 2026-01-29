import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable source maps in production so we can see the real file/line for the React #310 crash
  productionBrowserSourceMaps: true,
};

export default nextConfig;