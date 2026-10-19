import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export async function tmpDir(prefix = "ttm-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}
