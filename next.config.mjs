/** @type {import('next').NextConfig} */
const nextConfig = {
  // Make /rules and /data available to serverless functions on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./rules/**/*", "./data/**/*"],
  },
};
export default nextConfig;
