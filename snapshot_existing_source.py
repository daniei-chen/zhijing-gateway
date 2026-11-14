"""One-time, local Go-source snapshot; never copies operations or runtime data."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

SOURCE = Path(r"D:\AI\codex\codex3\zhijing-gateway").resolve()
TARGET = Path(__file__).resolve().parent
MANIFEST = TARGET / "local-v002-baseline.json"
if MANIFEST.exists():
    raise SystemExit("Baseline already captured; refusing to overwrite")


def paths(*args):
    return subprocess.check_output(["git", "-C", str(SOURCE), *args],
                                   encoding="utf-8").splitlines()


names = set(paths("diff", "--name-only", "HEAD", "--", "backend"))
names.update(paths("ls-files", "--others", "--exclude-standard", "--", "backend"))
manifest = {}
for name in sorted(names):
    if not name.startswith("backend/") or not name.endswith(".go"):
        continue
    src, dest = SOURCE / name, TARGET / name
    if src.is_symlink() or not src.resolve().is_relative_to(SOURCE / "backend"):
        raise SystemExit("Unexpected source path")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    digest = hashlib.sha256(src.read_bytes()).hexdigest()
    assert hashlib.sha256(dest.read_bytes()).hexdigest() == digest
    manifest[name] = digest
MANIFEST.write_text(json.dumps({"upstream": "d851a38477597157e78450d30af2d8504764d085",
                               "files": manifest}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"copied_go_files": len(manifest), "original_files_changed": 0}))
