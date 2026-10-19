-- Public Advisory notifications: additive, idempotent migration.
-- Creates two NEW tables only. Does not touch, alter, copy or delete any existing table or row.
-- Run ONLY the section that matches your main database engine.

-- ============ SQL Server ============
IF OBJECT_ID('advisory_notifications', 'U') IS NULL
CREATE TABLE advisory_notifications (
  advisory_id INT NOT NULL PRIMARY KEY,
  title NVARCHAR(255) NOT NULL,
  message NVARCHAR(MAX) NOT NULL,
  region NVARCHAR(255) NULL,
  issued_by NVARCHAR(255) NULL,
  created_at VARCHAR(40) NOT NULL
);
GO
IF OBJECT_ID('advisory_notification_reads', 'U') IS NULL
CREATE TABLE advisory_notification_reads (
  email NVARCHAR(255) NOT NULL,
  advisory_id INT NOT NULL,
  read_at VARCHAR(40) NOT NULL,
  CONSTRAINT PK_advisory_notification_reads PRIMARY KEY (email, advisory_id)
);
GO

-- ============ PostgreSQL ============
CREATE TABLE IF NOT EXISTS advisory_notifications (
  advisory_id INTEGER PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  region VARCHAR(255),
  issued_by VARCHAR(255),
  created_at VARCHAR(40) NOT NULL
);
CREATE TABLE IF NOT EXISTS advisory_notification_reads (
  email VARCHAR(255) NOT NULL,
  advisory_id INTEGER NOT NULL,
  read_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (email, advisory_id)
);

-- ============ SQLite (local development only) ============
CREATE TABLE IF NOT EXISTS advisory_notifications (
  advisory_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  region TEXT,
  issued_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS advisory_notification_reads (
  email TEXT NOT NULL,
  advisory_id INTEGER NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (email, advisory_id)
);
