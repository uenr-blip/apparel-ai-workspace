"""Export reviewed source only; no network, Git commit, or upload.

Run from the private workspace. Refuses overwrites and symlinks. The manifest
contains only relative source paths and hashes, never secret values.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
destination = root / "output/open-source/apparel-ai-workspace"
entries = [
    "LICENSE", "README.md", "CONTRIBUTING.md", "SECURITY.md", "AGENTS.md", "CLAUDE.md",
    "CURSOR_MASTER_PROMPT.md", ".gitignore", ".env.example", "package.json", "package-lock.json",
    "tsconfig.json", "next.config.ts", "postcss.config.mjs", "eslint.config.mjs",
    "vitest.config.ts", "playwright.config.ts", "src", "public", "tests", "e2e", "fixtures",
    "prisma/schema.prisma", "prisma/seed.ts", "prisma/migrations",
    "scripts/setup-demo.mjs", "scripts/package-open-source.py", "scripts/pilot-user.ts",
    "scripts/verify-business-agent.ts", "scripts/check-build-styles.mjs",
    "scripts/check-build-styles.test.mjs", "scripts/apply_trade_migration.py",
    "scripts/apply_material_migration.py", "scripts/apply_ledger_migration.py",
    "docs/ACCEPTANCE.md", "docs/DEMO_SCENARIOS.md", "docs/DECISIONS.md",
    "docs/OPS_READINESS.md", "docs/FINANCE_SIMULATION_ACCEPTANCE.md",
    "docs/TRADE_GUIDE.md", "docs/MATERIAL_COST_GUIDE.md", "docs/LEDGER_GUIDE.md",
    "docs/LEDGER_BRIDGE_GUIDE.md", "docs/FINANCE_NAV_GUIDE.md", "docs/MONEY_RECONCILIATION_GUIDE.md",
]

if destination.exists():
    raise SystemExit("Export already exists; review it before making a new export.")

# Read local configuration only for an exact-value leak check. Never print it.
secrets = []
for env in root.glob(".env*"):
    if env.name.endswith(".example") or not env.is_file():
        continue
    for line in env.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and re.search(r"KEY|SECRET|TOKEN|PASSWORD", key, re.I):
            value = value.strip().strip("\"'")
            if len(value) >= 12 and not value.startswith("change-me"):
                secrets.append(value.encode())

files = {}
for entry in entries:
    base = root / entry
    for file in sorted(base.rglob("*")) if base.is_dir() else [base]:
        if file.is_symlink():
            raise SystemExit("Refusing symlink: " + str(file.relative_to(root)))
        if file.is_dir():
            continue
        name = file.relative_to(root).as_posix()
        if file.name == ".DS_Store":
            continue
        if file.suffix.lower() in {".db", ".sqlite", ".sqlite3", ".pem", ".key", ".zip", ".gz", ".log"} or ".db-" in file.name:
            raise SystemExit("Refusing private file: " + name)
        if file.name.startswith(".env") and name != ".env.example":
            raise SystemExit("Refusing environment file: " + name)
        data = file.read_bytes()
        if data.startswith(b"SQLite format 3") or any(secret in data for secret in secrets):
            raise SystemExit("Private content detected in: " + name)
        if re.search(rb"(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)", data):
            raise SystemExit("Credential pattern detected in: " + name)
        files[name] = data

destination.mkdir(parents=True)
for name in files:
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / name, target)
manifest = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}
(destination.parent / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
archive = destination.parent / "apparel-ai-workspace-source.zip"
with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as output:
    for name in sorted(files):
        output.write(destination / name, "apparel-ai-workspace/" + name)
print(json.dumps({"files": len(files), "bytes": sum(map(len, files.values())), "archive": str(archive), "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}))
