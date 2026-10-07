import path from "node:path";\nimport type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/server-only packages external so their runtime assets stay
  // beside the package instead of being flattened into a webpack bundle.
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@supabase/supabase-js": path.resolve(
        process.cwd(),
        "lib/supabase-compat.ts",
      ),
    };
    return config;
  },
  serverExternalPackages: [
    "@napi-rs/canvas",
    "pdfjs-dist",
    "ffmpeg-static",
  ],
};

export default nextConfig;
