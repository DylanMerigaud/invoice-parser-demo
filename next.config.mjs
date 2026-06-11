/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server route handlers read raw PDF bytes; nothing special needed, but keep
  // strict mode on for better dev-time warnings.
  reactStrictMode: true,
};

export default nextConfig;
