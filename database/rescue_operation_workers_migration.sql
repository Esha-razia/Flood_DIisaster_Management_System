-- Multi-worker rescue assignment: ADDITIVE, GUARDED migration. NOT executed automatically.
-- Creates one new table + indexes and copies current single-worker assignments (active ops only).
-- Does not alter/drop/delete anything; rescue_operations.assigned_team is kept as-is.
-- Run ONLY the section for your engine. Safe to re-run.
-- Alternative: start the backend once with FMS_CREATE_ASSIGNMENT_TABLES=1 (runs the same statements).

-- ======================= SQLite / PostgreSQL =======================
-- (PostgreSQL: use SERIAL PRIMARY KEY instead of INTEGER PRIMARY KEY AUTOINCREMENT)
CREATE TABLE IF NOT EXISTS rescue_operation_workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id INTEGER NOT NULL,
    worker_name VARCHAR(200) NOT NULL,
    worker_key VARCHAR(200) NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMP NULL
);
-- One worker can hold only ONE active (unreleased) assignment.
CREATE UNIQUE INDEX IF NOT EXISTS ux_row_active_worker
    ON rescue_operation_workers(worker_key) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_row_operation ON rescue_operation_workers(operation_id);

-- Preserve existing single-worker assignments of ACTIVE operations (one per worker, newest wins).
INSERT INTO rescue_operation_workers (operation_id, worker_name, worker_key, assigned_at)
SELECT t.id, t.assigned_team, LOWER(TRIM(t.assigned_team)), COALESCE(t.created_at, CURRENT_TIMESTAMP)
FROM (
    SELECT id, assigned_team, created_at,
           ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(assigned_team)) ORDER BY created_at DESC, id DESC) AS rn
    FROM rescue_operations
    WHERE status IN ('Assigned', 'In Progress')
      AND assigned_team IS NOT NULL
      AND TRIM(assigned_team) <> ''
      AND LOWER(TRIM(assigned_team)) <> 'unassigned'
) t
WHERE t.rn = 1
  AND NOT EXISTS (
      SELECT 1 FROM rescue_operation_workers w
      WHERE w.operation_id = t.id
         OR (w.worker_key = LOWER(TRIM(t.assigned_team)) AND w.released_at IS NULL)
  );

-- ============================ SQL Server ============================
IF OBJECT_ID(N'dbo.rescue_operation_workers', N'U') IS NULL
CREATE TABLE dbo.rescue_operation_workers (
    id INT IDENTITY(1,1) PRIMARY KEY,
    operation_id INT NOT NULL,
    worker_name NVARCHAR(200) NOT NULL,
    worker_key NVARCHAR(200) NOT NULL,
    assigned_at DATETIME NOT NULL DEFAULT GETDATE(),
    released_at DATETIME NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_row_active_worker'
               AND object_id = OBJECT_ID(N'dbo.rescue_operation_workers'))
CREATE UNIQUE INDEX ux_row_active_worker ON dbo.rescue_operation_workers(worker_key) WHERE released_at IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_row_operation'
               AND object_id = OBJECT_ID(N'dbo.rescue_operation_workers'))
CREATE INDEX ix_row_operation ON dbo.rescue_operation_workers(operation_id);
GO
INSERT INTO rescue_operation_workers (operation_id, worker_name, worker_key, assigned_at)
SELECT t.id, t.assigned_team, LOWER(LTRIM(RTRIM(t.assigned_team))), COALESCE(t.created_at, GETDATE())
FROM (
    SELECT id, assigned_team, created_at,
           ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(assigned_team))) ORDER BY created_at DESC, id DESC) AS rn
    FROM rescue_operations
    WHERE status IN ('Assigned', 'In Progress')
      AND assigned_team IS NOT NULL
      AND LTRIM(RTRIM(assigned_team)) <> ''
      AND LOWER(LTRIM(RTRIM(assigned_team))) <> 'unassigned'
) t
WHERE t.rn = 1
  AND NOT EXISTS (
      SELECT 1 FROM rescue_operation_workers w
      WHERE w.operation_id = t.id
         OR (w.worker_key = LOWER(LTRIM(RTRIM(t.assigned_team))) AND w.released_at IS NULL)
  );
GO
