// Next standalone emits directory symlinks. Windows junctions work without Developer Mode.
// File links fall back to copies; bundled resources are always dereferenced when packaged.
if (process.platform === 'win32') {
  const fs = require('node:fs'), path = require('node:path');
  const original = fs.promises.symlink.bind(fs.promises);
  fs.promises.symlink = async (target, destination, type) => {
    try { return await original(target, destination, type); }
    catch (error) {
      if (error.code !== 'EPERM') throw error;
      const absolute = path.resolve(path.dirname(destination), target);
      const stat = await fs.promises.stat(absolute);
      if (stat.isDirectory()) return original(absolute, destination, 'junction');
      return fs.promises.copyFile(absolute, destination);
    }
  };
}
