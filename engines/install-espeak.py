"""Pinned, local espeak-ng for the legacy factory voice (tests and the old render path).

Downloads the official espeak-ng 1.52.0 MSI from GitHub, verifies its SHA-256, and unpacks it into
<root>/.local/tools/espeak-ng WITHOUT running an installer (no msiexec, no registry, no admin): the embedded
cabinet is read with msilib and expanded with Windows expand.exe, then files are placed using the MSI
File/Component/Directory tables. Prints JSON with the executable path. Python 3.11-3.12 on Windows (msilib).
Usage: python scripts/install-espeak.py <root>
"""
import hashlib, json, os, subprocess, sys, tempfile, urllib.request, warnings
from pathlib import Path

URL = "https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi"
SHA256 = "7f673c709ea5dd579d3b5ebb98688cc575328a6ab7438d2bc405b88cedaeafb9"
OLEFILE_SHA256 = "543c7da2a7adadf21214938bb79c83ea12b473a4b6ee4ad4bf854e7715e13d1f"
root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
dest = root / ".local" / "tools" / "espeak-ng"
exe = dest / "espeak-ng.exe"
if exe.is_file() and (dest / "espeak-ng-data").is_dir():
    print(json.dumps({"status": "present", "exe": str(exe), "version": "1.52.0"})); sys.exit(0)
msi = root / ".local" / "downloads" / "espeak-ng-1.52.0.msi"
msi.parent.mkdir(parents=True, exist_ok=True)
if not msi.is_file() or hashlib.sha256(msi.read_bytes()).hexdigest() != SHA256:
    with urllib.request.urlopen(URL, timeout=300) as r, open(msi, "wb") as out: out.write(r.read())
digest = hashlib.sha256(msi.read_bytes()).hexdigest()
if digest != SHA256: msi.unlink(missing_ok=True); raise SystemExit(f"espeak-ng MSI hash mismatch: {digest}")
with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    import msilib
db = msilib.OpenDatabase(str(msi), msilib.MSIDBOPEN_READONLY)
def rows(query, n):
    view = db.OpenView(query); view.Execute(None); out = []
    while True:
        try: rec = view.Fetch()
        except Exception: break
        if rec is None: break
        out.append([rec.GetString(i + 1) for i in range(n)])
    view.Close(); return out
directories = {d: (parent, name) for d, parent, name in rows("SELECT Directory, Directory_Parent, DefaultDir FROM Directory", 3)}
def dir_path(key):
    parts = []
    while key and key in directories:
        parent, name = directories[key]
        name = name.split(":")[-1].split("|")[-1]
        if name not in (".", "SourceDir") and key not in ("TARGETDIR", "ProgramFiles64Folder", "ProgramFilesFolder"): parts.append(name)
        key = parent
    parts.reverse()
    # Drop the install-root prefix (e.g. "eSpeak NG") so the tree starts at the application folder.
    return parts[1:] if parts else parts
components = {c: d for c, d in rows("SELECT Component, Directory_ FROM Component", 2)}
files = rows("SELECT File, Component_, FileName FROM File", 3)
media = [m for m in rows("SELECT Cabinet FROM Media", 1) if m[0]]
with tempfile.TemporaryDirectory() as tmp:
    tmpd = Path(tmp)
    # Embedded cabinets are OLE streams that start with "MSCF"; read them with the pinned olefile wheel.
    wheel = root / ".local" / "downloads" / "olefile-0.47-py2.py3-none-any.whl"
    if not wheel.is_file(): subprocess.run([sys.executable, "-m", "pip", "download", "olefile==0.47", "--no-deps", "-d", str(wheel.parent), "-q"], check=True)
    if hashlib.sha256(wheel.read_bytes()).hexdigest() != OLEFILE_SHA256: raise SystemExit("olefile wheel hash mismatch")
    sys.path.insert(0, str(wheel)); import olefile
    ole = olefile.OleFileIO(str(msi)); out = tmpd / "x"; out.mkdir(exist_ok=True); cabs = 0
    for entry in ole.listdir(streams=True, storages=False):
        data = ole.openstream(entry).read()
        if not data.startswith(b"MSCF"): continue
        cab_file = tmpd / f"c{cabs}.cab"; cab_file.write_bytes(data); cabs += 1
        subprocess.run(["expand.exe", str(cab_file), "-F:*", str(out)], check=True, capture_output=True)
    ole.close()
    if not cabs or not media: raise SystemExit("No embedded cabinet found")
    staged = Path(str(dest) + ".partial")
    if staged.exists():
        import shutil; shutil.rmtree(staged)
    placed = 0
    for key, component, name in files:
        src = tmpd / "x" / key
        if not src.is_file(): continue
        target = staged.joinpath(*dir_path(components[component]), name.split("|")[-1])
        target.parent.mkdir(parents=True, exist_ok=True); os.replace(src, target); placed += 1
found = next(staged.rglob("espeak-ng.exe"), None)
if not found: raise SystemExit("espeak-ng.exe not found in the package")
app = found.parent
import shutil
if dest.exists(): shutil.rmtree(dest)
shutil.move(str(app), str(dest)); shutil.rmtree(staged, ignore_errors=True)
ver = subprocess.run([str(exe), "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
print(json.dumps({"status": "installed", "exe": str(exe), "files": placed, "msiSha256": digest, "version": ver}))
