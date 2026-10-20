/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@ttm/core", "@ttm/storage", "@ttm/automation", "@ttm/games", "@ttm/media", "@ttm/governance", "@ttm/discovery", "@ttm/providers", "@ttm/platforms", "@ttm/telegram", "@ttm/quality", "@ttm/insights"],
  // native/binary deps stay as runtime requires on the server
  serverExternalPackages: ["sharp", "yauzl"],
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  webpack: (config) => {
    // workspace packages use NodeNext-style ".js" specifiers that point at .ts sources
    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    return config;
  },
};
