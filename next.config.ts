import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep PDF.js and its native canvas dependency together at runtime so
  // pdfjs-dist can resolve @napi-rs/canvas normally on Vercel instead of
  // emitting the optional-canvas resolution warning from a bundled chunk.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
