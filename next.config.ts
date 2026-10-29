import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @napi-rs/canvas ships a native .node addon (used by unpdf's page-to-image
  // rendering for vision-based PDF extraction) that can't be bundled into a
  // JS chunk -- it must stay a real require() resolved from node_modules at
  // runtime.
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;
