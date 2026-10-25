"""Apply the additive local trade migration with a backup and old-row checks.

Does not seed/reset databases or run unrelated pending migrations.
Usage: python3 scripts/apply_trade_migration.py DATABASE BACKUP_DIRECTORY
"""
import datetime
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys
import uuid

EXPECTED = {"MaterialReceipt", "MaterialValuation", "MaterialLotOrigin", "MaterialUse", "MaterialEvent", "OrderCostTag"}


def table_fingerprints(connection, tables):
    result = {}
    for table in tables:
        quoted = '"' + table.replace('"', '""') + '"'
        digest = hashlib.sha256()
        count = 0
        for row in connection.execute("SELECT * FROM " + quoted + " ORDER BY rowid"):
            digest.update(json.dumps(row, ensure_ascii=True, default=str).encode())
            digest.update(b"\n")
            count += 1
        result[table] = {"count": count, "sha256": digest.hexdigest()}
    return result


def apply(database_path, backup_directory):
    database = Path(database_path).resolve(strict=True)
    backup_dir = Path(backup_directory).resolve()
    backup_dir.mkdir(parents=True, exist_ok=True)
    migration = Path(__file__).resolve().parents[1] / "prisma/migrations/20260920100000_material_cost/migration.sql"
    sql = migration.read_text()
    created = set(re.findall(r'CREATE TABLE "([^"]+)"', sql))
    if created != EXPECTED:
        raise RuntimeError("Migration table allowlist does not match")
    statements = []
    pending = ""
    for line in sql.splitlines(True):
        pending += line
        if sqlite3.complete_statement(pending):
            clean = re.sub(r"--[^\n]*", "", pending).strip()
            if not re.match(r"^CREATE (?:TABLE|(?:UNIQUE )?INDEX) ", clean):
                raise RuntimeError("Only CREATE TABLE/INDEX statements are allowed")
            statements.append(pending)
            pending = ""
    if pending.strip():
        raise RuntimeError("Incomplete migration statement")
    connection = sqlite3.connect(database, timeout=10)
    connection.execute("PRAGMA foreign_keys=ON")
    tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    if EXPECTED.intersection(tables):
        raise RuntimeError("Material tables already exist; inspect migration state instead of replaying")
    backup = backup_dir / ("before-material-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S") + ".db")
    destination = sqlite3.connect(backup)
    connection.backup(destination)
    destination.close()
    try:
        connection.execute("BEGIN IMMEDIATE")
        old_tables = [table for table in tables if table != "_prisma_migrations"]
        before = table_fingerprints(connection, old_tables)
        for statement in statements:
            connection.execute(statement)
        after = table_fingerprints(connection, old_tables)
        if before != after:
            raise RuntimeError("An existing business table changed; transaction rolled back")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Foreign key validation failed")
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("Database integrity check failed")
        if "_prisma_migrations" in tables:
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            connection.execute("INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count) VALUES(?,?,?,?,NULL,NULL,?,1)",
                               (str(uuid.uuid4()), hashlib.sha256(sql.encode()).hexdigest(), now, migration.parent.name, now))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    result = {"database": str(database), "backup": str(backup), "created_tables": sorted(EXPECTED), "old_tables_preserved": len(before), "old_table_fingerprints": before, "foreign_key_check": "ok", "quick_check": "ok"}
    report = backup_dir / "material-migration-result.json"
    report.write_text(json.dumps(result, indent=2))
    print(json.dumps({key: value for key, value in result.items() if key != "old_table_fingerprints"}))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    apply(sys.argv[1], sys.argv[2])
