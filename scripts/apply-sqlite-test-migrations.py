import hashlib
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


def resolve_database_path(project_root: Path) -> Path:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url.startswith("file:"):
        raise RuntimeError("DATABASE_URL must be a SQLite file: URL")

    raw_path = database_url[len("file:") :]
    database_path = Path(raw_path)
    if not database_path.is_absolute():
        database_path = project_root / "prisma" / database_path
    database_path = database_path.resolve()

    lowered = database_path.name.lower()
    if "test" not in lowered and "stability" not in lowered:
        raise RuntimeError("Refusing to initialize a database without test/stability in its name")
    return database_path


def main() -> None:
    project_root = Path.cwd().resolve()
    database_path = resolve_database_path(project_root)
    migrations_root = project_root / "prisma" / "migrations"
    migration_files = sorted(migrations_root.glob("*/migration.sql"))
    if not migration_files:
        raise RuntimeError("No Prisma SQL migrations found")

    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS _prisma_migrations (
              id TEXT PRIMARY KEY NOT NULL,
              checksum TEXT NOT NULL,
              finished_at DATETIME,
              migration_name TEXT NOT NULL,
              logs TEXT,
              rolled_back_at DATETIME,
              started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              applied_steps_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )

        for migration_file in migration_files:
            migration_name = migration_file.parent.name
            sql = migration_file.read_text(encoding="utf-8")
            connection.executescript(sql)
            now = datetime.now(timezone.utc).isoformat()
            connection.execute(
                """
                INSERT INTO _prisma_migrations
                  (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (
                    str(uuid.uuid4()),
                    hashlib.sha256(sql.encode("utf-8")).hexdigest(),
                    now,
                    migration_name,
                    now,
                ),
            )
            connection.commit()

        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_errors:
            raise RuntimeError(f"foreign_key_check failed: {foreign_key_errors[:5]}")
    finally:
        connection.close()

    print(
        f"Applied {len(migration_files)} migrations to {database_path} with 0 foreign key errors"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
