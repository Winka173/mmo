/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@ttm/core", "@ttm/storage", "@ttm/automation"],
  webpack: (config) => {
    // workspace packages use NodeNext-style ".js" specifiers that point at .ts sources
    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    return config;
  },
};
