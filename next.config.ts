import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The end-to-end tests build a second copy with the online presets switched on.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  /* config options here */
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
