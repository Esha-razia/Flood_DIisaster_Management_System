"""Multi-worker assignment storage for rescue operations.

Additive table `rescue_operation_workers` (one row per worker per operation).
A partial/filtered UNIQUE index on worker_key WHERE released_at IS NULL makes
"one worker, one active operation" a database guarantee, not just app logic.
The table is NEVER created implicitly: see ensure_tables() (opt-in) and
database/rescue_operation_workers_migration.sql. Until it exists, ready()
returns False and the app keeps its legacy single-worker behaviour.
"""
import threading
from datetime import datetime

TABLE = "rescue_operation_workers"
LOCK = threading.RLock()
_ready_cache = {"value": False}


class AssignmentConflict(Exception):
    pass


def worker_key(name):
    return (name or "").strip().lower()


def clean_names(names):
    seen, out = set(), []
    for raw in names or []:
        name = (raw or "").strip() if isinstance(raw, str) else ""
        key = worker_key(name)
        if name and key != "unassigned" and key not in seen:
            seen.add(key)
            out.append(name)
    return out


def ready(conn, cursor):
    if _ready_cache["value"]:
        return True
    try:
        cursor.execute(f"SELECT 1 FROM {TABLE} WHERE 1 = 0")
        cursor.fetchall()
        _ready_cache["value"] = True
        return True
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return False


def active_rows(cursor):
    """{operation_id: [worker_name, ...]} for assignments not yet released."""
    cursor.execute(
        f"SELECT operation_id, worker_name FROM {TABLE} WHERE released_at IS NULL ORDER BY id"
    )
    result = {}
    for row in cursor.fetchall():
        result.setdefault(row[0], []).append(row[1])
    return result


def insert_assignment(conn, cursor, op_id, name):
    try:
        cursor.execute(
            f"INSERT INTO {TABLE} (operation_id, worker_name, worker_key, assigned_at) VALUES (?, ?, ?, ?)",
            (op_id, name, worker_key(name), datetime.now()),
        )
    except Exception as error:
        conn.rollback()
        text = str(error).lower()
        if any(k in text for k in ("unique", "duplicate", "constraint", "violation")):
            raise AssignmentConflict(f"{name} is already assigned to an active operation.")
        raise


def release(conn, cursor, op_id, name=None):
    sql = f"UPDATE {TABLE} SET released_at = ? WHERE operation_id = ? AND released_at IS NULL"
    params = [datetime.now(), op_id]
    if name is not None:
        sql += " AND worker_key = ?"
        params.append(worker_key(name))
    cursor.execute(sql, tuple(params))


_COMMON_BACKFILL = """
INSERT INTO rescue_operation_workers (operation_id, worker_name, worker_key, assigned_at)
SELECT t.id, t.assigned_team, {key}, {ts}
FROM (
    SELECT id, assigned_team, created_at,
           ROW_NUMBER() OVER (PARTITION BY {key_inner} ORDER BY created_at DESC, id DESC) AS rn
    FROM rescue_operations
    WHERE status IN ('Assigned', 'In Progress')
      AND assigned_team IS NOT NULL
      AND {trim_inner} <> ''
      AND {key_inner} <> 'unassigned'
) t
WHERE t.rn = 1
  AND NOT EXISTS (
      SELECT 1 FROM rescue_operation_workers w
      WHERE w.operation_id = t.id
         OR (w.worker_key = {key} AND w.released_at IS NULL)
  )
"""


def ddl_statements(db_type):
    if db_type == "sql_server":
        create = (
            "IF OBJECT_ID(N'dbo.rescue_operation_workers', N'U') IS NULL "
            "CREATE TABLE dbo.rescue_operation_workers ("
            "id INT IDENTITY(1,1) PRIMARY KEY, operation_id INT NOT NULL, "
            "worker_name NVARCHAR(200) NOT NULL, worker_key NVARCHAR(200) NOT NULL, "
            "assigned_at DATETIME NOT NULL DEFAULT GETDATE(), released_at DATETIME NULL)"
        )
        idx1 = (
            "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_row_active_worker' "
            "AND object_id = OBJECT_ID(N'dbo.rescue_operation_workers')) "
            "CREATE UNIQUE INDEX ux_row_active_worker ON dbo.rescue_operation_workers(worker_key) "
            "WHERE released_at IS NULL"
        )
        idx2 = (
            "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_row_operation' "
            "AND object_id = OBJECT_ID(N'dbo.rescue_operation_workers')) "
            "CREATE INDEX ix_row_operation ON dbo.rescue_operation_workers(operation_id)"
        )
        key_expr = "LOWER(LTRIM(RTRIM(t.assigned_team)))"
        key_inner = "LOWER(LTRIM(RTRIM(assigned_team)))"
        trim_inner = "LTRIM(RTRIM(assigned_team))"
        ts = "COALESCE(t.created_at, GETDATE())"
    else:
        pk = "SERIAL PRIMARY KEY" if db_type == "postgresql" else "INTEGER PRIMARY KEY AUTOINCREMENT"
        create = (
            f"CREATE TABLE IF NOT EXISTS rescue_operation_workers (id {pk}, operation_id INTEGER NOT NULL, "
            "worker_name VARCHAR(200) NOT NULL, worker_key VARCHAR(200) NOT NULL, "
            "assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, released_at TIMESTAMP NULL)"
        )
        idx1 = (
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_row_active_worker "
            "ON rescue_operation_workers(worker_key) WHERE released_at IS NULL"
        )
        idx2 = "CREATE INDEX IF NOT EXISTS ix_row_operation ON rescue_operation_workers(operation_id)"
        key_expr = "LOWER(TRIM(t.assigned_team))"
        key_inner = "LOWER(TRIM(assigned_team))"
        trim_inner = "TRIM(assigned_team)"
        ts = "COALESCE(t.created_at, CURRENT_TIMESTAMP)"
    backfill = _COMMON_BACKFILL.format(key=key_expr, key_inner=key_inner, trim_inner=trim_inner, ts=ts)
    return [create, idx1, idx2, backfill]


def ensure_tables(conn, cursor, db_type):
    """Additive + guarded. Only called when FMS_CREATE_ASSIGNMENT_TABLES=1."""
    for statement in ddl_statements(db_type):
        cursor.execute(statement)
    conn.commit()
    _ready_cache["value"] = False
