import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/server-only packages external so their runtime assets stay
  // beside the package instead of being flattened into a webpack bundle.
  serverExternalPackages: [
    "@napi-rs/canvas",
    "pdfjs-dist",
    "ffmpeg-static",
  ],
};

export default nextConfig;
