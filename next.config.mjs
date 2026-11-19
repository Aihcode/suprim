/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs'],
    // Entornos con poca RAM (o discos de red) necesitan un solo worker de build.
    cpus: 1,
  },
};

export default nextConfig;
