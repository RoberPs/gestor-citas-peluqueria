import type { NextConfig } from 'next';
import { securityHeaders } from './src/infrastructure/security/security-headers';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The image runs `.next/standalone`: the server with only the files it
  // traces, and no devDependencies (deploy/README.md).
  output: 'standalone',
  serverExternalPackages: ['pg', 'pino'],
  // `npm run lint` is the linting gate, with the project's own flat config.
  // Letting `next build` run a second, different ESLint setup would mean two
  // sets of rules disagreeing about the same files.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
    return [{ source: '/:path*', headers: securityHeaders(mode) }];
  },
};

export default nextConfig;
