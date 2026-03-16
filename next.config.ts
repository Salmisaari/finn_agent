import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Needed because there are multiple lockfiles across the monorepo
  outputFileTracingRoot: path.join(__dirname),

  serverExternalPackages: [
    'googleapis',
    'google-auth-library',
    'gcp-metadata',
    'gtoken',
    'google-p12-pem',
    'jws',
    'node-fetch',
  ],
};

export default nextConfig;
