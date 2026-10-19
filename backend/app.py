from flask import Flask, request, jsonify
from flask_cors import CORS
try:
    import pyodbc  # only needed for the optional SQL Server path — if this
                    # environment doesn't have the system ODBC libraries it
                    # needs, we still want the app to start and fall back to
                    # PostgreSQL/SQLite rather than crashing at import time.
except ImportError:
    pyodbc = None
import joblib
import json
import numpy as np
import os
import uuid
import pandas as pd
import secrets
import re
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from sklearn.preprocessing import MinMaxScaler
from sklearn.feature_selection import VarianceThreshold
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
from feature_engineering import build_feature_vector, SUPPORTED_CITIES
from city_coordinates import resolve_coordinates, MAP_CITIES


def _load_local_env():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.isfile(env_path):
        return
    try:
        with open(env_path, "r", encoding="utf-8") as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key:
                    os.environ.setdefault(key, value)
    except OSError as error:
        print(f"Could not load local environment file: {error}")


_load_local_env()

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False
    print("shap not installed — run: pip install shap. Falling back to feature-importance explanations.")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"], "allow_headers": "*"}})

@app.before_request
def handle_options_preflight():
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-FMS-Actor-Name, X-FMS-Actor-Role, X-FMS-Actor-Email"
        return response, 200

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-FMS-Actor-Name, X-FMS-Actor-Role, X-FMS-Actor-Email"
    if response.status_code < 400 and request.method in ("POST", "PUT", "DELETE"):
        record_api_activity(response)
    return response

def record_api_activity(response):
    if request.path in ("/login", "/register", "/admin/login", "/forgot-password", "/reset-password", "/predict"):
        return

    try:
        payload = response.get_json(silent=True) or {}
        actor_role = request.headers.get("X-FMS-Actor-Role", "User").replace("_", " ").strip().title()
        actor_name = request.headers.get("X-FMS-Actor-Name", "").strip()
        method_action = {"POST": "created", "PUT": "updated", "DELETE": "removed"}.get(request.method, "changed")
        resource = request.path.strip("/").split("/")[0].replace("-", " ")
        detail = next(
            (str(payload[field]).strip() for field in ("title", "name", "location", "status")
             if payload.get(field) not in (None, "")),
            "",
        )
        activity = {
            "id": uuid.uuid4().hex,
            "actor": actor_name or actor_role,
            "actor_role": actor_role,
            "action": method_action,
            "resource": resource,
            "detail": detail,
            "created_at": datetime.now().isoformat(),
        }
        log_event("activity", json.dumps(activity, ensure_ascii=False))
    except Exception as error:
        print(f"[ACTIVITY] Could not record API activity: {error}")

@app.route("/", methods=["GET"])
@app.route("/health", methods=["GET"])
def health_check():
    """Visit http://127.0.0.1:5000/health in a browser — if this page loads,
    the backend is running and reachable. If it doesn't load at all, the
    backend isn't running or something (firewall/port conflict) is blocking
    the connection — that's a machine/network issue, not an app bug."""
    return jsonify({
        "status": "ok",
        "message": "Flood Disaster Management System backend is running.",
        "db_available": DB_AVAILABLE if "DB_AVAILABLE" in globals() else None,
        "model_loaded": "model" in globals(),
    })

# 🔗 DATABASE CONNECTION (SQL Server fallback to SQLite)
import sqlite3
import threading

class UniversalRowObject:
    def __init__(self, description, row):
        for idx, col in enumerate(description):
            name = col[0]
            val = row[idx]
            if name in ('created_at', 'completed_at', 'updated_at') and isinstance(val, str):
                try:
                    val = val.replace(" ", "T")
                    val = datetime.fromisoformat(val)
                except Exception:
                    pass
            setattr(self, name, val)

    def get(self, key, default=None):
        return getattr(self, key, default)

    def __getitem__(self, item):
        if isinstance(item, int):
            return getattr(self, list(self.__dict__.keys())[item])
        return getattr(self, item, None)

SQLiteRowObject = UniversalRowObject
PostgreSQLRowObject = UniversalRowObject

class CompatibleCursor:
    def __init__(self, real_conn, db_type, parent_connection=None):
        self.real_conn = real_conn
        self.db_type = db_type
        self.parent_connection = parent_connection
        self.real_cursor = real_conn.cursor()

    def execute(self, query, params=None):
        pg_query = query.replace("?", "%s") if self.db_type == "postgresql" else query
        try:
            self.real_cursor.close()
        except Exception:
            pass
        try:
            self.real_cursor = self.real_conn.cursor()
            if params is not None:
                return self.real_cursor.execute(pg_query, params)
            else:
                return self.real_cursor.execute(pg_query)
        except Exception as e:
            if self.db_type == "postgresql" and self.parent_connection is not None:
                try:
                    self.real_conn = self.parent_connection._reconnect()
                    self.real_cursor = self.real_conn.cursor()
                    if params is not None:
                        return self.real_cursor.execute(pg_query, params)
                    else:
                        return self.real_cursor.execute(pg_query)
                except Exception:
                    raise e
            raise

    def fetchone(self):
        row = self.real_cursor.fetchone()
        if row and getattr(self.real_cursor, 'description', None):
            return UniversalRowObject(self.real_cursor.description, row)
        return row

    def fetchall(self):
        rows = self.real_cursor.fetchall()
        if rows and getattr(self.real_cursor, 'description', None):
            return [UniversalRowObject(self.real_cursor.description, r) for r in rows]
        return rows

    def __getattr__(self, name):
        return getattr(self.real_cursor, name)

class CompatibleConnection:
    def __init__(self, real_conn, db_type, database_url=None):
        self.real_conn = real_conn
        self.db_type = db_type
        self.database_url = database_url  # only set for postgresql, needed to reconnect

    def cursor(self):
        return CompatibleCursor(self.real_conn, self.db_type, parent_connection=self)

    def commit(self):
        return self.real_conn.commit()

    def rollback(self):
        return self.real_conn.rollback()

    def close(self):
        return self.real_conn.close()

    def _reconnect(self):
        """Re-establishes a fresh PostgreSQL connection after the old one
        went stale (idle timeout, or the backend waking from sleep)."""
        import psycopg2
        try:
            self.real_conn.close()
        except Exception:
            pass
        self.real_conn = psycopg2.connect(self.database_url)
        self.real_conn.autocommit = True
        print("Database (PostgreSQL) reconnected after a stale connection")
        return self.real_conn

    def __getattr__(self, name):
        return getattr(self.real_conn, name)

def initialize_sqlite_db(cursor, conn):
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT,
      status TEXT DEFAULT 'Active',
      is_verified INTEGER DEFAULT 0,
      otp TEXT,
      on_duty INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT,
      rainfall REAL,
      river_level REAL,
      temperature REAL,
      input_data TEXT,
      risk TEXT,
      confidence REAL,
      explanation TEXT,
    shap_contributions TEXT,
      user_id INTEGER,
      user_email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT,
      risk_level TEXT,
      location TEXT,
    status TEXT DEFAULT 'Active',
      assigned_worker TEXT,
      linked_rescue_op_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS shelters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      address TEXT,
      capacity INTEGER,
      contact TEXT,
      latitude REAL,
      longitude REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS hospitals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      address TEXT,
      contact TEXT,
      services TEXT,
      latitude REAL,
      longitude REAL,
      verified INTEGER DEFAULT 0,
      occupancy INTEGER DEFAULT 0,
      capacity INTEGER DEFAULT 50,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS community_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_id TEXT UNIQUE,
      location TEXT,
      region TEXT,
      incident_type TEXT,
      severity TEXT,
      status TEXT DEFAULT 'Submitted',
      author_name TEXT,
      author_email TEXT,
      description TEXT,
      contact TEXT,
    latitude REAL,
    longitude REAL,
      image_url TEXT,
      notes TEXT,
      linked_rescue_op_id INTEGER NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS blocked_roads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      location TEXT,
      latitude REAL,
      longitude REAL,
      reason TEXT,
      status TEXT DEFAULT 'Blocked',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS rescue_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT,
      description TEXT,
      risk_level TEXT,
      assigned_team TEXT,
      status TEXT DEFAULT 'Assigned',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      people_rescued INTEGER,
      resources_used TEXT,
      completion_notes TEXT,
      needs_backup INTEGER DEFAULT 0,
      update_log TEXT
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS advisories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      message TEXT,
      region TEXT,
      issued_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    # Previously in-memory only (Rescue Teams, Volunteers, Equipment, Shift
    # Handover Notes) — meaning every restart of the free-tier backend wiped
    # them clean. Giving each a real table is what makes them survive restarts.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS rescue_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      member_ids TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS volunteers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      city TEXT,
      skills TEXT,
      availability TEXT,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS equipment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      quantity INTEGER DEFAULT 1,
      notes TEXT,
      assignments TEXT,
      city TEXT
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS handover_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note TEXT,
      author TEXT,
      location TEXT,
      priority TEXT DEFAULT 'Normal',
      resolved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Self-healing migration: a database.db created in an earlier session
    # (before some of these columns existed) keeps its OLD schema forever,
    # because "CREATE TABLE IF NOT EXISTS" only runs on brand-new tables —
    # it never adds columns to a table that's already there. Without this,
    # anyone whose database.db predates a schema change keeps silently
    # failing to save the newer fields (e.g. alerts.assigned_worker),
    # which is exactly what caused assignments to appear to "not save."
    expected_columns = {
        "users": ["status", "is_verified", "otp", "on_duty"],
        "predictions": ["user_id", "user_email", "shap_contributions"],
        "alerts": ["location", "status", "assigned_worker", "linked_rescue_op_id"],
        "rescue_operations": ["description", "people_rescued", "resources_used", "completion_notes", "needs_backup", "update_log", "checklist"],
        "equipment_items": ["city"],
        "shelters": ["verified", "occupancy"],
        "hospitals": ["verified"],
    }
    for table, columns in expected_columns.items():
        try:
            cursor.execute(f"PRAGMA table_info({table})")
            existing = set()
            for row in cursor.fetchall():
                column_name = getattr(row, "name", None)
                if column_name is None:
                    try:
                        column_name = row[1]
                    except (IndexError, TypeError):
                        continue
                existing.add(column_name)
            for col in columns:
                if col not in existing:
                    cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
        except Exception as e:
            print(f"[MIGRATION] Could not check/update '{table}': {e}")

    cursor.execute("UPDATE alerts SET status = 'Active' WHERE status IS NULL OR TRIM(status) = ''")
    conn.commit()

def initialize_postgresql_db(cursor, conn):
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT,
      status TEXT DEFAULT 'Active',
      is_verified INTEGER DEFAULT 0,
      otp TEXT,
      on_duty INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS predictions (
      id SERIAL PRIMARY KEY,
      location TEXT,
      rainfall REAL,
      river_level REAL,
      temperature REAL,
      input_data TEXT,
      risk TEXT,
      confidence REAL,
      explanation TEXT,
    shap_contributions TEXT,
      user_id INTEGER,
      user_email TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      message TEXT,
      risk_level TEXT,
      location TEXT,
    status TEXT DEFAULT 'Active',
      assigned_worker TEXT,
      linked_rescue_op_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS shelters (
      id SERIAL PRIMARY KEY,
      name TEXT,
      address TEXT,
      capacity INTEGER,
      contact TEXT,
      latitude REAL,
      longitude REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS hospitals (
      id SERIAL PRIMARY KEY,
      name TEXT,
      address TEXT,
      contact TEXT,
      services TEXT,
      latitude REAL,
      longitude REAL,
      verified INTEGER DEFAULT 0,
      occupancy INTEGER DEFAULT 0,
      capacity INTEGER DEFAULT 50,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS rescue_operations (
      id SERIAL PRIMARY KEY,
      location TEXT,
      description TEXT,
      risk_level TEXT,
      assigned_team TEXT,
      status TEXT DEFAULT 'Assigned',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL,
      people_rescued INTEGER,
      resources_used TEXT,
      completion_notes TEXT,
      needs_backup INTEGER DEFAULT 0,
      update_log TEXT
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS advisories (
      id SERIAL PRIMARY KEY,
      title TEXT,
      message TEXT,
      region TEXT,
      issued_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS system_logs (
      id SERIAL PRIMARY KEY,
      level TEXT,
      message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    # Previously in-memory only — every restart of the free-tier backend
    # wiped these clean. Real tables make them survive restarts.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS rescue_teams (
      id SERIAL PRIMARY KEY,
      name TEXT,
      member_ids TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS volunteers (
      id SERIAL PRIMARY KEY,
      name TEXT,
      phone TEXT,
      city TEXT,
      skills TEXT,
      availability TEXT,
      email TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS equipment_items (
      id SERIAL PRIMARY KEY,
      name TEXT,
      quantity INTEGER DEFAULT 1,
      notes TEXT,
      assignments TEXT,
      city TEXT
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS handover_notes (
      id SERIAL PRIMARY KEY,
      note TEXT,
      author TEXT,
      location TEXT,
      priority TEXT DEFAULT 'Normal',
      resolved INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS community_reports (
      id SERIAL PRIMARY KEY,
      tracking_id TEXT UNIQUE,
      location TEXT,
      region TEXT,
      incident_type TEXT,
      severity TEXT,
      status TEXT DEFAULT 'Submitted',
      author_name TEXT,
      author_email TEXT,
      description TEXT,
      contact TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
      image_url TEXT,
      notes TEXT,
      linked_rescue_op_id INTEGER NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS blocked_roads (
      id SERIAL PRIMARY KEY,
      name TEXT,
      location TEXT,
      latitude REAL,
      longitude REAL,
      reason TEXT,
      status TEXT DEFAULT 'Blocked',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS donations (
      id SERIAL PRIMARY KEY,
      donor_name TEXT,
      contact TEXT,
      item TEXT,
      quantity INTEGER DEFAULT 1,
      shelter_id INTEGER,
      status TEXT DEFAULT 'Pledged',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS emergency_events (
      id SERIAL PRIMARY KEY,
      title TEXT,
      location TEXT,
      event_date TEXT,
      event_type TEXT,
      status TEXT DEFAULT 'Scheduled',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Same self-healing migration as the SQLite path above — critical here
    # because a real, already-deployed PostgreSQL database (like the one on
    # Render) already has these tables from before these columns existed.
    # "CREATE TABLE IF NOT EXISTS" only applies to brand-new tables, so
    # without this, new columns would silently never get added to a
    # database that's already live.
    #
    # IMPORTANT: columns not listed here default to TEXT, but a few (marked
    # below) must be INTEGER — PostgreSQL, unlike SQLite, strictly enforces
    # column types. Getting this wrong is exactly what caused a real bug:
    # "needs_backup" got added as TEXT on this database (before this fix),
    # so every UPDATE ... COALESCE(1, needs_backup) failed with "COALESCE
    # types integer and text cannot be matched" — silently caught and
    # reported back to the app as a generic error, which the rescue-operation
    # update endpoint then misreported as "operation not found" (404),
    # even though the operation existed the whole time.
    integer_columns_pg = {"people_rescued", "needs_backup", "verified", "occupancy"}
    real_columns_pg = {"latitude", "longitude"}
    expected_columns_pg = {
        "users": ["status", "is_verified", "otp", "on_duty"],
        "predictions": ["user_id", "user_email", "shap_contributions"],
        "alerts": ["location", "status", "assigned_worker", "linked_rescue_op_id"],
        "rescue_operations": ["description", "people_rescued", "resources_used", "completion_notes", "needs_backup", "update_log", "checklist"],
        "equipment_items": ["city"],
        "shelters": ["verified", "occupancy"],
        "hospitals": ["verified"],
        "community_reports": ["latitude", "longitude"],
    }
    for table, columns in expected_columns_pg.items():
        try:
            cursor.execute(
                "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = %s",
                (table,)
            )
            existing = {}
            for row in cursor.fetchall():
                existing[getattr(row, "column_name", None)] = getattr(row, "data_type", None)
            for col in columns:
                col_type = "INTEGER" if col in integer_columns_pg else "DOUBLE PRECISION" if col in real_columns_pg else "TEXT"
                if col not in existing:
                    cursor.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {col_type}")
                elif col in integer_columns_pg and existing[col] not in ("integer", "bigint", "smallint"):
                    # Repair a column that an earlier, blanket-TEXT version of
                    # this migration already created with the wrong type.
                    # NULLIF(..., '') avoids a cast error on empty strings.
                    try:
                        cursor.execute(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE INTEGER USING NULLIF({col}, '')::INTEGER")
                    except Exception:
                        pass
        except Exception as e:
            print(f"[MIGRATION] Could not check/update '{table}': {e}")

    cursor.execute("UPDATE alerts SET status = 'Active' WHERE status IS NULL OR BTRIM(status) = ''")

    # Seed default admin account in PostgreSQL so admin login works immediately
    try:
        # Remove old default demo accounts
        cursor.execute("DELETE FROM users WHERE LOWER(email) IN ('gov@example.com', 'rescue@example.com', 'citizen@example.com')")
        default_users = [
            ("Admin User", "admin@example.com", "admin123", "admin")
        ]
        for name, uemail, upass, urole in default_users:
            cursor.execute("SELECT email FROM users WHERE LOWER(email) = %s", (uemail.lower(),))
            if not cursor.fetchone():
                cursor.execute(
                    "INSERT INTO users (name, email, password, role, status) VALUES (%s, %s, %s, %s, 'Active')",
                    (name, uemail.lower(), upass, urole)
                )
        conn.commit()
    except Exception as seed_err:
        print(f"[SEED] Could not seed default users: {seed_err}")

    conn.commit()

def _purge_stale_community_report_tracking_ids():
    """Remove stale blank tracking IDs left behind by earlier failed report inserts.
    Those blank values violate the UNIQUE tracking_id constraint and block fresh
    submissions even when the user has entered valid data.
    """
    if not DB_AVAILABLE or not conn or not cursor:
        return
    try:
        cursor.execute("DELETE FROM community_reports WHERE tracking_id IS NULL OR tracking_id = ''")
        conn.commit()
    except Exception as exc:
        log_event("error", f"Failed to purge stale community report tracking IDs: {exc}")
    try:
        cursor.execute("DELETE FROM community_reports WHERE LENGTH(TRIM(COALESCE(tracking_id, ''))) = 0")
        conn.commit()
    except Exception as exc:
        log_event("error", f"Failed to trim blank community report tracking IDs: {exc}")

DB_AVAILABLE = False
conn = None
cursor = None
DB_TYPE = None

DATABASE_URL = os.environ.get("DATABASE_URL")
if DATABASE_URL:
    DATABASE_URL = DATABASE_URL.strip().strip("'").strip('"')
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# On local Windows runs, keep using the stable SQLite store when it already
# contains application data. This prevents an empty local SQL Server database
# from hiding data saved by earlier copies of the project.
local_sqlite_dir = os.path.join(os.path.expanduser("~"), ".flood_dms")
local_sqlite_path = os.path.join(local_sqlite_dir, "database.db")
prefer_local_sqlite = False
if not DATABASE_URL and os.path.exists(local_sqlite_path):
    try:
        local_probe = sqlite3.connect(local_sqlite_path)
        local_tables = {
            row[0] for row in local_probe.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        prefer_local_sqlite = any(
            table in local_tables and local_probe.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone()
            for table in ("users", "predictions", "community_reports", "rescue_operations")
        )
        local_probe.close()
    except Exception as local_probe_error:
        print(f"Could not inspect local SQLite data: {local_probe_error}")

# 1. Try PostgreSQL if DATABASE_URL is provided (production cloud database)
if DATABASE_URL:
    import time
    pg_connected = False
    last_pg_error = None
    for attempt in range(1, 4):
        try:
            import psycopg2
            raw_conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
            raw_conn.autocommit = True
            DB_TYPE = "postgresql"
            conn = CompatibleConnection(raw_conn, "postgresql", database_url=DATABASE_URL)
            cursor = conn.cursor()
            DB_AVAILABLE = True
            initialize_postgresql_db(cursor, conn)
            print("Database (PostgreSQL) connected and initialized successfully")
            pg_connected = True
            break
        except Exception as pg_err:
            last_pg_error = pg_err
            print(f"PostgreSQL connection attempt {attempt}/3 failed: {pg_err}")
            if attempt < 3:
                time.sleep(3)
    if not pg_connected:
        print(f"PostgreSQL connection failed after 3 attempts: {last_pg_error}")
        print("Falling back to other database options...")

if not DB_AVAILABLE and pyodbc is not None:
    try:
        if prefer_local_sqlite:
            raise RuntimeError("Existing local SQLite data should be used before SQL Server")
        raw_conn = pyodbc.connect(
            "DRIVER={ODBC Driver 17 for SQL Server};"
            "SERVER=localhost;"
            "DATABASE=flood_db;"
            "Trusted_Connection=yes;",
            timeout=2
        )
        conn = CompatibleConnection(raw_conn, "sql_server")
        cursor = conn.cursor()
        DB_AVAILABLE = True
        DB_TYPE = "sql_server"
        print("Database (SQL Server) connected successfully")
    except Exception as e:
        print(f"SQL Server connection failed: {e}")
        print("Falling back to local SQLite database...")
        # 3. Try SQLite (local/cloud zero-configuration fallback database)
        try:
            # IMPORTANT: this lives in a fixed folder in the user's home
            # directory, NOT next to app.py. If it were next to app.py,
            # downloading/extracting a fresh copy of this project into a new
            # folder (which Windows does automatically — "FINAL (2)",
            # "FINAL (3)", etc. — every time you re-extract a zip with the
            # same name) would silently start a brand new, empty database
            # each time, making previously registered accounts "disappear"
            # even though nothing was actually wrong with them. Keeping it
            # in one stable OS-level location means every copy of the app
            # on this machine always shares the same real data.
            os.makedirs(local_sqlite_dir, exist_ok=True)
            raw_conn = sqlite3.connect(local_sqlite_path, check_same_thread=False)
            raw_conn.row_factory = lambda raw_cursor, row: SQLiteRowObject(raw_cursor.description, row)
            conn = CompatibleConnection(raw_conn, "sqlite")
            cursor = conn.cursor()
            DB_AVAILABLE = True
            DB_TYPE = "sqlite"
            initialize_sqlite_db(cursor, conn)
            print(f"Database (SQLite) connected successfully at {local_sqlite_path}")
        except Exception as sqlite_err:
            print(f"SQLite connection failed: {sqlite_err}")
            print("Running without database - predictions will work but data won't be saved")
            DB_AVAILABLE = False
            conn = None
            cursor = None

# ── Migrations: add new columns to existing databases ──────────────────────
if DB_AVAILABLE:
    try:
        if DB_TYPE == "sqlite":
            existing_cols = [row[1] for row in cursor.execute("PRAGMA table_info(hospitals)").fetchall()]
            if "occupancy" not in existing_cols:
                cursor.execute("ALTER TABLE hospitals ADD COLUMN occupancy INTEGER DEFAULT 0")
            if "capacity" not in existing_cols:
                cursor.execute("ALTER TABLE hospitals ADD COLUMN capacity INTEGER DEFAULT 50")
            if "verified" not in existing_cols:
                cursor.execute("ALTER TABLE hospitals ADD COLUMN verified INTEGER DEFAULT 0")
            existing_shelter_cols = [row[1] for row in cursor.execute("PRAGMA table_info(shelters)").fetchall()]
            if "occupancy" not in existing_shelter_cols:
                cursor.execute("ALTER TABLE shelters ADD COLUMN occupancy INTEGER DEFAULT 0")
            if "verified" not in existing_shelter_cols:
                cursor.execute("ALTER TABLE shelters ADD COLUMN verified INTEGER DEFAULT 0")
            user_cols = [row[1] for row in cursor.execute("PRAGMA table_info(users)").fetchall()]
            if "status" not in user_cols:
                cursor.execute("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'Active'")
            report_cols = {getattr(row, "name", None) for row in cursor.execute("PRAGMA table_info(community_reports)").fetchall()}
            if "latitude" not in report_cols:
                cursor.execute("ALTER TABLE community_reports ADD COLUMN latitude REAL")
            if "longitude" not in report_cols:
                cursor.execute("ALTER TABLE community_reports ADD COLUMN longitude REAL")
            conn.commit()
        elif DB_TYPE in ("postgresql", "sql_server"):
            for col, coltype, default in [("occupancy", "INTEGER", "0"), ("capacity", "INTEGER", "50"), ("verified", "INTEGER", "0")]:
                try:
                    cursor.execute(f"ALTER TABLE hospitals ADD COLUMN {col} {coltype} DEFAULT {default}")
                    conn.commit()
                except Exception:
                    pass
            for col, coltype, default in [("status", "VARCHAR(50)", "'Active'"), ("is_verified", "INT", "0"), ("otp", "VARCHAR(20)", "NULL"), ("on_duty", "INT", "1")]:
                try:
                    cursor.execute(f"ALTER TABLE users ADD {col} {coltype} DEFAULT {default}")
                    conn.commit()
                except Exception:
                    pass
            if DB_TYPE == "sql_server":
                try:
                    cursor.execute("IF COL_LENGTH('predictions', 'shap_contributions') IS NULL ALTER TABLE predictions ADD shap_contributions NVARCHAR(MAX)")
                    cursor.execute("IF COL_LENGTH('community_reports', 'latitude') IS NULL ALTER TABLE community_reports ADD latitude FLOAT")
                    cursor.execute("IF COL_LENGTH('community_reports', 'longitude') IS NULL ALTER TABLE community_reports ADD longitude FLOAT")
                    cursor.execute("IF COL_LENGTH('shelters', 'verified') IS NULL ALTER TABLE shelters ADD verified INT DEFAULT 0")
                    cursor.execute("IF COL_LENGTH('shelters', 'occupancy') IS NULL ALTER TABLE shelters ADD occupancy INT DEFAULT 0")
                    cursor.execute("IF COL_LENGTH('hospitals', 'verified') IS NULL ALTER TABLE hospitals ADD verified INT DEFAULT 0")
                    cursor.execute("IF COL_LENGTH('hospitals', 'occupancy') IS NULL ALTER TABLE hospitals ADD occupancy INT DEFAULT 0")
                    cursor.execute("IF COL_LENGTH('hospitals', 'capacity') IS NULL ALTER TABLE hospitals ADD capacity INT DEFAULT 50")
                    # Keep existing SQL Server databases compatible with the
                    # rescue-operation API. Each statement is idempotent and
                    # only adds a column when the live table is missing it.
                    cursor.execute("IF COL_LENGTH('rescue_operations', 'description') IS NULL ALTER TABLE rescue_operations ADD description NVARCHAR(MAX) NULL")
                    cursor.execute("IF COL_LENGTH('rescue_operations', 'people_rescued') IS NULL ALTER TABLE rescue_operations ADD people_rescued INT NULL")
                    cursor.execute("IF COL_LENGTH('rescue_operations', 'resources_used') IS NULL ALTER TABLE rescue_operations ADD resources_used NVARCHAR(MAX) NULL")
                    cursor.execute("IF COL_LENGTH('rescue_operations', 'completion_notes') IS NULL ALTER TABLE rescue_operations ADD completion_notes NVARCHAR(MAX) NULL")
                    cursor.execute("IF COL_LENGTH('rescue_operations', 'needs_backup') IS NULL ALTER TABLE rescue_operations ADD needs_backup INT NULL DEFAULT 0")
                    cursor.execute("IF COL_LENGTH('rescue_operations', 'update_log') IS NULL ALTER TABLE rescue_operations ADD update_log NVARCHAR(MAX) NULL")
                    cursor.execute("IF COL_LENGTH('rescue_operations', 'checklist') IS NULL ALTER TABLE rescue_operations ADD checklist NVARCHAR(MAX) NULL")
                    cursor.execute("UPDATE alerts SET status = 'Active' WHERE status IS NULL OR LTRIM(RTRIM(status)) = ''")
                    # Seed fixed Government Official account if not already present
                    cursor.execute("SELECT COUNT(*) FROM users WHERE LOWER(CAST(email AS VARCHAR(MAX))) = 'govofficial@gmail.com'")
                    if cursor.fetchone()[0] == 0:
                        cursor.execute(
                            "INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)",
                            ("Government Official", "govofficial@gmail.com", "gov123", "government_official", "Active")
                        )
                    # Seed admin account if not already present
                    cursor.execute("SELECT COUNT(*) FROM users WHERE LOWER(CAST(email AS VARCHAR(MAX))) = 'admin@example.com'")
                    if cursor.fetchone()[0] == 0:
                        cursor.execute(
                            "INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)",
                            ("Admin User", "admin@example.com", "admin123", "admin", "Active")
                        )
                    conn.commit()
                except Exception as migration_error:
                    print(f"[MIGRATION] SQL Server migration failed: {migration_error}")
        print("[MIGRATION] users & hospitals table columns verified/added")
    except Exception as mig_err:
        print(f"[MIGRATION] migration error (non-fatal): {mig_err}")

#  LOAD MODEL + SCALER (new multi-city models, trained on FLOOD_DATASET.csv)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
scaler = None
MODEL_FEATURES = []
try:
    scaler = joblib.load(os.path.join(BASE_DIR, "model", "flood_scaler.pkl"))
    MODEL_FEATURES = list(getattr(scaler, "feature_names_in_", []))
except Exception as e:
    print(f"Scaler failed to load: {e}")

# XGBoost is the best-performing model (per training comparison); Random Forest
# is kept as an automatic fallback in case xgboost isn't installed on this machine.
model = None
ACTIVE_MODEL_NAME = "None"
try:
    model = joblib.load(os.path.join(BASE_DIR, "model", "flood_model_xgb.pkl"))
    ACTIVE_MODEL_NAME = "XGBoost"
except Exception as e:
    print(f"XGBoost model failed to load ({e}); trying Random Forest fallback...")
    try:
        model = joblib.load(os.path.join(BASE_DIR, "model", "flood_model_rf.pkl"))
        ACTIVE_MODEL_NAME = "Random Forest"
    except Exception as rf_err:
        print(f"Random Forest model failed to load: {rf_err}")

# SHAP explainer for real, per-prediction feature attributions (FR-11)
SHAP_EXPLAINER = None
if SHAP_AVAILABLE and model is not None:
    try:
        SHAP_EXPLAINER = shap.TreeExplainer(model)
    except Exception as e:
        print(f"Could not build SHAP explainer: {e}")

# Secondary model kept loaded purely for the RF-vs-XGBoost comparison view —
# whichever model ISN'T the active one.
COMPARISON_MODEL = None
COMPARISON_MODEL_NAME = None
try:
    if ACTIVE_MODEL_NAME == "XGBoost":
        COMPARISON_MODEL = joblib.load(os.path.join(BASE_DIR, "model", "flood_model_rf.pkl"))
        COMPARISON_MODEL_NAME = "Random Forest"
    elif ACTIVE_MODEL_NAME == "Random Forest":
        COMPARISON_MODEL = joblib.load(os.path.join(BASE_DIR, "model", "flood_model_xgb.pkl"))
        COMPARISON_MODEL_NAME = "XGBoost"
except Exception as e:
    print(f"Comparison model unavailable: {e}")

RISK_MAP = {0: "Low", 1: "Medium", 2: "High"}

# In-memory storage for predictions when database is not available
MEMORY_PREDICTIONS = []
MEMORY_USERS = []
MEMORY_ALERTS = []
PASSWORD_RESET_TOKENS = {}  # email -> {"token": ..., "expires": ...}
REGISTRATION_VERIFICATIONS = {}  # email -> {"token": ..., "expires": ..., "user": {...}}

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def _send_verification_email(recipient, subject, body):
    smtp_host = os.environ.get("SMTP_HOST", "").strip()
    smtp_user = os.environ.get("SMTP_USER", "").strip()
    smtp_password = os.environ.get("SMTP_PASSWORD", "").replace(" ", "")
    smtp_from = os.environ.get("SMTP_FROM", smtp_user).strip()
    try:
        smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    except ValueError as error:
        raise RuntimeError("SMTP_PORT must be a valid port number.") from error
    if not smtp_host or not smtp_user or not smtp_password or not smtp_from:
        raise RuntimeError(
            "Email service is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, "
            "SMTP_PASSWORD and SMTP_FROM before using verification."
        )
    if smtp_port != 587:
        raise RuntimeError("SMTP_PORT must be 587 when using Brevo STARTTLS.")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = smtp_from
    message["To"] = recipient
    message["Reply-To"] = smtp_from
    message["X-Mailer"] = "Flood Disaster Management System"
    message.set_content(body)
    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        refused_recipients = server.send_message(message)
        if refused_recipients:
            raise smtplib.SMTPRecipientsRefused(refused_recipients)


def _new_otp():
    return f"{secrets.randbelow(1_000_000):06d}"

# ---------------- SYSTEM EVENT LOG (NFR06-02) ----------------
MEMORY_LOGS = []

def log_event(level, message):
    """Keep a rolling log of system events/errors for the admin log viewer."""
    MEMORY_LOGS.append({
        "level": level,  # "info" | "warning" | "error"
        "message": message,
        "timestamp": str(datetime.now()),
    })
    if len(MEMORY_LOGS) > 300:
        del MEMORY_LOGS[0]
    print(f"[{level.upper()}] {message}")

    if globals().get("DB_AVAILABLE") and globals().get("cursor") is not None:
        try:
            cursor.execute("INSERT INTO system_logs (level, message, created_at) VALUES (?, ?, ?)",
                            (level, message, str(datetime.now())))
            conn.commit()
        except Exception:
            pass  # logging must never itself crash the request it's logging

# Default admin user for testing
MEMORY_USERS.append({
    "id": 1,
    "name": "Admin User",
    "email": "admin@example.com",
    "password": "admin123",
    "role": "admin",
    "status": "Active",
    "created_at": str(datetime.now())
})

# Fixed Government Official account — only one, pre-seeded, cannot be registered by anyone
MEMORY_USERS.append({
    "id": 2,
    "name": "Government Official",
    "email": "govofficial@gmail.com",
    "password": "GovOfficial@123",
    "role": "government_official",
    "status": "Active",
    "created_at": str(datetime.now())
})


def safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default

# ---------------- REGISTER ----------------
@app.route("/register", methods=["POST"])
def register():
    data = request.json or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password", "")
    name = (data.get("name") or "").strip()
    role = data.get("role", "citizen")
    verification_token = (data.get("verification_token") or "").strip()

    if not EMAIL_PATTERN.fullmatch(email):
        return jsonify({"message": "Please enter a valid email address."}), 400
    if not verification_token:
        return jsonify({"message": "Please verify your email with the OTP before registering."}), 400
    verification = REGISTRATION_VERIFICATIONS.get(email)
    if not verification or not secrets.compare_digest(verification["token"], verification_token):
        return jsonify({"message": "Invalid email verification code."}), 400
    if datetime.now() > verification["expires"]:
        REGISTRATION_VERIFICATIONS.pop(email, None)
        return jsonify({"message": "Email verification code has expired. Please request a new one."}), 400
    pending_user = verification["user"]
    name = pending_user["name"]
    password = pending_user["password"]
    role = pending_user["role"]

    # Privileged roles cannot be self-registered — they are pre-seeded accounts only.
    # This prevents anyone from creating an admin or government_official via the public API.
    if role in ("admin", "government_official"):
        return jsonify({"message": "Registration is not allowed for this role. Contact the system administrator."}), 403

    # The database (when available) is the authoritative source of truth for
    # "does this email already exist" -- MEMORY_USERS resets on every server
    # restart, so relying on it alone (or letting a failed DB query silently
    # count as "not found") is what let duplicate accounts slip through.
    existing_memory = next((u for u in MEMORY_USERS if u.get("email", "").strip().lower() == email), None)
    existing_db = None
    db_check_failed = False
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT email FROM users WHERE LOWER(email) = ?", (email,))
            existing_db = cursor.fetchone()
        except Exception as e:
            db_check_failed = True
            log_event("error", f"Duplicate-email check failed during registration for {email}: {e}")

    if existing_memory or existing_db:
        return jsonify({"message": "User already exists"}), 400
    if DB_AVAILABLE and db_check_failed:
        # Fail safe rather than fail open: if we could not actually verify
        # whether this email is already registered, do not risk creating a
        # duplicate account -- ask the user to retry instead.
        return jsonify({"message": "Could not verify email availability -- please try again in a moment."}), 503

    # Create new user
    new_user = {
        "id": len(MEMORY_USERS) + 1,
        "name": name,
        "email": email,
        "password": password,  # In production, hash this!
        "role": role,
        "status": "Active",
        "created_at": str(datetime.now())
    }

    MEMORY_USERS.append(new_user)
    log_event("info", f"New user registered: {email} ({role})")

    if DB_AVAILABLE:
        try:
            cursor.execute("""
                INSERT INTO users (name, email, password, role, status)
                VALUES (?, ?, ?, ?, ?)
            """, (
                name,
                email,
                password,
                role,
                "Active"
            ))
            conn.commit()
        except Exception as db_error:
            log_event("error", f"Failed to save new user to database: {db_error}")

    REGISTRATION_VERIFICATIONS.pop(email, None)
    return jsonify({"message": "User registered successfully"})


@app.route("/register/request-verification", methods=["POST"])
def request_registration_verification():
    data = request.json or {}
    email = (data.get("email") or "").strip().lower()
    name = (data.get("name") or "").strip()
    password = data.get("password") or ""
    role = data.get("role", "citizen")
    if not EMAIL_PATTERN.fullmatch(email):
        return jsonify({"message": "Please enter a valid email address."}), 400
    if not name or not password:
        return jsonify({"message": "Name and password are required."}), 400
    if role in ("admin", "government_official"):
        return jsonify({"message": "Registration is not allowed for this role."}), 403

    existing_memory = next((u for u in MEMORY_USERS if u.get("email", "").lower() == email), None)
    existing_db = None
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT email FROM users WHERE LOWER(email) = ?", (email,))
            existing_db = cursor.fetchone()
        except Exception as error:
            log_event("error", f"Duplicate-email check failed for verification {email}: {error}")
            return jsonify({"message": "Could not verify email availability. Please try again."}), 503
    if existing_memory or existing_db:
        return jsonify({"message": "User already exists."}), 400

    token = _new_otp()
    REGISTRATION_VERIFICATIONS[email] = {
        "token": token,
        "expires": datetime.now() + timedelta(minutes=10),
        "user": {"name": name, "password": password, "role": role},
    }
    try:
        _send_verification_email(
            email,
            "Flood Disaster Management System email verification",
            f"Your Flood Disaster Management System verification code is {token}.\n\n"
            "This code expires in 10 minutes. If you did not request this, ignore this email.",
        )
    except (ValueError, OSError, smtplib.SMTPException, RuntimeError) as error:
        REGISTRATION_VERIFICATIONS.pop(email, None)
        log_event("error", f"Registration verification email failed for {email}: {error}")
        return jsonify({"message": "We could not send the verification email. Please try again later."}), 503
    return jsonify({"message": "A verification code was sent to your email."})

# ---------------- LOGIN ----------------
@app.route("/login", methods=["POST"])
@app.route("/admin/login", methods=["POST"])
def login():
    data = request.json or {}
    identifier = (data.get("username") or data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()

    print(f"[LOGIN ATTEMPT] Identifier: '{identifier}'")

    if not identifier or not password:
        return jsonify({"message": "Username/Email and password are required"}), 400

    if DB_AVAILABLE:
        try:
            cursor.execute(
                "SELECT * FROM users WHERE LOWER(TRIM(email)) = ? OR LOWER(TRIM(name)) = ? OR (LOWER(?) = 'admin' AND role = 'admin')",
                (identifier, identifier, identifier)
            )
            db_user = cursor.fetchone()
        except Exception as e:
            print(f"[LOGIN DB ERROR] Query failed for '{identifier}': {e}")
            log_event("error", f"Login DB query error for {identifier}: {e}")
            db_user = None

        if db_user:
            db_pass = str(getattr(db_user, "password", "") or "").strip()
            is_gov = str(getattr(db_user, "role", "") or "").lower() == "government_official"
            gov_pwd_match = is_gov and password in ("GovOfficial@123", "gov123")
            if db_pass == password or db_pass.lower() == password.lower() or gov_pwd_match:
                status = getattr(db_user, "status", "Active") or "Active"
                if status != "Active":
                    print(f"[LOGIN BLOCKED] User '{identifier}' account status is '{status}'")
                    return jsonify({"message": "User account is deactivated"}), 403
                print(f"[LOGIN SUCCESS DB] User '{identifier}' logged in successfully!")
                log_event("info", f"Login success (DB): {identifier}")
                return jsonify({
                    "message": "Login success",
                    "id": getattr(db_user, "id", None),
                    "role": getattr(db_user, "role", "citizen"),
                    "name": getattr(db_user, "name", ""),
                    "email": getattr(db_user, "email", identifier)
                })
            else:
                print(f"[LOGIN FAIL] Password mismatch for '{identifier}'!")
        else:
            print(f"[LOGIN FAIL] No user found in DB for identifier '{identifier}'")

    def _pwd_matches(u, pwd):
        stored = (u.get("password") or "").strip()
        if stored == pwd or stored.lower() == pwd.lower():
            return True
        if u.get("role") == "government_official" and pwd in ("GovOfficial@123", "gov123"):
            return True
        return False

    user = next(
        (u for u in MEMORY_USERS
         if (u.get("email", "").strip().lower() == identifier
             or u.get("name", "").strip().lower() == identifier
             or (identifier == "admin" and u.get("role") == "admin"))
         and _pwd_matches(u, password)),
        None
    )
    if user:
        if user.get("status", "Active") != "Active":
            return jsonify({"message": "User account is deactivated"}), 403
        print(f"[LOGIN SUCCESS MEMORY] User '{identifier}' logged in successfully!")
        log_event("info", f"Login success (memory): {identifier}")
        return jsonify({
            "message": "Login success",
            "id": user["id"],
            "role": user["role"],
            "name": user["name"],
            "email": user["email"]
        })

    log_event("warning", f"Failed login attempt for {identifier}")
    return jsonify({"message": "Invalid credentials"}), 401

# ---------------- USERS MANAGEMENT ----------------
@app.route("/users", methods=["GET"])
def get_users():
    data = []
    db_emails = set()

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT id, name, email, role, created_at, status, on_duty FROM users ORDER BY created_at DESC")
            rows = cursor.fetchall()
            for row in rows:
                db_emails.add(row.email)
                on_duty_val = getattr(row, "on_duty", 1)
                c_at = getattr(row, "created_at", None)
                data.append({
                    "id": getattr(row, "id", None),
                    "name": getattr(row, "name", ""),
                    "email": getattr(row, "email", ""),
                    "role": getattr(row, "role", "citizen"),
                    "status": getattr(row, "status", "Active") or "Active",
                    "on_duty": bool(on_duty_val) if on_duty_val is not None else True,
                    "created_at": c_at.isoformat() if hasattr(c_at, "isoformat") else str(c_at) if c_at else None
                })
        except Exception as e:
            print("USERS DB ERROR:", e)
            try:
                cursor.execute("SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC")
                rows = cursor.fetchall()
                for row in rows:
                    db_emails.add(row.email)
                    c_at = getattr(row, "created_at", None)
                    data.append({
                        "id": getattr(row, "id", None),
                        "name": getattr(row, "name", ""),
                        "email": getattr(row, "email", ""),
                        "role": getattr(row, "role", "citizen"),
                        "status": "Active",
                        "created_at": c_at.isoformat() if hasattr(c_at, "isoformat") else str(c_at) if c_at else None
                    })
            except Exception as e2:
                print("USERS DB fallback failed:", e2)

    for user in MEMORY_USERS:
        if user["email"] not in db_emails:
            data.append(user)

    return jsonify(data)

@app.route("/users", methods=["POST"])
def create_user():
    data = request.json
    
    # Check if user already exists
    existing_user = next((u for u in MEMORY_USERS if u["email"] == data["email"]), None)
    if existing_user:
        return jsonify({"message": "User already exists"}), 400
    
    # Create new user
    new_user = {
        "id": len(MEMORY_USERS) + 1,
        "name": data["name"],
        "email": data["email"],
        "password": data["password"],  # In production, hash this!
        "role": data.get("role", "citizen"),
        "status": data.get("status", "Active"),
        "created_at": str(datetime.now())
    }
    
    MEMORY_USERS.append(new_user)
    
    if DB_AVAILABLE:
        try:
            cursor.execute("""
                INSERT INTO users (name, email, password, role)
                VALUES (?, ?, ?, ?)
            """, (
                data["name"],
                data["email"],
                data["password"],
                data["role"]
            ))
            conn.commit()
        except Exception as db_error:
            print(f"Failed to save to database: {db_error}")
    
    return jsonify({"message": "User created successfully"})

@app.route("/users/<int:user_id>", methods=["DELETE"])
def delete_user(user_id):
    # Remove from memory
    MEMORY_USERS[:] = [u for u in MEMORY_USERS if u["id"] != user_id]
    
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
        except Exception as db_error:
            print(f"Failed to delete from database: {db_error}")
    
    return jsonify({"message": "User deleted successfully"})

# ---------------- SELF PROFILE UPDATE (FR01-04) ----------------
@app.route("/users/<int:user_id>/profile", methods=["PUT"])
def update_own_profile(user_id):
    data = request.json or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    if not name or not email:
        return jsonify({"message": "Name and email are required"}), 400

    updated_user = None
    for user in MEMORY_USERS:
        if user["id"] == user_id:
            # reject switching to an email already used by someone else
            clash = next((u for u in MEMORY_USERS if u["id"] != user_id and u["email"].lower() == email), None)
            if clash:
                return jsonify({"message": "That email is already in use"}), 400
            user["name"] = name
            user["email"] = email
            updated_user = user
            break

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT id FROM users WHERE LOWER(email) = ? AND id != ?", (email, user_id))
            if cursor.fetchone():
                return jsonify({"message": "That email is already in use"}), 400
            cursor.execute("UPDATE users SET name = ?, email = ? WHERE id = ?", (name, email, user_id))
            conn.commit()
        except Exception as db_error:
            print(f"Failed to update profile in database: {db_error}")

    if not updated_user and not DB_AVAILABLE:
        return jsonify({"message": "User not found"}), 404
    return jsonify({"message": "Profile updated successfully", "name": name, "email": email})

@app.route("/users/<int:user_id>/duty-status", methods=["PUT"])
def update_duty_status(user_id):
    """Lets a rescue worker mark themselves On Duty / Off Duty, so
    Government Officials know who's actually available before assigning
    them to a new alert."""
    data = request.json or {}
    on_duty = 1 if data.get("on_duty") else 0

    found = None
    for u in MEMORY_USERS:
        if u["id"] == user_id:
            u["on_duty"] = bool(on_duty)
            found = u
            break

    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE users SET on_duty = ? WHERE id = ?", (on_duty, user_id))
            conn.commit()
        except Exception as e:
            log_event("error", f"Failed to update duty status for user {user_id}: {e}")

    if not found and not DB_AVAILABLE:
        return jsonify({"message": "User not found"}), 404
    return jsonify({"message": "Duty status updated", "on_duty": bool(on_duty)})


@app.route("/users/<int:user_id>/deactivate", methods=["PUT"])
def deactivate_user(user_id):
    updated = False
    for user in MEMORY_USERS:
        if user["id"] == user_id:
            user["status"] = "Inactive"
            updated = True
            break
    
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE users SET status = ? WHERE id = ?", ("Inactive", user_id))
            conn.commit()
        except Exception as db_error:
            print(f"Failed to update user status in database: {db_error}")
    
    if not updated:
        return jsonify({"message": "User not found"}), 404
    return jsonify({"message": "User deactivated successfully"})

@app.route("/users/<int:user_id>/activate", methods=["PUT"])
def activate_user(user_id):
    updated = False
    for user in MEMORY_USERS:
        if user["id"] == user_id:
            user["status"] = "Active"
            updated = True
            break
    
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE users SET status = ? WHERE id = ?", ("Active", user_id))
            conn.commit()
        except Exception as db_error:
            print(f"Failed to update user status in database: {db_error}")
    
    if not updated:
        return jsonify({"message": "User not found"}), 404
    return jsonify({"message": "User activated successfully"})

# ---------------- FORGOT PASSWORD ----------------
@app.route("/forgot-password", methods=["POST"])
def forgot_password():
    data = request.json or {}
    email = (data.get("email") or "").strip().lower()

    # Check if user exists
    user = next((u for u in MEMORY_USERS if u["email"].lower() == email), None)
    db_user = None
    if not user and DB_AVAILABLE:
        try:
            cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email,))
            db_user = cursor.fetchone()
        except Exception:
            db_user = None

    if not user and not db_user:
        return jsonify({"message": "Email not found"}), 404

    # Generate a one-time reset token (valid 15 minutes)
    token = str(uuid.uuid4())[:8].upper()
    PASSWORD_RESET_TOKENS[email] = {
        "token": token,
        "expires": datetime.now() + timedelta(minutes=15),
    }

    try:
        _send_verification_email(
            email,
            "Flood Disaster Management System password reset",
            f"Your password reset verification code is {token}.\n\n"
            "This code expires in 15 minutes. If you did not request this, ignore this email.",
        )
    except (ValueError, OSError, smtplib.SMTPException, RuntimeError) as error:
        PASSWORD_RESET_TOKENS.pop(email, None)
        log_event("error", f"Password reset email failed for {email}: {error}")
        return jsonify({"message": "We could not send the verification email. Please try again later."}), 503

    return jsonify({"message": "A password reset code was sent to your email."})

@app.route("/reset-password", methods=["POST"])
def reset_password():
    """FR01-07 part 2: verify the emailed token and actually set the new password."""
    data = request.json or {}
    email = (data.get("email") or "").strip().lower()
    token = (data.get("token") or "").strip().upper()
    new_password = data.get("new_password") or ""

    if not email or not token or not new_password:
        return jsonify({"message": "Email, verification code and new password are required"}), 400

    record = PASSWORD_RESET_TOKENS.get(email)
    if not record or not secrets.compare_digest(record["token"], token):
        return jsonify({"message": "Invalid verification code"}), 400
    if datetime.now() > record["expires"]:
        del PASSWORD_RESET_TOKENS[email]
        return jsonify({"message": "Verification code has expired — please request a new one"}), 400

    updated = False
    for user in MEMORY_USERS:
        if user["email"].lower() == email:
            user["password"] = new_password
            updated = True
            break

    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE users SET password = ? WHERE LOWER(email) = ?", (new_password, email))
            conn.commit()
            updated = True
        except Exception as e:
            print("Failed to update password in database:", e)

    if not updated:
        return jsonify({"message": "User not found"}), 404

    del PASSWORD_RESET_TOKENS[email]
    return jsonify({"message": "Password reset successfully. You can now log in with your new password."})

# ---------------- PREDICT ----------------
def _selected_class_confidence(estimator, features, predicted_class):
    if not hasattr(estimator, "predict_proba") or not hasattr(estimator, "classes_"):
        return None
    class_indexes = np.flatnonzero(np.asarray(estimator.classes_) == predicted_class)
    if not len(class_indexes):
        return None
    return float(estimator.predict_proba(features)[0][class_indexes[0]])


@app.route("/predict", methods=["POST"])
def predict():
    data = request.json or {}

    try:
        # Validate and convert inputs
        location = data.get("location", "Unknown")
        rainfall = safe_float(data.get("rainfall", 0.0))
        river_level = safe_float(data.get("river_level", 0.0))
        temperature_in = data.get("temperature", None)
        temperature_in = None if temperature_in in (None, "") else safe_float(temperature_in)
        humidity_in = data.get("humidity", None)
        humidity_in = None if humidity_in in (None, "") else safe_float(humidity_in)
        wind_speed_in = data.get("wind_speed", None)
        wind_speed_in = None if wind_speed_in in (None, "") else safe_float(wind_speed_in)
        soil_moisture_in = data.get("soil_moisture_top", None)
        soil_moisture_in = None if soil_moisture_in in (None, "") else safe_float(soil_moisture_in)
        soil_7day_in = data.get("soil_7day_avg", None)
        soil_7day_in = None if soil_7day_in in (None, "") else safe_float(soil_7day_in)

        # Reject physically impossible values outright rather than silently
        # feeding them to the model and returning a misleading prediction —
        # this applies even though the citizen-facing form now only offers
        # safe dropdown values, since the API itself should never trust
        # unvalidated input (e.g. a direct request bypassing the UI).
        field_bounds = [
            ("rainfall", rainfall, 0, 500),
            ("temperature", temperature_in, -10, 60),
            ("humidity", humidity_in, 0, 100),
            ("wind_speed", wind_speed_in, 0, 150),
            ("soil_moisture_top", soil_moisture_in, 0, 1),
            ("soil_7day_avg", soil_7day_in, 0, 1),
            ("river_level", river_level, 0, 50),
        ]
        for field_name, value, lo, hi in field_bounds:
            if value is not None and not (lo <= value <= hi):
                return jsonify({
                    "message": f"'{field_name}' value ({value}) is outside the valid range ({lo}-{hi}). Please check this field.",
                    "field": field_name,
                }), 400

        # Build the exact 20-feature vector the model was trained on.
        # NOTE: river_level is NOT one of the model's trained features (the
        # training dataset never included it) — we still store it for
        # record-keeping/reporting (FR02-01, FR09-02), but it does not
        # influence the ML prediction itself.
        feature_dict, resolved_city, fe_warnings = build_feature_vector(
            MODEL_FEATURES,
            location=location,
            rainfall_mm=rainfall,
            temperature=temperature_in,
            humidity=humidity_in,
            wind_speed=wind_speed_in,
            soil_moisture_top=soil_moisture_in,
            soil_7day_avg=soil_7day_in,
        )
        temperature = feature_dict["temperature"]

        feature_vector = [feature_dict[f] for f in MODEL_FEATURES]
        features_df = pd.DataFrame([feature_dict], columns=MODEL_FEATURES)

        # Scale the features
        scaled_features = pd.DataFrame(scaler.transform(features_df), columns=MODEL_FEATURES)

        # Make prediction
        prediction = int(model.predict(scaled_features)[0])
        risk = RISK_MAP.get(prediction, "Unknown")

        # Get prediction probabilities for confidence
        confidence = _selected_class_confidence(model, scaled_features, prediction)
        confidence_text = f"{confidence * 100:.1f}%" if confidence is not None else "unavailable"

        # ---- Real SHAP explanation (FR-11) ----
        shap_contributions = []
        if SHAP_EXPLAINER is not None:
            try:
                sv = SHAP_EXPLAINER.shap_values(scaled_features)
                # Multiclass models return a list (one array per class) or a
                # (1, n_features, n_classes) array depending on shap version.
                #
                # IMPORTANT: we always read the "High risk" class's SHAP
                # values here (index 2), not sv[prediction]. SHAP values are
                # relative to whichever class they're computed for — using
                # sv[prediction] would mean a "Low" prediction shows values
                # for "what pushed toward Low", which flips the sign in a
                # confusing way (e.g. zero rainfall would show as a large
                # *positive* bar, looking like it "increases risk", when it
                # was actually pushing toward the Low classification).
                # Always reading the High-class values instead gives one
                # consistent meaning everywhere: positive = pushes toward
                # more flood risk, negative = pushes toward less — true no
                # matter what the final predicted risk level turns out to be.
                HIGH_CLASS_INDEX = 2
                if isinstance(sv, list):
                    class_shap = sv[HIGH_CLASS_INDEX][0]
                elif sv.ndim == 3:
                    class_shap = sv[0, :, HIGH_CLASS_INDEX]
                else:
                    class_shap = sv[0]
                pairs = sorted(
                    zip(MODEL_FEATURES, class_shap, feature_vector),
                    key=lambda p: abs(p[1]), reverse=True
                )
                shap_contributions = [
                    {"feature": f, "impact": round(float(imp), 4), "value": round(float(val), 3)}
                    for f, imp, val in pairs[:6]
                ]
            except Exception as shap_error:
                print(f"SHAP explanation failed: {shap_error}")

        def humanize_feature(name):
            return {
                "rain_intensity": "rainfall intensity",
                "soil_moisture_top": "surface soil moisture",
                "soil_7day_avg": "7-day soil moisture trend",
                "is_monsoon": "monsoon season",
            }.get(name, name.replace("city_", "").replace("_", " "))

        if shap_contributions:
            top_lines = "\n".join(
                f"  • {humanize_feature(c['feature'])} "
                f"({'increased' if c['impact'] > 0 else 'decreased'} risk)"
                for c in shap_contributions[:4]
            )
        else:
            top_lines = "  • SHAP explainer unavailable on this server (install `shap`)."

        risk_summary = {
            "High": "Critical flood risk detected. Immediate evacuation and emergency measures required.",
            "Medium": "Moderate flood risk. Stay alert and monitor conditions closely.",
            "Low": "Low flood risk. Conditions appear safe but remain vigilant.",
        }.get(risk, "")

        warning_lines = ("\n".join(f"  • {w}" for w in fe_warnings) + "\n") if fe_warnings else ""

        explanation = f"""Flood Risk Analysis for {location} (matched city: {resolved_city})

Input Parameters:
• Rainfall: {rainfall} mm
• River Level: {river_level} m (recorded, not used by the model — no river-level data in training set)
• Temperature: {temperature:.1f} °C

ML Model Prediction: {risk} flood risk
Model Confidence: {confidence_text}
Model used: {ACTIVE_MODEL_NAME}

Top contributing factors (SHAP):
{top_lines}

Risk Assessment: {risk_summary}
{warning_lines}
Generated using a {ACTIVE_MODEL_NAME} model trained on 10-city, 24-year historical flood data."""

        # Save to database (optional) or memory
        input_data = {
            "rainfall": rainfall,
            "river_level": river_level,
            "temperature": temperature,
            "humidity": feature_dict["humidity"],
            "wind_speed": feature_dict["wind_speed"],
            "soil_moisture_top": feature_dict["soil_moisture_top"],
            "soil_7day_avg": feature_dict["soil_7day_avg"],
            "city": resolved_city,
            "model_features": feature_dict,
        }
        user_email = (data.get("user_email") or "").strip().lower()

        prediction_record = {
            "location": data.get("location"),
            "rainfall": rainfall,
            "river_level": river_level,
            "temperature": temperature,
            "input_data": json.dumps(input_data),
            "risk": risk,
            "confidence": confidence,
            "explanation": explanation,
            "shap_contributions": shap_contributions,
            "model_features": feature_dict,
            "model_used": ACTIVE_MODEL_NAME,
            "user_email": user_email,
            "created_at": str(datetime.now())
        }

        if DB_AVAILABLE:
            try:
                prediction_record["id"] = _db_insert_get_id("""
                    INSERT INTO predictions
                    (location, rainfall, river_level, temperature, input_data, risk, confidence, explanation, shap_contributions, user_email)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    data.get("location"),
                    rainfall,
                    river_level,
                    temperature,
                    json.dumps(input_data),
                    risk,
                    confidence,
                    explanation,
                    json.dumps(shap_contributions),
                    user_email
                ))
                conn.commit()
            except Exception as db_error:
                log_event("error", f"Failed to save prediction to database: {db_error}")
        else:
            # Save to memory when database is not available
            prediction_record["id"] = len(MEMORY_PREDICTIONS) + 1
            MEMORY_PREDICTIONS.append(prediction_record)
            # Keep only last 100 predictions in memory
            if len(MEMORY_PREDICTIONS) > 100:
                MEMORY_PREDICTIONS.pop(0)
        
        # Auto-trigger alerts for medium/high risk
        if risk in ["Medium", "High"]:
            alert_message = f"{risk} flood risk detected in {location}. "
            if risk == "High":
                alert_message += "Immediate evacuation recommended. "
            else:
                alert_message += "Stay alert and monitor conditions. "
            alert_message += f"Rainfall: {rainfall}mm, River Level: {river_level}m"
            
            create_notification(alert_message, risk, location, source="automatic")

        model_comparison = None
        if COMPARISON_MODEL is not None:
            try:
                cmp_pred = int(COMPARISON_MODEL.predict(scaled_features)[0])
                cmp_conf = _selected_class_confidence(COMPARISON_MODEL, scaled_features, cmp_pred)
                model_comparison = {
                    "primary": {"model": ACTIVE_MODEL_NAME, "risk": risk, "confidence": confidence},
                    "secondary": {"model": COMPARISON_MODEL_NAME, "risk": RISK_MAP.get(cmp_pred, "Unknown"), "confidence": cmp_conf},
                    "agree": RISK_MAP.get(cmp_pred, "Unknown") == risk,
                }
            except Exception as cmp_error:
                print(f"Model comparison failed: {cmp_error}")

        return jsonify({
            "risk": risk,
            "confidence": confidence,
            "location": location,
            "resolved_city": resolved_city,
            "explanation": explanation,
            "shap_contributions": shap_contributions,
            "model_used": ACTIVE_MODEL_NAME,
            "model_comparison": model_comparison,
            "model_features": {k: v for k, v in feature_dict.items() if not k.startswith("city_")}
        })

    except Exception as e:
        log_event("error", f"Prediction failed: {e}")
        return jsonify({
            "risk": "Unknown",
            "confidence": None,
            "explanation": f"Prediction failed: {str(e)}. Please check inputs."
        }), 500

# ---------------- GET PREDICTIONS ----------------
@app.route("/predictions", methods=["GET"])
def get_predictions():
    data = []
    seen = set()
    email_filter = (request.args.get("email") or "").strip().lower()

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT * FROM predictions ORDER BY created_at DESC, id DESC")
            rows = cursor.fetchall()

            for row in rows:
                input_data = None
                try:
                    input_data = json.loads(row.input_data) if row.input_data else None
                except Exception:
                    input_data = None

                try:
                    shap_contributions = json.loads(getattr(row, "shap_contributions", None) or "[]")
                except (TypeError, ValueError):
                    shap_contributions = []

                record = {
                    "id": getattr(row, "id", None),
                    "location": getattr(row, "location", None),
                    "rainfall": getattr(row, "rainfall", None),
                    "river_level": getattr(row, "river_level", None),
                    "temperature": getattr(row, "temperature", None),
                    "input_data": input_data,
                    "risk": getattr(row, "risk", None),
                    "confidence": getattr(row, "confidence", None),
                    "explanation": getattr(row, "explanation", None),
                    "shap_contributions": shap_contributions,
                    "model_features": input_data.get("model_features") if input_data else None,
                    "user_email": getattr(row, "user_email", None),
                    "created_at": getattr(row, "created_at", None).isoformat() if getattr(row, "created_at", None) is not None else None
                }
                key = (record["location"], record["risk"], record["created_at"])
                seen.add(key)
                data.append(record)
        except Exception as e:
            log_event("error", f"Failed to fetch predictions: {e}")

    for record in MEMORY_PREDICTIONS[::-1]:
        item = record.copy()
        if isinstance(item.get("input_data"), str):
            try:
                item["input_data"] = json.loads(item["input_data"])
            except Exception:
                pass
        key = (item.get("location"), item.get("risk"), item.get("created_at"))
        if key not in seen:
            data.append(item)
            seen.add(key)

    if email_filter:
        data = [d for d in data if (d.get("user_email") or "").strip().lower() == email_filter]

    return jsonify(data)

# ---------------- ALERTS (FR-03) ----------------
from notifications import register as register_notifications, create as create_notification, db as notification_db, bind_main_db as bind_advisory_db, ensure_advisory_tables
bind_advisory_db(lambda: (conn, DB_TYPE) if DB_AVAILABLE else None)
if os.environ.get("FMS_CREATE_ADVISORY_TABLES") == "1":
    # Explicit opt-in only: additive, guarded CREATE of the two advisory notification tables.
    try:
        ensure_advisory_tables()
        print("Advisory notification tables are ready")
    except Exception as advisory_table_error:
        print(f"Advisory notification tables could not be created: {advisory_table_error}")
register_notifications(app)
from map_support import register as register_map_support
register_map_support(app)

# Preserve report coordinates when dispatching an operation, including after restart.
if DB_AVAILABLE:
    for table, column, datatype in [('rescue_operations','latitude','FLOAT'), ('rescue_operations','longitude','FLOAT'), ('community_reports','linked_rescue_op_id','INTEGER')]:
        try:
            if DB_TYPE == 'sqlite':
                names = {row.name for row in cursor.execute(f'PRAGMA table_info({table})').fetchall()}
                if column not in names: cursor.execute(f'ALTER TABLE {table} ADD COLUMN {column} {datatype}')
            elif DB_TYPE == 'postgresql':
                cursor.execute(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {datatype}')
            else:
                cursor.execute(f"IF COL_LENGTH('{table}', '{column}') IS NULL ALTER TABLE {table} ADD {column} {datatype}")
            conn.commit()
        except Exception as error:
            if hasattr(conn, 'rollback'): conn.rollback()
            print(f'[MAP MIGRATION] {error}')
    # One-time removal of the legacy Sialkot alert-response record requested by the user.
    # Other operations and user-added roads/risk overlays are preserved.
    try:
        cursor.execute('CREATE TABLE IF NOT EXISTS fms_map_migrations (name VARCHAR(100) PRIMARY KEY)') if DB_TYPE != 'sql_server' else cursor.execute("IF OBJECT_ID('fms_map_migrations') IS NULL CREATE TABLE fms_map_migrations (name VARCHAR(100) PRIMARY KEY)")
        cursor.execute('SELECT name FROM fms_map_migrations WHERE name = ?', ('remove_legacy_sialkot_response',))
        if not cursor.fetchone():
            cursor.execute("DELETE FROM rescue_operations WHERE location = ? AND description LIKE ?", ('Sialkot','Response to alert:%'))
            cursor.execute('INSERT INTO fms_map_migrations (name) VALUES (?)', ('remove_legacy_sialkot_response',))
        conn.commit()
    except Exception as error:
        if hasattr(conn, 'rollback'): conn.rollback()
        print(f'[MAP CLEANUP] {error}')

# ---------------- RESCUE OPERATIONS (FR-05) ----------------
MEMORY_RESCUE_OPS = []
RISK_PRIORITY = {"High": 1, "Medium": 2, "Low": 3}
BUSY_OPERATION_STATUSES = ("Assigned", "In Progress")

def _get_all_rescue_operations():
    """Merges in-memory operations (this session's) with everything in the
    database (the real source of truth once available), de-duplicated by id.
    Shared by GET /rescue-operations and /rescue-operations/stats — the stats
    endpoint used to read only MEMORY_RESCUE_OPS directly, which meant it
    showed 0/wrong totals after any restart wiped that list clean, even
    though the operations themselves were safely sitting in the database."""
    all_ops = list(MEMORY_RESCUE_OPS)
    seen_ids = {o["id"] for o in all_ops}

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT * FROM rescue_operations ORDER BY created_at DESC")
            for row in cursor.fetchall():
                row_id = getattr(row, "id", None)
                if row_id in seen_ids:
                    continue
                all_ops.append({
                    "id": row_id,
                    "location": getattr(row, "location", None),
                    "description": getattr(row, "description", None),
                    "latitude": getattr(row, "latitude", None), "longitude": getattr(row, "longitude", None),
                    "risk_level": getattr(row, "risk_level", None),
                    "assigned_team": getattr(row, "assigned_team", None),
                    "status": getattr(row, "status", None),
                    "created_at": str(getattr(row, "created_at", None)),
                    "updated_at": str(getattr(row, "updated_at", None)),
                    "completed_at": str(getattr(row, "completed_at", None)) if getattr(row, "completed_at", None) else None,
                    "people_rescued": getattr(row, "people_rescued", None),
                    "resources_used": getattr(row, "resources_used", None),
                    "completion_notes": getattr(row, "completion_notes", None),
                    "needs_backup": bool(getattr(row, "needs_backup", 0)),
                    "update_log": json.loads(getattr(row, "update_log", None)) if getattr(row, "update_log", None) else [],
                    "checklist": json.loads(getattr(row, "checklist", None)) if getattr(row, "checklist", None) else [dict(item) for item in DEFAULT_OP_CHECKLIST],
                })
                seen_ids.add(row_id)
        except Exception as e:
            log_event("error", f"Failed to fetch rescue operations: {e}")

    return all_ops

@app.route("/rescue-operations", methods=["GET"])
def get_rescue_operations():
    all_ops = _get_all_rescue_operations()
    # FR05-07: prioritize by risk level, most urgent first; then newest first
    ops = sorted(all_ops, key=lambda o: o["created_at"], reverse=True)
    ops = sorted(ops, key=lambda o: RISK_PRIORITY.get(o["risk_level"], 9))
    return jsonify(_decorate_operations(ops))


def _require_assigner():
    from notifications import identity
    if identity().get("role") not in ("admin", "government_official"):
        return jsonify({"message": "Only administrators and government officials can change worker assignments."}), 403
    return None


@app.route("/rescue-operations/workers", methods=["GET"])
def get_rescue_worker_availability():
    busy = _busy_map()
    workers = []
    for user in (get_users().get_json() or []):
        if user.get("role") != "rescue_worker":
            continue
        operation = busy.get(ra.worker_key(user.get("name")))
        workers.append({
            "id": user.get("id"), "name": user.get("name"), "email": user.get("email"),
            "status": "Busy" if operation else "Available",
            "operation_id": operation["id"] if operation else None,
        })
    return jsonify({"multi_worker_enabled": _assignments_ready(), "workers": workers})


@app.route("/rescue-operations/<int:op_id>/workers", methods=["POST"])
def add_rescue_operation_workers(op_id):
    denied = _require_assigner()
    if denied:
        return denied
    names = ra.clean_names((request.json or {}).get("worker_names"))
    if not names:
        return jsonify({"message": "Select at least one rescue worker."}), 400
    try:
        final = _apply_assignment(op_id, add=names)
    except AssignmentError as error:
        return jsonify({"message": str(error)}), error.status
    return jsonify({"message": "Workers assigned", "worker_names": final})


@app.route("/rescue-operations/<int:op_id>/workers", methods=["DELETE"])
def remove_rescue_operation_worker(op_id):
    denied = _require_assigner()
    if denied:
        return denied
    names = ra.clean_names([request.args.get("name", "")])
    if not names:
        return jsonify({"message": "Worker name is required."}), 400
    try:
        final = _apply_assignment(op_id, remove=names)
    except AssignmentError as error:
        return jsonify({"message": str(error)}), error.status
    return jsonify({"message": "Worker removed", "worker_names": final})

def _db_insert_get_id(insert_query_with_qmarks, params):
    """Runs an INSERT and returns the new row's real database id, reliably —
    RETURNING id for PostgreSQL, last_insert_rowid() for SQLite. This exists
    because an earlier, more fragile approach (INSERT, then a separate
    SELECT id WHERE <some other columns match>) could silently fail to
    match the row it just inserted, leaving a memory-only id that later
    404'd on every action (mark complete, request backup, etc.) even
    though the record existed. Every "create X and remember its id" path
    in this file should go through here instead of repeating that mistake."""
    db_type = getattr(cursor, "db_type", "sqlite")
    if db_type == "postgresql":
        cursor.execute(insert_query_with_qmarks + " RETURNING id", params)
        row = cursor.fetchone()
        conn.commit()
        if not row:
            raise RuntimeError("INSERT ... RETURNING id returned no row")
        return row.id if hasattr(row, "id") else row[0]
    elif db_type == "sql_server":
        # Inject OUTPUT INSERTED.id into the INSERT statement for reliable ID retrieval.
        # SCOPE_IDENTITY() can return NULL when pyodbc sends implicit queries between
        # the INSERT and the SELECT. OUTPUT INSERTED.id is atomic and always correct.
        import re as _re
        output_query = _re.sub(
            r'(?i)(INSERT\s+INTO\s+\S+\s*\([^)]+\))\s*(VALUES)',
            r'\1 OUTPUT INSERTED.id \2',
            insert_query_with_qmarks,
            count=1
        )
        try:
            cursor.execute(output_query, params)
            row = cursor.fetchone()
            conn.commit()
            if row and row[0] is not None:
                return int(row[0])
        except Exception:
            conn.commit()
        # Fallback: plain INSERT then SCOPE_IDENTITY()
        try:
            cursor.execute(insert_query_with_qmarks, params)
            cursor.execute("SELECT CAST(SCOPE_IDENTITY() AS INT)")
            row = cursor.fetchone()
            conn.commit()
            if row and row[0] is not None:
                return int(row[0])
        except Exception:
            conn.commit()
        return None
    else:
        cursor.execute(insert_query_with_qmarks, params)
        conn.commit()
        cursor.execute("SELECT last_insert_rowid() AS new_id")
        row = cursor.fetchone()
        if not row:
            raise RuntimeError("last_insert_rowid() returned no row")
        return row.new_id if hasattr(row, "new_id") else row[0]


import rescue_assignments as ra

if DB_AVAILABLE and os.environ.get("FMS_CREATE_ASSIGNMENT_TABLES") == "1":
    # Explicit opt-in only: additive, guarded CREATE of rescue_operation_workers.
    try:
        ra.ensure_tables(conn, cursor, DB_TYPE)
        print("Rescue assignment table is ready")
    except Exception as assignment_table_error:
        print(f"Rescue assignment table could not be created: {assignment_table_error}")


def _assignments_ready():
    return bool(DB_AVAILABLE) and ra.ready(conn, cursor)


def _active_assignments():
    if not _assignments_ready():
        return {}
    try:
        return ra.active_rows(cursor)
    except Exception as error:
        log_event("error", f"Failed to read rescue assignments: {error}")
        return {}


def _op_worker_names(operation, rows):
    names = rows.get(operation.get("id"))
    if names:
        return list(names)
    team = (operation.get("assigned_team") or "").strip()
    if not team or team.lower() == "unassigned":
        return []
    return [part.strip() for part in team.split(", ") if part.strip()]


def _busy_map(exclude_operation_id=None):
    """{worker_key: active operation} using assignment rows, falling back to the legacy column."""
    rows = _active_assignments()
    busy = {}
    for operation in _get_all_rescue_operations():
        if operation.get("id") == exclude_operation_id or operation.get("status") not in BUSY_OPERATION_STATUSES:
            continue
        for name in _op_worker_names(operation, rows):
            busy.setdefault(ra.worker_key(name), operation)
    return busy


def _worker_has_active_operation(worker_name, exclude_operation_id=None):
    """Return the active operation currently assigned to a worker, if any."""
    if not worker_name or worker_name == "Unassigned":
        return None
    return _busy_map(exclude_operation_id).get(ra.worker_key(worker_name))


def _decorate_operations(operations):
    rows = _active_assignments()
    decorated = []
    for operation in operations:
        item = dict(operation)
        active = item.get("status") in BUSY_OPERATION_STATUSES
        names = _op_worker_names(item, rows)
        item["workers"] = [{"name": n, "status": "Busy" if active else "Available"} for n in names]
        item["worker_names"] = names
        decorated.append(item)
    return decorated


def _set_operation_team(op_id, names):
    team = ", ".join(names) if names else "Unassigned"
    now = datetime.now()
    for operation in MEMORY_RESCUE_OPS:
        if operation["id"] == op_id:
            operation["assigned_team"] = team
            operation["updated_at"] = str(now)
    if DB_AVAILABLE:
        cursor.execute(
            "UPDATE rescue_operations SET assigned_team = ?, updated_at = ? WHERE id = ?",
            (team, now, op_id),
        )


def _known_rescue_worker_names():
    return {
        ra.worker_key(user.get("name"))
        for user in (get_users().get_json() or [])
        if user.get("role") == "rescue_worker"
    }


class AssignmentError(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


def _apply_assignment(op_id, add=None, remove=None, replace=None):
    """Atomically change the active worker set of one active operation."""
    if not _assignments_ready():
        raise AssignmentError(
            "Multi-worker assignment is pending database migration approval "
            "(table rescue_operation_workers does not exist yet).", 503)
    with ra.LOCK:
        operation = next((o for o in _get_all_rescue_operations() if o["id"] == op_id), None)
        if operation is None:
            raise AssignmentError("Rescue operation not found", 404)
        if operation.get("status") not in BUSY_OPERATION_STATUSES:
            raise AssignmentError("Workers can only be changed on an active operation.", 409)

        rows = _active_assignments()
        current = _op_worker_names(operation, rows)
        if replace is not None:
            final = ra.clean_names(replace)
        else:
            removed = {ra.worker_key(n) for n in ra.clean_names(remove)}
            final = [n for n in current if ra.worker_key(n) not in removed]
            final += [n for n in ra.clean_names(add) if ra.worker_key(n) not in {ra.worker_key(x) for x in final}]
        current_keys = {ra.worker_key(n) for n in current}
        final_keys = {ra.worker_key(n) for n in final}
        to_add = [n for n in final if ra.worker_key(n) not in current_keys]
        to_remove = [n for n in current if ra.worker_key(n) not in final_keys]

        if to_add:
            known = _known_rescue_worker_names()
            busy = _busy_map(op_id)
            for name in to_add:
                if ra.worker_key(name) not in known:
                    raise AssignmentError(f"{name} is not a registered rescue worker.", 400)
                other = busy.get(ra.worker_key(name))
                if other:
                    raise AssignmentError(f"{name} is already assigned to active operation {other['id']}.", 409)

        try:
            for name in to_remove:
                ra.release(conn, cursor, op_id, name)
            # Adopt a legacy single-worker assignment that has no row yet.
            if not rows.get(op_id):
                for name in current:
                    if ra.worker_key(name) in final_keys:
                        ra.insert_assignment(conn, cursor, op_id, name)
            for name in to_add:
                ra.insert_assignment(conn, cursor, op_id, name)
            _set_operation_team(op_id, final)
            conn.commit()
        except ra.AssignmentConflict as error:
            raise AssignmentError(str(error), 409)
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        return final


def _release_operation_workers(op_id):
    if not _assignments_ready():
        return
    try:
        ra.release(conn, cursor, op_id)
        conn.commit()
    except Exception as error:
        try:
            conn.rollback()
        except Exception:
            pass
        log_event("error", f"Failed to release workers for operation {op_id}: {error}")


DEFAULT_OP_CHECKLIST = [
    {"label": "Evacuation started", "done": False},
    {"label": "Medical check", "done": False},
    {"label": "Transport arranged", "done": False},
    {"label": "Reached shelter", "done": False},
]

def _get_alert_for_link(alert_id):
    """Validate and return an active notification alert by its exact ID."""
    try:
        normalized_id = int(alert_id)
    except (TypeError, ValueError):
        raise ValueError("alert_id must be an integer")
    with notification_db() as notification_connection:
        row = notification_connection.execute(
            "SELECT payload FROM alerts WHERE id = ?", (normalized_id,)
        ).fetchone()
    if not row:
        raise LookupError("Related flood alert was not found")
    alert = json.loads(row["payload"])
    if alert.get("status") == "Cancelled":
        raise ValueError("Related flood alert is cancelled")
    linked_operation_id = alert.get("linked_rescue_op_id")
    if linked_operation_id is not None:
        try:
            linked_operation_id = int(linked_operation_id)
        except (TypeError, ValueError):
            raise ValueError("Related flood alert has an invalid operation link")
        if any(operation["id"] == linked_operation_id for operation in MEMORY_RESCUE_OPS):
            raise ValueError(f"Related flood alert is already linked to rescue operation {linked_operation_id}")
        if DB_AVAILABLE:
            cursor.execute("SELECT id FROM rescue_operations WHERE id = ?", (linked_operation_id,))
            if cursor.fetchone():
                raise ValueError(f"Related flood alert is already linked to rescue operation {linked_operation_id}")
    return normalized_id, alert


def _operation_exists(operation_id):
    """A link to a deleted/missing operation is stale and may be replaced."""
    try:
        operation_id = int(operation_id)
    except (TypeError, ValueError):
        return False
    if any(operation["id"] == operation_id for operation in MEMORY_RESCUE_OPS):
        return True
    if DB_AVAILABLE:
        cursor.execute("SELECT id FROM rescue_operations WHERE id = ?", (operation_id,))
        return bool(cursor.fetchone())
    return False


def _link_alert_to_operation(alert_id, operation_id, assigned_worker):
    """Link one exact alert to one operation in the existing notification store."""
    with notification_db() as notification_connection:
        row = notification_connection.execute(
            "SELECT payload FROM alerts WHERE id = ?", (int(alert_id),)
        ).fetchone()
        if not row:
            raise LookupError("Related flood alert was not found")
        alert = json.loads(row["payload"])
        existing_link = alert.get("linked_rescue_op_id")
        if existing_link is not None and str(existing_link) != str(operation_id) and _operation_exists(existing_link):
            raise ValueError("Related flood alert is already linked to another rescue operation")
        alert["linked_rescue_op_id"] = int(operation_id)
        alert["assigned_worker"] = (
            assigned_worker if assigned_worker and assigned_worker != "Unassigned" else None
        )
        alert["updated_at"] = datetime.now().isoformat()
        notification_connection.execute(
            "UPDATE alerts SET payload = ? WHERE id = ?",
            (json.dumps(alert), int(alert_id)),
        )
    return alert


def _create_rescue_op_internal(location, description="", risk_level="Medium", assigned_team="Unassigned", latitude=None, longitude=None, create_dispatch_alert=True):
    """Shared by the manual '+ New Operation' form and the automatic
    community-report -> rescue-operation link (see update_community_report_status)."""
    created_at = datetime.now()
    updated_at = datetime.now()
    op = {
        "id": (max([o["id"] for o in MEMORY_RESCUE_OPS], default=0) + 1),
        "location": location,
        "latitude": latitude, "longitude": longitude,
        "description": description,
        "risk_level": risk_level,
        "assigned_team": assigned_team or "Unassigned",
        "status": "Assigned",
        "created_at": str(created_at),
        "updated_at": str(updated_at),
        "completed_at": None,
        "needs_backup": False,
        "update_log": [],
        "checklist": [dict(item) for item in DEFAULT_OP_CHECKLIST],
    }
    MEMORY_RESCUE_OPS.append(op)

    if DB_AVAILABLE:
        try:
            op["id"] = _db_insert_get_id(
                "INSERT INTO rescue_operations (location, description, risk_level, assigned_team, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (op["location"], op["description"], op["risk_level"], op["assigned_team"], op["status"], created_at, updated_at)
            )
            cursor.execute("UPDATE rescue_operations SET checklist = ?, latitude = ?, longitude = ? WHERE id = ?", (json.dumps(op["checklist"]), latitude, longitude, op["id"]))
            if create_dispatch_alert:
                dispatch_alert = create_notification(
                    f"🚨 Rescue Dispatch: {op['assigned_team']} assigned to {op['location']}",
                    op["risk_level"], op["location"], source="dispatch"
                )
                _link_alert_to_operation(dispatch_alert["id"], op["id"], op["assigned_team"])
            conn.commit()
            if create_dispatch_alert and _assignments_ready():
                for _name in ra.clean_names([op["assigned_team"]]):
                    try:
                        ra.insert_assignment(conn, cursor, op["id"], _name)
                        conn.commit()
                    except ra.AssignmentConflict:
                        log_event("warning", f"{_name} already has an active assignment; not recorded for operation {op['id']}")
        except Exception as db_error:
            # If we couldn't confirm the real database id, don't silently
            # keep a memory-only id that will 404 on every future action —
            # surface it so the operation isn't created in a half-broken state.
            log_event("error", f"Failed to save rescue operation to database: {db_error}")
            MEMORY_RESCUE_OPS.remove(op)
            raise

    print(f"[NOTIFY] Rescue team '{op['assigned_team']}' assigned to {op['location']} ({op['risk_level']} risk)")
    return op


@app.route("/rescue-operations", methods=["POST"])
def create_rescue_operation():
    data = request.json or {}
    location = (data.get("location") or "").strip()
    if not location:
        return jsonify({"message": "Location is required"}), 400

    alert_id = data.get("alert_id")
    selected_alert = None
    if alert_id is not None and alert_id != "":
        try:
            alert_id, selected_alert = _get_alert_for_link(alert_id)
        except (LookupError, ValueError) as error:
            return jsonify({"message": str(error)}), 409

    worker_names = ra.clean_names(data.get("worker_names") or [])
    if not worker_names:
        legacy_name = data.get("assigned_team", "Unassigned") or "Unassigned"
        worker_names = ra.clean_names([legacy_name])
    use_rows = _assignments_ready()
    if len(worker_names) > 1 and not use_rows:
        return jsonify({
            "message": "Assigning multiple workers is pending database migration approval."
        }), 503
    assigned_team = ", ".join(worker_names) if worker_names else "Unassigned"
    busy = _busy_map()
    for name in worker_names:
        busy_operation = busy.get(ra.worker_key(name))
        if busy_operation:
            return jsonify({
                "message": f"{name} is already assigned to active operation {busy_operation['id']}."
            }), 409
    if use_rows and data.get("worker_names"):
        known = _known_rescue_worker_names()
        unknown = [n for n in worker_names if ra.worker_key(n) not in known]
        if unknown:
            return jsonify({"message": f"{unknown[0]} is not a registered rescue worker."}), 400

    created_operation_id = None
    try:
        with ra.LOCK:
            op = _create_rescue_op_internal(
                location=location, description=data.get("description", ""),
                risk_level=data.get("risk_level", "High"), assigned_team=assigned_team,
                latitude=data.get("latitude"), longitude=data.get("longitude"),
                create_dispatch_alert=False,
            )
            created_operation_id = op["id"]
            if use_rows and DB_AVAILABLE:
                for name in worker_names:
                    ra.insert_assignment(conn, cursor, op["id"], name)
                conn.commit()
        if selected_alert is not None:
            _link_alert_to_operation(alert_id, op["id"], op["assigned_team"])
    except ra.AssignmentConflict as error:
        _rollback_created_operation(created_operation_id)
        return jsonify({"message": str(error)}), 409
    except Exception as error:
        _rollback_created_operation(created_operation_id)
        log_event("error", f"Failed to create/link rescue operation: {error}")
        return jsonify({"message": "Could not save the operation to the database — please try again."}), 503
    # FR05-03: notify relevant rescue teams when a new operation is created.
    return jsonify(_decorate_operations([op])[0]), 201


def _rollback_created_operation(created_operation_id):
    if created_operation_id is None:
        return
    try:
        MEMORY_RESCUE_OPS[:] = [item for item in MEMORY_RESCUE_OPS if item["id"] != created_operation_id]
        if DB_AVAILABLE:
            if _assignments_ready():
                ra.release(conn, cursor, created_operation_id)
            cursor.execute("DELETE FROM rescue_operations WHERE id = ?", (created_operation_id,))
            conn.commit()
    except Exception as cleanup_error:
        log_event("error", f"Failed to roll back rescue operation {created_operation_id}: {cleanup_error}")


@app.route("/rescue-operations/<int:op_id>/status", methods=["PUT"])
def update_rescue_operation_status(op_id):
    data = request.json or {}
    new_status = data.get("status")
    if new_status and new_status not in ("Assigned", "In Progress", "Completed"):
        return jsonify({"message": "Invalid status"}), 400

    risk_level = data.get("risk_level")
    if risk_level and risk_level not in ("High", "Medium", "Low"):
        return jsonify({"message": "Invalid risk level"}), 400

    updated_at_value = datetime.now()
    updated_at = str(updated_at_value)
    completed_at_value = updated_at_value if new_status == "Completed" else None
    completed_at = str(completed_at_value) if completed_at_value else None
    people_rescued = data.get("people_rescued") if new_status == "Completed" else None
    resources_used = data.get("resources_used", "") if new_status == "Completed" else None
    completion_notes = data.get("completion_notes", "") if new_status == "Completed" else None
    assigned_team = data.get("assigned_team")
    needs_backup = data.get("needs_backup")  # True/False/None (None = leave unchanged)

    if assigned_team is not None and _assignments_ready():
        try:
            # The legacy single-worker field must never overwrite an existing team.
            requested = [] if assigned_team in ("", "Unassigned") else ra.clean_names([assigned_team])
            existing_op = next((o for o in _get_all_rescue_operations() if o["id"] == op_id), None)
            current_names = _op_worker_names(existing_op, _active_assignments()) if existing_op else []
            current_keys = {ra.worker_key(n) for n in current_names}
            if current_names and {ra.worker_key(n) for n in requested} != current_keys:
                return jsonify({"message": "This operation already has a team. Use Manage Team to add or remove workers."}), 409
            _apply_assignment(op_id, add=requested)
        except AssignmentError as error:
            return jsonify({"message": str(error)}), error.status
        assigned_team = None
    else:
        busy_operation = _worker_has_active_operation(assigned_team, exclude_operation_id=op_id)
        if busy_operation:
            return jsonify({
                "message": f"{assigned_team} is already assigned to active operation {busy_operation['id']}."
            }), 409

    result = None
    for op in MEMORY_RESCUE_OPS:
        if op["id"] == op_id:
            if new_status:
                op["status"] = new_status
            if risk_level:
                op["risk_level"] = risk_level
            op["updated_at"] = updated_at
            if assigned_team is not None:
                op["assigned_team"] = assigned_team or "Unassigned"
            if needs_backup is not None:
                op["needs_backup"] = bool(needs_backup)
            if new_status == "Completed":
                op["completed_at"] = completed_at
                op["people_rescued"] = people_rescued
                op["resources_used"] = resources_used
                op["completion_notes"] = completion_notes
            result = op
            break

    if DB_AVAILABLE:
        try:
            needs_backup_db = (1 if needs_backup else 0) if needs_backup is not None else None
            cursor.execute(
                "UPDATE rescue_operations SET "
                "status = COALESCE(?, status), updated_at = ?, "
                "risk_level = COALESCE(?, risk_level), "
                "assigned_team = COALESCE(?, assigned_team), completed_at = COALESCE(?, completed_at), "
                "people_rescued = COALESCE(?, people_rescued), resources_used = COALESCE(?, resources_used), "
                "completion_notes = COALESCE(?, completion_notes), needs_backup = COALESCE(?, needs_backup) WHERE id = ?",
                (new_status, updated_at_value, risk_level, assigned_team, completed_at_value, people_rescued, resources_used, completion_notes, needs_backup_db, op_id)
            )
            conn.commit()
            if result is None:
                cursor.execute("SELECT * FROM rescue_operations WHERE id = ?", (op_id,))
                row = cursor.fetchone()
                if row:
                    result = {
                        "id": row.id, "location": row.location, "description": row.description,
                        "risk_level": row.risk_level, "assigned_team": row.assigned_team, "status": row.status,
                        "created_at": str(row.created_at), "updated_at": str(row.updated_at),
                        "completed_at": str(row.completed_at) if row.completed_at else None,
                        "people_rescued": row.people_rescued, "resources_used": row.resources_used,
                        "completion_notes": row.completion_notes,
                        "needs_backup": bool(getattr(row, "needs_backup", False)),
                        "update_log": getattr(row, "update_log", None),
                    }
        except Exception as db_error:
            log_event("error", f"Failed to update rescue operation in database: {db_error}")

    if new_status == "Completed":
        _release_operation_workers(op_id)

    # Sync status back to linked community reports
    target_report_status = "Resolved" if new_status == "Completed" else ("Action Taken" if new_status == "In Progress" else "Under Review")
    if DB_AVAILABLE and new_status:
        try:
            cursor.execute("UPDATE community_reports SET status = ? WHERE linked_rescue_op_id = ?", (target_report_status, op_id))
            conn.commit()
        except Exception as sync_err:
            print("REPORT STATUS SYNC ERROR:", sync_err)

    for r in MEMORY_COMMUNITY_REPORTS:
        if new_status and r.get("linked_rescue_op_id") == op_id:
            r["status"] = target_report_status

    if result is None:
        return jsonify({"message": "Rescue operation not found"}), 404
    return jsonify(result)


@app.route("/rescue-operations/<int:op_id>", methods=["DELETE"])
def delete_rescue_operation(op_id):
    """Removes an operation entirely — for stuck/duplicate test entries
    (e.g. ones left over from an earlier id-mismatch bug) that a coordinator
    wants off the board rather than something to keep acting on."""
    global MEMORY_RESCUE_OPS
    _release_operation_workers(op_id)
    before = len(MEMORY_RESCUE_OPS)
    MEMORY_RESCUE_OPS = [o for o in MEMORY_RESCUE_OPS if o["id"] != op_id]
    removed_from_memory = len(MEMORY_RESCUE_OPS) != before

    removed_from_db = False
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM rescue_operations WHERE id = ?", (op_id,))
            removed_from_db = cursor.rowcount > 0
            conn.commit()
        except Exception as db_error:
            log_event("error", f"Failed to delete rescue operation from database: {db_error}")

    if not removed_from_memory and not removed_from_db:
        return jsonify({"message": "Rescue operation not found"}), 404
    return jsonify({"message": "Rescue operation deleted"})

@app.route("/rescue-operations/<int:op_id>/checklist", methods=["PUT"])
def update_op_checklist(op_id):
    """Toggles one checklist item (Evacuation started / Medical check / etc.)
    so an operation's progress can be tracked step by step instead of only
    as one big 'In Progress' -> 'Completed' jump."""
    data = request.json or {}
    try:
        item_index = int(data.get("item_index"))
    except (TypeError, ValueError):
        return jsonify({"message": "item_index is required"}), 400
    done = bool(data.get("done"))

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT checklist FROM rescue_operations WHERE id = ?", (op_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({"message": "Rescue operation not found"}), 404
            checklist = json.loads(row.checklist) if row.checklist else [dict(item) for item in DEFAULT_OP_CHECKLIST]
            if not (0 <= item_index < len(checklist)):
                return jsonify({"message": "Invalid item_index"}), 400
            checklist[item_index]["done"] = done
            cursor.execute("UPDATE rescue_operations SET checklist = ? WHERE id = ?", (json.dumps(checklist), op_id))
            conn.commit()
            for op in MEMORY_RESCUE_OPS:
                if op["id"] == op_id:
                    op["checklist"] = checklist
            return jsonify({"checklist": checklist})
        except Exception as e:
            log_event("error", f"Failed to update checklist in database: {e}")
            return jsonify({"message": "Could not update the checklist — please try again."}), 503

    for op in MEMORY_RESCUE_OPS:
        if op["id"] == op_id:
            checklist = op.get("checklist") or [dict(item) for item in DEFAULT_OP_CHECKLIST]
            if not (0 <= item_index < len(checklist)):
                return jsonify({"message": "Invalid item_index"}), 400
            checklist[item_index]["done"] = done
            op["checklist"] = checklist
            return jsonify({"checklist": checklist})
    return jsonify({"message": "Rescue operation not found"}), 404

@app.route("/rescue-operations/<int:op_id>/note", methods=["POST"])
def add_rescue_operation_note(op_id):
    """Lets a rescue worker log an in-progress update (e.g. 'en route',
    'arrived, beginning evacuation') without having to wait until the
    operation is fully completed to record anything."""
    data = request.json or {}
    note_text = (data.get("note") or "").strip()
    if not note_text:
        return jsonify({"message": "Note text is required"}), 400

    entry = {"timestamp": str(datetime.now()), "note": note_text}
    result = None

    for op in MEMORY_RESCUE_OPS:
        if op["id"] == op_id:
            existing_log = op.get("update_log")
            log_list = json.loads(existing_log) if isinstance(existing_log, str) and existing_log else (existing_log or [])
            log_list.append(entry)
            op["update_log"] = log_list
            result = op
            break

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT update_log FROM rescue_operations WHERE id = ?", (op_id,))
            row = cursor.fetchone()
            existing_log = getattr(row, "update_log", None) if row else None
            log_list = json.loads(existing_log) if existing_log else []
            log_list.append(entry)
            cursor.execute("UPDATE rescue_operations SET update_log = ? WHERE id = ?", (json.dumps(log_list), op_id))
            conn.commit()
            if result is None and row is not None:
                result = {"id": op_id, "update_log": log_list}
        except Exception as db_error:
            log_event("error", f"Failed to add note to rescue operation: {db_error}")

    if result is None:
        return jsonify({"message": "Rescue operation not found"}), 404
    return jsonify({"message": "Note added", "update_log": result.get("update_log", [entry])})

# ---------------- SHELTERS (FR-07) ----------------
MEMORY_SHELTERS = []

def clean_shelter_name(name):
    if not name:
        return name
    return name.replace(" (Potential Shelter Site)", "").replace(" (ممکنہ پناہ گاہ)", "").strip()

@app.route("/shelters", methods=["GET"])
def get_shelters():
    shelter_map = {}
    for s in MEMORY_SHELTERS:
        item = dict(s)
        item["name"] = clean_shelter_name(item.get("name"))
        if item.get("name_ur"):
            item["name_ur"] = clean_shelter_name(item.get("name_ur"))
        item["occupancy"] = int(item.get("occupancy", 0) or 0)
        shelter_map[item["id"]] = item

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT id, name, address, capacity, contact, latitude, longitude, verified, occupancy FROM shelters ORDER BY id DESC")
            for row in cursor.fetchall():
                sid = row.id
                db_occ = int(getattr(row, "occupancy", 0) or 0)
                db_ver = bool(getattr(row, "verified", 0))
                if sid in shelter_map:
                    shelter_map[sid]["occupancy"] = db_occ
                    shelter_map[sid]["verified"] = db_ver
                else:
                    shelter_map[sid] = {
                        "id": sid, "name": clean_shelter_name(row.name), "name_ur": None, "address": row.address,
                        "capacity": row.capacity, "contact": row.contact,
                        "latitude": row.latitude, "longitude": row.longitude,
                        "verified": db_ver, "occupancy": db_occ,
                    }
        except Exception as e:
            print("SHELTERS DB ERROR:", e)
    res = list(shelter_map.values())
    res.sort(key=lambda x: x["id"])
    return jsonify(res)

@app.route("/shelters", methods=["POST"])
def create_shelter():
    data = request.json or {}
    name = (data.get("name") or "").strip()
    address = (data.get("address") or "").strip()
    if not name or not address:
        return jsonify({"message": "Name and address are required"}), 400

    # FR07-04: reject duplicate entries with the same name and address
    existing = [s for s in MEMORY_SHELTERS if s["name"].lower() == name.lower() and s["address"].lower() == address.lower()]
    if existing:
        return jsonify({"message": "A shelter with this name and address already exists"}), 400

    lat = safe_float(data.get("latitude"), None) if data.get("latitude") not in (None, "") else None
    lng = safe_float(data.get("longitude"), None) if data.get("longitude") not in (None, "") else None
    if lat is None or lng is None:
        coords = resolve_coordinates(address) or resolve_coordinates(name)
        if coords:
            lat, lng = coords

    shelter = {
        "id": None,
        "name": name, "name_ur": data.get("name_ur") or None, "address": address,
        "capacity": data.get("capacity"), "contact": data.get("contact", ""),
        "latitude": lat,
        "longitude": lng,
        "verified": False, "occupancy": 0,
    }
    if DB_AVAILABLE:
        try:
            if DB_TYPE == "sql_server":
                cursor.execute("SELECT COUNT(*) AS c FROM shelters WHERE CAST(name AS VARCHAR(MAX))=? AND CAST(address AS VARCHAR(MAX))=?", (name, address))
            else:
                cursor.execute("SELECT COUNT(*) AS c FROM shelters WHERE LOWER(name)=LOWER(?) AND LOWER(address)=LOWER(?)", (name, address))
            row_count = cursor.fetchone()
            count_val = getattr(row_count, 'c', 0) if row_count else (row_count[0] if row_count else 0)
            if count_val == 0:
                new_id = _db_insert_get_id(
                    "INSERT INTO shelters (name, address, capacity, contact, latitude, longitude, verified, occupancy) VALUES (?,?,?,?,?,?,?,?)",
                    (name, address, shelter["capacity"], shelter["contact"], shelter["latitude"], shelter["longitude"], 0, 0)
                )
                shelter["id"] = new_id
            else:
                return jsonify({"message": "A shelter with this name and address already exists"}), 400
        except Exception as e:
            print(f"[ERROR] Failed to save shelter: {e}")
            return jsonify({"message": "Could not save shelter"}), 503
    else:
        shelter["id"] = max([s["id"] for s in MEMORY_SHELTERS], default=0) + 1
        MEMORY_SHELTERS.append(shelter)
        MEMORY_SHELTERS.append(shelter)

    return jsonify(shelter), 201

@app.route("/shelters/<int:shelter_id>", methods=["PUT"])
def update_shelter(shelter_id):
    data = request.json or {}
    updated = None
    for s in MEMORY_SHELTERS:
        if s["id"] == shelter_id:
            s.update({k: data[k] for k in ("name", "address", "capacity", "contact", "latitude", "longitude") if k in data})
            updated = s
            break

    if DB_AVAILABLE:
        try:
            cursor.execute(
                "UPDATE shelters SET name=COALESCE(?,name), address=COALESCE(?,address), capacity=COALESCE(?,capacity), contact=COALESCE(?,contact), latitude=COALESCE(?,latitude), longitude=COALESCE(?,longitude) WHERE id=?",
                (data.get("name"), data.get("address"), data.get("capacity"), data.get("contact"),
                 data.get("latitude"), data.get("longitude"), shelter_id)
            )
            conn.commit()
        except Exception as e:
            print("Failed to update shelter in database:", e)

    if not updated and not DB_AVAILABLE:
        return jsonify({"message": "Shelter not found"}), 404
    return jsonify(updated or {"id": shelter_id, **data})

@app.route("/shelters/<int:shelter_id>/verify", methods=["PUT"])
def verify_shelter(shelter_id):
    """Lets an admin mark a shelter as verified (address/contact personally
    confirmed) once they've actually checked it — separate from the general
    update endpoint so this single flag can never be accidentally wiped out
    by an unrelated edit that doesn't mention it."""
    data = request.json or {}
    verified = bool(data.get("verified", True))
    for s in MEMORY_SHELTERS:
        if s["id"] == shelter_id:
            s["verified"] = verified
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE shelters SET verified = ? WHERE id = ?", (1 if verified else 0, shelter_id))
            conn.commit()
        except Exception as e:
            print("Failed to update shelter verification:", e)
    return jsonify({"id": shelter_id, "verified": verified})

@app.route("/shelters/<int:shelter_id>/occupancy", methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"])
def update_shelter_occupancy(shelter_id):
    if request.method == "OPTIONS":
        return jsonify({"ok": True}), 200
    data = request.get_json(force=True, silent=True) or request.json or {}
    try:
        occupancy = max(0, int(data.get("occupancy", 0)))
    except (TypeError, ValueError):
        return jsonify({"message": "occupancy must be a number"}), 400
    for s in MEMORY_SHELTERS:
        if s["id"] == shelter_id:
            s["occupancy"] = occupancy
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE shelters SET occupancy = ? WHERE id = ?", (occupancy, shelter_id))
            conn.commit()
        except Exception as e:
            print("Failed to update shelter occupancy:", e)
    return jsonify({"id": shelter_id, "occupancy": occupancy})

@app.route("/shelters/<int:shelter_id>", methods=["DELETE"])
def delete_shelter(shelter_id):
    MEMORY_SHELTERS[:] = [s for s in MEMORY_SHELTERS if s["id"] != shelter_id]
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM shelters WHERE id = ?", (shelter_id,))
            conn.commit()
        except Exception as e:
            print("Failed to delete shelter from database:", e)
    return jsonify({"message": "Shelter deleted successfully"})

# ---------------- HOSPITALS (FR-08) ----------------
MEMORY_HOSPITALS = []

@app.route("/hospitals", methods=["GET"])
def get_hospitals():
    hospital_dict = {}
    for h in MEMORY_HOSPITALS:
        item = dict(h)
        item["occupancy"] = int(item.get("occupancy", 0) or 0)
        item["capacity"] = int(item.get("capacity", 50) or 50)
        hospital_dict[item["id"]] = item

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT id, name, address, contact, services, latitude, longitude, verified, occupancy FROM hospitals ORDER BY id DESC")
            for row in cursor.fetchall():
                hid = row.id
                db_occ = int(getattr(row, "occupancy", 0) or 0)
                db_ver = bool(getattr(row, "verified", 0))
                if hid in hospital_dict:
                    hospital_dict[hid]["occupancy"] = db_occ
                    hospital_dict[hid]["verified"] = db_ver
                    if row.name: hospital_dict[hid]["name"] = row.name
                    if row.address: hospital_dict[hid]["address"] = row.address
                else:
                    hospital_dict[hid] = {
                        "id": hid, "name": row.name, "name_ur": None, "address": row.address,
                        "contact": row.contact, "services": row.services,
                        "latitude": row.latitude, "longitude": row.longitude,
                        "verified": db_ver,
                        "occupancy": db_occ,
                        "capacity": 50,
                    }
        except Exception as e:
            print("HOSPITALS DB ERROR:", e)

    res = list(hospital_dict.values())
    res.sort(key=lambda x: x["id"])
    return jsonify(res)

@app.route("/hospitals", methods=["POST"])
def create_hospital():
    data = request.json or {}
    name = (data.get("name") or "").strip()
    address = (data.get("address") or "").strip()
    if not name or not address:
        return jsonify({"message": "Name and address are required"}), 400

    # FR08-04: prevent duplicate entries
    existing = [h for h in MEMORY_HOSPITALS if h["name"].lower() == name.lower() and h["address"].lower() == address.lower()]
    if existing:
        return jsonify({"message": "A hospital with this name and address already exists"}), 400

    lat = safe_float(data.get("latitude"), None) if data.get("latitude") not in (None, "") else None
    lng = safe_float(data.get("longitude"), None) if data.get("longitude") not in (None, "") else None
    if lat is None or lng is None:
        coords = resolve_coordinates(address) or resolve_coordinates(name)
        if coords:
            lat, lng = coords

    hospital = {
        "id": None,
        "name": name, "name_ur": data.get("name_ur") or None, "address": address,
        "contact": data.get("contact", ""), "services": data.get("services", ""),
        "latitude": lat,
        "longitude": lng,
        "verified": False,
        "occupancy": 0,
        "capacity": 50,
    }
    if DB_AVAILABLE:
        try:
            if DB_TYPE == "sql_server":
                cursor.execute("SELECT COUNT(*) AS c FROM hospitals WHERE CAST(name AS VARCHAR(MAX))=? AND CAST(address AS VARCHAR(MAX))=?", (name, address))
            else:
                cursor.execute("SELECT COUNT(*) AS c FROM hospitals WHERE LOWER(name)=LOWER(?) AND LOWER(address)=LOWER(?)", (name, address))
            row_count = cursor.fetchone()
            count_val = getattr(row_count, 'c', 0) if row_count else (row_count[0] if row_count else 0)
            if count_val == 0:
                new_id = _db_insert_get_id(
                    "INSERT INTO hospitals (name, address, contact, services, latitude, longitude, verified, occupancy) VALUES (?,?,?,?,?,?,?,?)",
                    (name, address, hospital["contact"], hospital["services"], hospital["latitude"], hospital["longitude"], 0, 0)
                )
                hospital["id"] = new_id
            else:
                return jsonify({"message": "A hospital with this name and address already exists"}), 400
        except Exception as e:
            print(f"[ERROR] Failed to save hospital: {e}")
            return jsonify({"message": "Could not save hospital"}), 503
    else:
        hospital["id"] = max([h["id"] for h in MEMORY_HOSPITALS], default=0) + 1
        MEMORY_HOSPITALS.append(hospital)

    return jsonify(hospital), 201

@app.route("/hospitals/<int:hospital_id>", methods=["PUT"])
def update_hospital(hospital_id):
    data = request.json or {}
    updated = None
    for h in MEMORY_HOSPITALS:
        if h["id"] == hospital_id:
            h["name"] = data.get("name", h["name"])
            h["address"] = data.get("address", h["address"])
            h["contact"] = data.get("contact", h["contact"])
            h["services"] = data.get("services", h["services"])
            if "latitude" in data: h["latitude"] = safe_float(data["latitude"], None)
            if "longitude" in data: h["longitude"] = safe_float(data["longitude"], None)
            updated = h
            break
    if DB_AVAILABLE:
        try:
            cursor.execute(
                "UPDATE hospitals SET name=COALESCE(?,name), address=COALESCE(?,address), contact=COALESCE(?,contact), services=COALESCE(?,services), latitude=COALESCE(?,latitude), longitude=COALESCE(?,longitude) WHERE id=?",
                (data.get("name"), data.get("address"), data.get("contact"), data.get("services"), safe_float(data.get("latitude"), None), safe_float(data.get("longitude"), None), hospital_id)
            )
            conn.commit()
        except Exception as e:
            print("Failed to update hospital in database:", e)
    return jsonify(updated or {"id": hospital_id})

@app.route("/hospitals/<int:hospital_id>/verify", methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"])
def verify_hospital(hospital_id):
    if request.method == "OPTIONS":
        return jsonify({"ok": True}), 200
    data = request.json or {}
    verified = bool(data.get("verified", True))
    for h in MEMORY_HOSPITALS:
        if h["id"] == hospital_id:
            h["verified"] = verified
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE hospitals SET verified = ? WHERE id = ?", (1 if verified else 0, hospital_id))
            conn.commit()
        except Exception as e:
            print("Failed to update hospital verification:", e)
    return jsonify({"id": hospital_id, "verified": verified})

@app.route("/hospitals/<int:hospital_id>/occupancy", methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"])
def update_hospital_occupancy(hospital_id):
    if request.method == "OPTIONS":
        return jsonify({"ok": True}), 200
    data = request.get_json(force=True, silent=True) or request.json or {}
    try:
        occupancy = max(0, int(data.get("occupancy", 0)))
    except (TypeError, ValueError):
        return jsonify({"message": "occupancy must be a number"}), 400
    for h in MEMORY_HOSPITALS:
        if h["id"] == hospital_id:
            h["occupancy"] = occupancy
            break

    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE hospitals SET occupancy = ? WHERE id = ?", (occupancy, hospital_id))
            conn.commit()
        except Exception as e:
            print("Failed to update hospital occupancy:", e)
    return jsonify({"id": hospital_id, "occupancy": occupancy})

@app.route("/hospitals/<int:hospital_id>", methods=["DELETE"])
def delete_hospital(hospital_id):
    MEMORY_HOSPITALS[:] = [h for h in MEMORY_HOSPITALS if h["id"] != hospital_id]
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM hospitals WHERE id = ?", (hospital_id,))
            conn.commit()
        except Exception as e:
            print("Failed to delete hospital from database:", e)
    return jsonify({"message": "Hospital deleted successfully"})

MEMORY_COMMUNITY_REPORTS = []

@app.route("/community-reports", methods=["GET"])
def get_community_reports():
    # Previously this appended DB rows on top of MEMORY_COMMUNITY_REPORTS with
    # no de-duplication — and since a freshly-created report's memory copy and
    # database row didn't share the same id (see the old create_community_report),
    # the exact same report showed up twice, sometimes with two different
    # statuses depending on which copy a later action happened to update.
    # Ids are now kept in sync at creation time (see below), so a simple
    # "skip if already seen" here is enough to guarantee one entry per report.
    data = list(MEMORY_COMMUNITY_REPORTS)
    seen_ids = {r["id"] for r in data}
    email_filter = (request.args.get("email") or "").strip().lower()
    if DB_AVAILABLE:
        try:
            cursor.execute("""SELECT id, tracking_id, location, region, incident_type, severity, status,
                               author_name, author_email, description, contact, latitude, longitude, image_url, notes, created_at, linked_rescue_op_id
                               FROM community_reports ORDER BY created_at DESC""")
            for row in cursor.fetchall():
                if row.id in seen_ids:
                    continue
                data.append({
                    "id": row.id, "trackingId": row.tracking_id, "location": row.location,
                    "region": row.region, "type": row.incident_type, "severity": row.severity,
                    "status": row.status, "authorName": row.author_name, "authorEmail": row.author_email,
                    "description": row.description, "contact": row.contact, "latitude": row.latitude,
                    "longitude": row.longitude, "imageUrl": row.image_url, "linked_rescue_op_id": getattr(row, "linked_rescue_op_id", None),
                    "notes": row.notes, "createdAt": row.created_at.isoformat() if row.created_at else None,
                    "confirmedBy": [],
                })
                seen_ids.add(row.id)
        except Exception as e:
            print("COMMUNITY REPORTS DB ERROR:", e)
    if request.path == '/community-reports':
        from notifications import identity
        actor = identity()
        if actor.get('role') not in ('admin','government_official','rescue_worker'):
            email_filter = actor.get('email') or '__no_authenticated_reports__'
    if email_filter:
        data = [r for r in data if (r.get("authorEmail") or "").strip().lower() == email_filter]
    return jsonify(data)

@app.route("/community-stats", methods=["GET"])
def get_community_stats():
    # Aggregate only; individual citizen reports remain private.
    response = get_community_reports()
    records = response.get_json()
    active = [r for r in records if r.get("status") not in ("Resolved", "Rejected", "Spam")]
    regions = {str(r.get("region") or "").strip().casefold() for r in active}
    regions.discard("")
    return jsonify(active_incidents=len(active), monitored_regions=len(regions))

@app.route("/community-reports", methods=["POST"])
def create_community_report():
    data = request.json or {}
    location = (data.get("location") or "").strip()
    description = (data.get("description") or "").strip()
    contact = (data.get("contact") or "").strip()
    from report_validation import validate_report
    field_errors = validate_report(data)
    if field_errors:
        return jsonify(message='Please correct the highlighted fields.', errors=field_errors), 400
    image_url = data.get('imageUrl') or ''
    latitude = safe_float(data.get("latitude"), None) if data.get("latitude") not in (None, "") else None
    longitude = safe_float(data.get("longitude"), None) if data.get("longitude") not in (None, "") else None
    if (latitude is None) != (longitude is None):
        return jsonify({"message": "Latitude and longitude must be provided together"}), 400
    if latitude is not None and not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({"message": "Coordinates are outside valid latitude/longitude ranges"}), 400

    if latitude is None and longitude is None:
        from map_support import resolve_report_address
        resolved = resolve_report_address(location)
        if not resolved:
            return jsonify(message='Please correct the highlighted field.',
                           errors={'location':'Address could not be verified. Enter a complete address including city, or use your current location.'}), 400
        latitude, longitude = resolved['latitude'], resolved['longitude']
        if not data.get('region'):
            data['region'] = resolved.get('region', '')

    from notifications import identity
    actor = identity()
    if actor.get('email'):
        data['authorEmail'] = actor['email']
        data['authorName'] = actor.get('name') or data.get('authorName')
    report = {
        "location": location,
        "region": data.get("region", ""),
        "type": data.get("type", "Flooding"),
        "severity": data.get("severity", "High"),
        "status": "Submitted",  # FR06-01
        "authorName": data.get("authorName", "Guest User"),
        "authorEmail": data.get("authorEmail", ""),
        "description": description,
        "contact": contact,
        "latitude": latitude,
        "longitude": longitude,
        "imageUrl": data.get("imageUrl", ""),  # FR06-05
        "notes": "Incident added to the community review queue.",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "confirmedBy": [],
    }

    if DB_AVAILABLE:
        try:
            _purge_stale_community_report_tracking_ids()
            # tracking_id is derived from the row's real database id (assigned
            # AFTER insert), never from a count of existing rows. Counting
            # rows broke the moment anything was ever deleted: e.g. delete 2
            # reports, and the "next" count-based id collides with one still
            # sitting in the table, which fails on the tracking_id UNIQUE
            # constraint and made every new submission fail with an error —
            # even though the person filling the form did nothing wrong.
            new_id = _db_insert_get_id(
                "INSERT INTO community_reports (tracking_id, location, region, incident_type, severity, status, "
                "author_name, author_email, description, contact, latitude, longitude, image_url, notes, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (None, location, report["region"], report["type"], report["severity"], report["status"],
                 report["authorName"], report["authorEmail"], description, contact, latitude, longitude,
                 report["imageUrl"], report["notes"], datetime.now(timezone.utc).replace(tzinfo=None))
            )
            tracking_id = f"FMS-{1000 + new_id}"
            cursor.execute("UPDATE community_reports SET tracking_id = ? WHERE id = ?", (tracking_id, new_id))
            conn.commit()
            report["id"] = new_id
            report["trackingId"] = tracking_id
        except Exception as db_error:
            log_event("error", f"Failed to save community report to database: {db_error}")
            return jsonify({"message": "Could not save the report — please try again."}), 503
    else:
        report["id"] = (max([r["id"] for r in MEMORY_COMMUNITY_REPORTS], default=0) + 1)
        report["trackingId"] = f"FMS-{1000 + report['id']}"
        MEMORY_COMMUNITY_REPORTS.append(report)

    # FR06-03: acknowledgment happens via the tracking_id returned in this response
    return jsonify(report), 201

@app.route("/community-reports/<int:report_id>/status", methods=["PUT"])
def update_community_report_status(report_id):
    data = request.json or {}
    new_status = data.get("status")
    valid_statuses = ("Submitted", "Under Review", "Action Taken", "Resolved", "Approved", "Rejected", "Spam", "Converted to Alert", "Converted to Rescue Op")
    if new_status not in valid_statuses:
        return jsonify({"message": "Invalid status"}), 400

    if DB_AVAILABLE:
        try:
            cursor.execute("""SELECT id, tracking_id, location, region, incident_type, severity, status,
                               author_name, author_email, description, contact, latitude, longitude, image_url, notes, created_at, linked_rescue_op_id
                               FROM community_reports WHERE id = ?""", (report_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({"message": "Report not found"}), 404
            r = {
                "id": row.id, "trackingId": row.tracking_id, "location": row.location,
                "region": row.region, "type": row.incident_type, "severity": row.severity,
                "status": row.status, "authorName": row.author_name, "authorEmail": row.author_email,
                "description": row.description, "contact": row.contact, "latitude": row.latitude,
                "longitude": row.longitude, "imageUrl": row.image_url, "linked_rescue_op_id": getattr(row, "linked_rescue_op_id", None),
                "notes": row.notes, "createdAt": row.created_at.isoformat() if row.created_at else None,
                "confirmedBy": [],
            }
            r["status"] = new_status
            linked_op = None

            # FR06-04 made real: moving a report to "Action Taken" creates an
            # actual Rescue Operation (FR-05) linked back to this report,
            # instead of just flipping a status label.
            if new_status == "Action Taken" and not r.get("linked_rescue_op_id"):
                try:
                    linked_op = _create_rescue_op_internal(
                        location=r["location"],
                        description=f"Community report {r['trackingId']}: {r['description']}",
                        risk_level=r.get("severity", "Medium"),
                        assigned_team=data.get("assigned_team", "Unassigned"),
                        latitude=r.get("latitude"), longitude=r.get("longitude"),
                    )
                except Exception:
                    return jsonify({"message": "Could not create the rescue operation — please try again."}), 503
                r["notes"] = f"Action taken — Rescue Operation #{linked_op['id']} created and dispatched to {r['location']}."
            else:
                r["notes"] = f"Status updated to {new_status}."

            if linked_op: r['linked_rescue_op_id'] = linked_op['id']
            cursor.execute("UPDATE community_reports SET status = ?, notes = ?, linked_rescue_op_id = ? WHERE id = ?", (r["status"], r["notes"], r.get('linked_rescue_op_id'), report_id))
            conn.commit()
            if linked_op:
                r["linked_rescue_op"] = linked_op
            return jsonify(r)
        except Exception as e:
            log_event("error", f"Failed to update community report in database: {e}")
            return jsonify({"message": "Could not update the report — please try again."}), 503

    for r in MEMORY_COMMUNITY_REPORTS:
        if r["id"] == report_id:
            r["status"] = new_status
            if new_status == "Action Taken" and not r.get("linked_rescue_op_id"):
                try:
                    linked_op = _create_rescue_op_internal(
                        location=r["location"], description=f"Community report {r['trackingId']}: {r['description']}",
                        risk_level=r.get("severity", "Medium"), assigned_team=data.get("assigned_team", "Unassigned"),
                        latitude=r.get("latitude"), longitude=r.get("longitude"),
                    )
                except Exception:
                    r["status"] = "Submitted"
                    return jsonify({"message": "Could not create the rescue operation — please try again."}), 503
                r["linked_rescue_op_id"] = linked_op["id"]
                r["notes"] = f"Action taken — Rescue Operation #{linked_op['id']} created and dispatched to {r['location']}."
                r["linked_rescue_op"] = linked_op
            else:
                r["notes"] = f"Status updated to {new_status}."
            return jsonify(r)
    return jsonify({"message": "Report not found"}), 404

# ---------------- BLOCKED ROADS (FR-04) ----------------
MEMORY_BLOCKED_ROADS = []

@app.route("/blocked-roads", methods=["GET"])
def get_blocked_roads():
    data = list(MEMORY_BLOCKED_ROADS)
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT id, name, location, latitude, longitude, reason, status FROM blocked_roads ORDER BY id DESC")
            for row in cursor.fetchall():
                data.append({
                    "id": row.id, "name": row.name, "location": row.location,
                    "latitude": row.latitude, "longitude": row.longitude,
                    "reason": row.reason, "status": row.status,
                })
        except Exception as e:
            print("BLOCKED ROADS DB ERROR:", e)
    return jsonify(data)

@app.route("/blocked-roads", methods=["POST"])
def create_blocked_road():
    data = request.json or {}
    name = (data.get("name") or "").strip()
    location = (data.get("location") or "").strip()
    if not name or not location:
        return jsonify({"message": "Road name and location are required"}), 400

    coords = resolve_coordinates(location)
    lat = safe_float(data.get("latitude"), None) if data.get("latitude") not in (None, "") else (coords[0] if coords else None)
    lng = safe_float(data.get("longitude"), None) if data.get("longitude") not in (None, "") else (coords[1] if coords else None)

    road = {
        "id": None,
        "name": name, "location": location,
        "latitude": lat, "longitude": lng,
        "reason": data.get("reason", ""), "status": "Blocked",
    }
    if DB_AVAILABLE:
        try:
            cursor.execute(
                "INSERT INTO blocked_roads (name, location, latitude, longitude, reason, status) VALUES (?,?,?,?,?,?)",
                (name, location, lat, lng, road["reason"], "Blocked")
            )
            conn.commit()
            cursor.execute(
                "SELECT id FROM blocked_roads WHERE name = ? AND location = ? AND latitude IS ? AND longitude IS ? ORDER BY id DESC",
                (name, location, lat, lng),
            )
            saved_row = cursor.fetchone()
            if not saved_row:
                raise RuntimeError("Inserted blocked road could not be reloaded")
            road["id"] = saved_row.id
        except Exception as e:
            log_event("error", f"Failed to save blocked road to database: {e}")
            return jsonify({"message": "Could not save blocked road"}), 503
    else:
        road["id"] = max([r["id"] for r in MEMORY_BLOCKED_ROADS], default=0) + 1
        MEMORY_BLOCKED_ROADS.append(road)

    return jsonify(road), 201

@app.route("/blocked-roads/<int:road_id>", methods=["PUT"])
def update_blocked_road(road_id):
    data = request.json or {}
    fields = ("name", "location", "reason", "status", "latitude", "longitude")
    for field in ("name", "location"):
        if field in data and (not isinstance(data[field], str) or not data[field].strip()):
            return jsonify(message=f"{field} is required"), 400
    updated = None
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE blocked_roads SET " + ", ".join(f"{field}=COALESCE(?,{field})" for field in fields) + " WHERE id=?", tuple(data.get(field) for field in fields) + (road_id,))
            if cursor.rowcount == 0:
                return jsonify(message="Blocked road not found"), 404
            conn.commit()
        except Exception as error:
            log_event("error", f"Failed to update blocked road: {error}")
            return jsonify(message="Could not update blocked road"), 503
    for road in MEMORY_BLOCKED_ROADS:
        if road["id"] == road_id:
            road.update({field:data[field] for field in fields if field in data})
            updated = road
            break
    if not updated and not DB_AVAILABLE:
        return jsonify(message="Blocked road not found"), 404
    return jsonify(updated or {"id":road_id, **data})

@app.route("/blocked-roads/<int:road_id>", methods=["DELETE"])
def delete_blocked_road(road_id):
    MEMORY_BLOCKED_ROADS[:] = [r for r in MEMORY_BLOCKED_ROADS if r["id"] != road_id]
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM blocked_roads WHERE id = ?", (road_id,))
            conn.commit()
        except Exception as e:
            print("Failed to delete blocked road:", e)
    return jsonify({"message": "Blocked road removed"})

# ---------------- MAP MARKERS (FR-04: aggregated view for the interactive map) ----------------
@app.route("/map-markers", methods=["GET"])
def get_map_markers():
    """
    Combines shelters, hospitals, rescue operations, community reports and
    blocked roads into one color-coded, filterable feed for the map (FR04-01,
    FR04-02, FR04-06, FR04-07, FR04-08). Records that only have a free-text
    location (rescue ops, community reports) are placed at their city's
    center coordinates.
    """
    markers = []

    shelters_resp = get_shelters()
    for s in shelters_resp.json:
        coords = (s["latitude"], s["longitude"]) if s.get("latitude") and s.get("longitude") else (resolve_coordinates(s.get("address")) or resolve_coordinates(s.get("name")))
        if coords:
            markers.append({"id": f"shelter-{s['id']}", "type": "shelter", "category_color": "teal",
                             "name": s["name"], "name_ur": s.get("name_ur"), "location": s.get("address"),
                             "capacity": s.get("capacity"), "contact": s.get("contact"),
                             "verified": s.get("verified", False), "occupancy": s.get("occupancy"),
                             "latitude": coords[0], "longitude": coords[1]})

    hospitals_resp = get_hospitals()
    for h in hospitals_resp.json:
        coords = (h["latitude"], h["longitude"]) if h.get("latitude") and h.get("longitude") else (resolve_coordinates(h.get("address")) or resolve_coordinates(h.get("name")))
        if coords:
            markers.append({"id": f"hospital-{h['id']}", "type": "hospital", "category_color": "marigold",
                             "name": h["name"], "name_ur": h.get("name_ur"), "location": h.get("address"),
                             "services": h.get("services"), "contact": h.get("contact"),
                             "verified": h.get("verified", False),
                             "latitude": coords[0], "longitude": coords[1]})

    ops_resp = get_rescue_operations()
    for op in ops_resp.json:
        if op.get("status") not in ("Assigned", "In Progress"):
            continue
        coords = (op["latitude"], op["longitude"]) if op.get("latitude") is not None and op.get("longitude") is not None else resolve_coordinates(op.get("location", ""))
        if coords:
            markers.append({"id": f"rescue-{op['id']}", "type": "rescue_operation",
                             "category_color": "violet",
                             "name": f"Rescue: {op.get('location')}", "location": op.get("description", ""),
                             "status": op.get("status"), "risk_level": op.get("risk_level"),
                             "latitude": coords[0], "longitude": coords[1]})

    reports_resp = get_community_reports()
    for rep in reports_resp.json:
        latitude = rep.get("latitude")
        longitude = rep.get("longitude")
        if latitude is not None and longitude is not None:
            markers.append({"id": f"report-{rep['id']}", "type": "community_report",
                             "category_color": "white",
                             "name": f"Report: {rep.get('type')}", "location": rep.get("location"),
                             "status": rep.get("status"), "severity": rep.get("severity"),
                             "report_id":rep["id"], "trackingId":rep.get("trackingId"), "description":rep.get("description"), "imageUrl":rep.get("imageUrl"),
                             "latitude": latitude, "longitude": longitude})

    roads_resp = get_blocked_roads()
    for r in roads_resp.json:
        if r.get("latitude") and r.get("longitude") and r.get("status") == "Blocked":
            markers.append({"id": f"road-{r['id']}", "type": "blocked_road", "category_color": "red",
                             "name": r["name"], "location": r.get("location"), "reason": r.get("reason"),
                             "latitude": r["latitude"], "longitude": r["longitude"]})

    # Latest risk level per city, for the risk-overlay layer (FR04-08)
    city_risk = {}
    preds_resp = get_predictions()
    for p in preds_resp.json:
        loc = p.get("location")
        if loc and loc not in city_risk:
            coords = resolve_coordinates(loc)
            if coords:
                city_risk[loc] = {"location": loc, "risk": p.get("risk"), "latitude": coords[0], "longitude": coords[1]}

    return jsonify({"markers": markers, "risk_zones": list(city_risk.values())})

# ---------------- MODEL RETRAINING (FR10-02) ----------------
@app.route("/admin/retrain-model", methods=["POST"])
def retrain_model():
    """
    FR10-02: allow the admin to upload new historical data and retrain the
    flood risk model. Expects a CSV with a 'flood_label' column and either
    the raw 'city' column (one-hot encoded here) or the already-encoded
    city_<Name> columns, plus the other trained attributes (temperature,
    humidity, wind_speed, soil_moisture_top, soil_7day_avg, month, year,
    is_monsoon, season, rain_intensity).
    """
    global scaler, model, MODEL_FEATURES, SHAP_EXPLAINER, ACTIVE_MODEL_NAME

    if "file" not in request.files:
        return jsonify({"message": "No CSV file uploaded"}), 400

    file = request.files["file"]
    try:
        df = pd.read_csv(file)
    except Exception as e:
        return jsonify({"message": f"Could not read CSV: {e}"}), 400

    if "flood_label" not in df.columns:
        return jsonify({"message": "CSV must include a 'flood_label' column (0=Low, 1=Medium, 2=High)"}), 400

    if "city" in df.columns:
        city_dummies = pd.get_dummies(df["city"], prefix="city")
        df = pd.concat([df, city_dummies], axis=1)

    missing = [f for f in MODEL_FEATURES if f not in df.columns]
    if missing:
        return jsonify({"message": f"CSV is missing required columns: {', '.join(missing)}"}), 400

    try:
        X = df[MODEL_FEATURES].astype(float)
        y = df["flood_label"].astype(int)

        new_scaler = MinMaxScaler()
        X_scaled = new_scaler.fit_transform(X)

        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y, test_size=0.2, random_state=42, stratify=y if y.nunique() > 1 else None
        )

        new_model = RandomForestClassifier(n_estimators=200, max_depth=15, random_state=42, class_weight="balanced")
        new_model.fit(X_train, y_train)
        accuracy = accuracy_score(y_test, new_model.predict(X_test))

        # FR10-04: minimum 80% accuracy required before deploying
        if accuracy < 0.80:
            return jsonify({
                "message": f"Retrained model scored {accuracy*100:.1f}% accuracy — below the required 80% minimum. Not deployed.",
                "accuracy": accuracy,
                "deployed": False,
            }), 200

        # Back up the current model files, then deploy the new ones
        model_dir = os.path.join(BASE_DIR, "model")
        backup_dir = os.path.join(model_dir, "backup_" + datetime.now().strftime("%Y%m%d_%H%M%S"))
        os.makedirs(backup_dir, exist_ok=True)
        for fname in ("flood_scaler.pkl", "flood_model_rf.pkl"):
            src = os.path.join(model_dir, fname)
            if os.path.exists(src):
                joblib.dump(joblib.load(src), os.path.join(backup_dir, fname))

        joblib.dump(new_scaler, os.path.join(model_dir, "flood_scaler.pkl"))
        joblib.dump(new_model, os.path.join(model_dir, "flood_model_rf.pkl"))

        # Hot-reload the model this server is actually using
        scaler = new_scaler
        model = new_model
        ACTIVE_MODEL_NAME = "Random Forest (retrained)"
        SHAP_EXPLAINER = None
        if SHAP_AVAILABLE:
            try:
                SHAP_EXPLAINER = shap.TreeExplainer(model)
            except Exception as e:
                print(f"Could not rebuild SHAP explainer after retrain: {e}")

        log_event("info", f"Model retrained and deployed — accuracy {accuracy*100:.1f}%")
        MEMORY_ACCURACY_HISTORY.append({
            "timestamp": str(datetime.now()), "model": "Random Forest (retrained)",
            "accuracy": accuracy, "training_rows": len(df),
        })
        return jsonify({
            "message": f"Model retrained and deployed successfully. Test accuracy: {accuracy*100:.1f}%.",
            "accuracy": accuracy,
            "deployed": True,
            "training_rows": len(df),
        })
    except Exception as e:
        print("RETRAIN ERROR:", e)
        return jsonify({"message": f"Retraining failed: {e}"}), 500

@app.route("/activity", methods=["GET"])
def get_activity():
    activity_items = []
    if DB_AVAILABLE:
        try:
            cursor.execute(
                "SELECT message, created_at FROM system_logs WHERE level = ? ORDER BY created_at DESC LIMIT 100",
                ("activity",),
            )
            for row in cursor.fetchall():
                try:
                    item = json.loads(getattr(row, "message", "") or "")
                except (TypeError, ValueError):
                    continue
                item["created_at"] = item.get("created_at") or str(getattr(row, "created_at", None))
                activity_items.append(item)
        except Exception as error:
            log_event("error", f"Failed to fetch recent activity: {error}")
            return jsonify({"message": "Could not load recent activity"}), 503
    else:
        for item in MEMORY_LOGS:
            if item.get("level") != "activity":
                continue
            try:
                activity_items.append(json.loads(item.get("message") or ""))
            except (TypeError, ValueError):
                continue
        activity_items.sort(key=lambda item: item.get("created_at", ""), reverse=True)

    return jsonify(activity_items[:100])

@app.route("/admin/logs", methods=["GET"])
def get_logs():
    all_logs = list(MEMORY_LOGS)
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT level, message, created_at FROM system_logs ORDER BY created_at DESC LIMIT 200")
            db_logs = [{"level": getattr(r, "level", None), "message": getattr(r, "message", None), "timestamp": str(getattr(r, "created_at", None))} for r in cursor.fetchall()]
            # DB logs already include everything MEMORY_LOGS has (since log_event
            # writes to both) — prefer the DB copy as authoritative once available.
            if db_logs:
                all_logs = db_logs
        except Exception as e:
            print(f"[LOGS] Failed to fetch from database: {e}")
    return jsonify(list(reversed(all_logs))[:100] if all_logs is MEMORY_LOGS else all_logs[:100])

# ---------------- COMMUNITY REPORT CONFIRMATIONS ----------------
@app.route("/community-reports/<int:report_id>", methods=["DELETE"])
def delete_community_report(report_id):
    global MEMORY_COMMUNITY_REPORTS
    before = len(MEMORY_COMMUNITY_REPORTS)
    MEMORY_COMMUNITY_REPORTS = [r for r in MEMORY_COMMUNITY_REPORTS if r["id"] != report_id]
    removed_from_memory = len(MEMORY_COMMUNITY_REPORTS) != before

    removed_from_db = False
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM community_reports WHERE id = ?", (report_id,))
            removed_from_db = cursor.rowcount > 0
            conn.commit()
        except Exception as e:
            log_event("error", f"Failed to delete community report from database: {e}")

    if not removed_from_memory and not removed_from_db:
        return jsonify({"message": "Report not found"}), 404
    return jsonify({"message": "Report deleted"})

@app.route("/community-reports/<int:report_id>/confirm", methods=["POST"])
def confirm_community_report(report_id):
    """Lets other citizens confirm a report is accurate (one confirmation per email)."""
    data = request.json or {}
    email = (data.get("email") or "anonymous").strip().lower()

    for r in MEMORY_COMMUNITY_REPORTS:
        if r["id"] == report_id:
            confirmers = r.setdefault("confirmedBy", [])
            if email in confirmers:
                return jsonify({"message": "You already confirmed this report", "confirmations": len(confirmers)}), 400
            confirmers.append(email)
            return jsonify({"message": "Confirmed", "confirmations": len(confirmers)})

    return jsonify({"message": "Report not found"}), 404

# ==================================================================
# NEW FEATURES BATCH
# ==================================================================

# ---------------- MODEL ACCURACY TRACKING ----------------
MEMORY_ACCURACY_HISTORY = []  # [{timestamp, model, accuracy, training_rows}]

# ---------------- PUBLIC ADVISORIES (Government Official) ----------------
# Distinct from Admin's operational "Alerts" — advisories are official,
# policy-level public communications (e.g. seasonal guidance), not
# emergency triggers.
MEMORY_ADVISORIES = []

# ---------------- EQUIPMENT / RESOURCE TRACKER (Rescue Worker) ----------------
# "assignments" lets a portion of a multi-unit item be deployed to one
# operation while the rest stays available for another — e.g. 4 Medical Kits
# where 2 go to Lahore and 2 remain free — instead of the whole item flipping
# to "In Use" the moment any single unit is deployed.
# Used only as a fallback if the database isn't available — once it is, the
# database table is the actual source of truth (see _load_equipment below).
MEMORY_EQUIPMENT = [
    {"id": 1, "name": "Rescue Boat #1", "notes": "", "quantity": 1, "assignments": [], "city": ""},
    {"id": 2, "name": "Rescue Boat #2", "notes": "", "quantity": 1, "assignments": [], "city": ""},
    {"id": 3, "name": "Medical Kit A", "notes": "", "quantity": 4, "assignments": [], "city": ""},
    {"id": 4, "name": "Medical Kit B", "notes": "", "quantity": 4, "assignments": [], "city": ""},
    {"id": 5, "name": "4x4 Rescue Vehicle", "notes": "", "quantity": 1, "assignments": [], "city": ""},
]

def _equipment_with_derived_fields(item):
    deployed = sum(a["qty"] for a in item["assignments"])
    available = item["quantity"] - deployed
    out = dict(item)
    out["deployed_qty"] = deployed
    out["available_qty"] = available
    out["status"] = "Available" if available > 0 else "In Use"
    return out

def _load_equipment_from_db():
    """The database table is the real source of truth once available. On a
    brand-new database it's seeded once with the same starter items that
    used to live only in memory (and would vanish on every restart)."""
    cursor.execute("SELECT COUNT(*) AS c FROM equipment_items")
    row = cursor.fetchone()
    if (row.c if hasattr(row, "c") else row[0]) == 0:
        for seed in MEMORY_EQUIPMENT:
            cursor.execute(
                "INSERT INTO equipment_items (name, quantity, notes, assignments, city) VALUES (?, ?, ?, ?, ?)",
                (seed["name"], seed["quantity"], seed["notes"], json.dumps(seed["assignments"]), seed.get("city", ""))
            )
        conn.commit()
    cursor.execute("SELECT * FROM equipment_items ORDER BY id")
    return [{
        "id": r.id, "name": r.name, "quantity": r.quantity,
        "notes": r.notes or "", "assignments": json.loads(r.assignments) if r.assignments else [],
        "city": getattr(r, "city", "") or "",
    } for r in cursor.fetchall()]

@app.route("/equipment", methods=["GET"])
def get_equipment():
    if DB_AVAILABLE:
        try:
            return jsonify([_equipment_with_derived_fields(e) for e in _load_equipment_from_db()])
        except Exception as e:
            log_event("error", f"Failed to load equipment from database: {e}")
    return jsonify([_equipment_with_derived_fields(e) for e in MEMORY_EQUIPMENT])

@app.route("/equipment", methods=["POST"])
def create_equipment():
    data = request.json or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"message": "Equipment name is required"}), 400
    try:
        quantity = max(1, int(data.get("quantity", 1)))
    except (TypeError, ValueError):
        quantity = 1
    item = {"name": name, "notes": data.get("notes", ""), "quantity": quantity, "assignments": [], "city": (data.get("city") or "").strip()}

    if DB_AVAILABLE:
        try:
            item["id"] = _db_insert_get_id(
                "INSERT INTO equipment_items (name, quantity, notes, assignments, city) VALUES (?, ?, ?, ?, ?)",
                (item["name"], item["quantity"], item["notes"], json.dumps(item["assignments"]), item["city"])
            )
            return jsonify(_equipment_with_derived_fields(item)), 201
        except Exception as db_error:
            log_event("error", f"Failed to save equipment to database: {db_error}")
            return jsonify({"message": "Could not save the equipment — please try again."}), 503

    item["id"] = (max([e["id"] for e in MEMORY_EQUIPMENT], default=0) + 1)
    MEMORY_EQUIPMENT.append(item)
    return jsonify(_equipment_with_derived_fields(item)), 201

def _get_equipment_row(item_id):
    """Fetches one equipment item straight from the DB (source of truth)."""
    cursor.execute("SELECT * FROM equipment_items WHERE id = ?", (item_id,))
    r = cursor.fetchone()
    if not r:
        return None
    return {"id": r.id, "name": r.name, "quantity": r.quantity, "notes": r.notes or "",
            "assignments": json.loads(r.assignments) if r.assignments else [], "city": getattr(r, "city", "") or ""}

@app.route("/equipment/<int:item_id>", methods=["PUT"])
def update_equipment(item_id):
    data = request.json or {}
    if DB_AVAILABLE:
        try:
            item = _get_equipment_row(item_id)
            if item is None:
                return jsonify({"message": "Equipment item not found"}), 404
            notes = data.get("notes", item["notes"])
            city = data.get("city", item.get("city", ""))
            quantity = item["quantity"]
            if "quantity" in data:
                try:
                    new_qty = max(1, int(data["quantity"]))
                    deployed = sum(a["qty"] for a in item["assignments"])
                    if new_qty < deployed:
                        return jsonify({"message": f"Can't set quantity below {deployed} — that many are currently deployed"}), 400
                    quantity = new_qty
                except (TypeError, ValueError):
                    pass
            cursor.execute("UPDATE equipment_items SET notes = ?, quantity = ?, city = ? WHERE id = ?", (notes, quantity, city, item_id))
            conn.commit()
            item["notes"], item["quantity"], item["city"] = notes, quantity, city
            return jsonify(_equipment_with_derived_fields(item))
        except Exception as db_error:
            log_event("error", f"Failed to update equipment in database: {db_error}")
            return jsonify({"message": "Could not update the equipment — please try again."}), 503

    for item in MEMORY_EQUIPMENT:
        if item["id"] == item_id:
            if "notes" in data:
                item["notes"] = data["notes"]
            if "quantity" in data:
                try:
                    new_qty = max(1, int(data["quantity"]))
                    deployed = sum(a["qty"] for a in item["assignments"])
                    if new_qty < deployed:
                        return jsonify({"message": f"Can't set quantity below {deployed} — that many are currently deployed"}), 400
                    item["quantity"] = new_qty
                except (TypeError, ValueError):
                    pass
            return jsonify(_equipment_with_derived_fields(item))
    return jsonify({"message": "Equipment item not found"}), 404

@app.route("/equipment/<int:item_id>/assign", methods=["POST"])
def assign_equipment(item_id):
    """Deploy a specific quantity of this item either to an operation or
    directly to a specific rescue worker (e.g. handing someone a radio
    regardless of which operation they're on). Calling this again for the
    same target updates that target's share instead of duplicating it."""
    data = request.json or {}
    target_type = data.get("target_type", "operation")
    target_id = data.get("target_id", data.get("op_id"))  # op_id kept for backward compatibility
    try:
        target_id = int(target_id)
    except (TypeError, ValueError):
        target_id = None
    try:
        qty = int(data.get("qty", 0))
    except (TypeError, ValueError):
        qty = 0
    if target_type not in ("operation", "worker") or not target_id or qty <= 0:
        return jsonify({"message": "target_type, target_id and a positive qty are required"}), 400

    def _label_for(t_type, t_id):
        if t_type == "operation":
            op = next((o for o in MEMORY_RESCUE_OPS if o["id"] == t_id), None)
            if op:
                return op["location"]
            if DB_AVAILABLE:
                try:
                    cursor.execute("SELECT location FROM rescue_operations WHERE id = ?", (t_id,))
                    row = cursor.fetchone()
                    if row:
                        return row.location
                except Exception:
                    pass
            return f"Operation #{t_id}"
        else:
            if DB_AVAILABLE:
                try:
                    cursor.execute("SELECT name FROM users WHERE id = ?", (t_id,))
                    row = cursor.fetchone()
                    if row:
                        return row.name
                except Exception:
                    pass
            return f"Worker #{t_id}"

    def _same_target(a, t_type, t_id):
        return a.get("target_type", "operation") == t_type and (a.get("target_id", a.get("op_id"))) == t_id

    if DB_AVAILABLE:
        try:
            item = _get_equipment_row(item_id)
            if item is None:
                return jsonify({"message": "Equipment item not found"}), 404
            other_deployed = sum(a["qty"] for a in item["assignments"] if not _same_target(a, target_type, target_id))
            if other_deployed + qty > item["quantity"]:
                available = item["quantity"] - other_deployed
                return jsonify({"message": f"Only {available} of {item['name']} available to deploy"}), 400
            item["assignments"] = [a for a in item["assignments"] if not _same_target(a, target_type, target_id)]
            item["assignments"].append({"target_type": target_type, "target_id": target_id, "qty": qty, "label": _label_for(target_type, target_id)})
            cursor.execute("UPDATE equipment_items SET assignments = ? WHERE id = ?", (json.dumps(item["assignments"]), item_id))
            conn.commit()
            return jsonify(_equipment_with_derived_fields(item))
        except Exception as db_error:
            log_event("error", f"Failed to save equipment assignment to database: {db_error}")
            return jsonify({"message": "Could not save the deployment — please try again."}), 503

    for item in MEMORY_EQUIPMENT:
        if item["id"] == item_id:
            other_deployed = sum(a["qty"] for a in item["assignments"] if not _same_target(a, target_type, target_id))
            if other_deployed + qty > item["quantity"]:
                available = item["quantity"] - other_deployed
                return jsonify({"message": f"Only {available} of {item['name']} available to deploy"}), 400
            item["assignments"] = [a for a in item["assignments"] if not _same_target(a, target_type, target_id)]
            item["assignments"].append({"target_type": target_type, "target_id": target_id, "qty": qty, "label": _label_for(target_type, target_id)})
            return jsonify(_equipment_with_derived_fields(item))
    return jsonify({"message": "Equipment item not found"}), 404

@app.route("/equipment/<int:item_id>/assign/<string:target_type>/<int:target_id>", methods=["DELETE"])
def unassign_equipment(item_id, target_type, target_id):
    """Free up whatever quantity of this item was deployed to the given operation or worker."""
    def _matches(a):
        return a.get("target_type", "operation") == target_type and (a.get("target_id", a.get("op_id"))) == target_id

    if DB_AVAILABLE:
        try:
            item = _get_equipment_row(item_id)
            if item is None:
                return jsonify({"message": "Equipment item not found"}), 404
            item["assignments"] = [a for a in item["assignments"] if not _matches(a)]
            cursor.execute("UPDATE equipment_items SET assignments = ? WHERE id = ?", (json.dumps(item["assignments"]), item_id))
            conn.commit()
            return jsonify(_equipment_with_derived_fields(item))
        except Exception as db_error:
            log_event("error", f"Failed to remove equipment assignment in database: {db_error}")
            return jsonify({"message": "Could not free up the equipment — please try again."}), 503

    for item in MEMORY_EQUIPMENT:
        if item["id"] == item_id:
            item["assignments"] = [a for a in item["assignments"] if not _matches(a)]
            return jsonify(_equipment_with_derived_fields(item))
    return jsonify({"message": "Equipment item not found"}), 404


# ---------------- SHIFT HANDOVER NOTES (Rescue Worker) ----------------
# priority + resolved turn this from a flat chat log into an actual handover
# tool: the next shift can tell at a glance what's urgent and still open vs.
# what's already been dealt with.
MEMORY_HANDOVER_NOTES = []

def _sort_handover_notes(notes):
    priority_rank = {"Urgent": 0, "Watch": 1, "Normal": 2}
    notes.sort(key=lambda n: (n.get("resolved", False), priority_rank.get(n.get("priority", "Normal"), 2)))
    return notes

@app.route("/shift-handover", methods=["GET"])
def get_handover_notes():
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT * FROM handover_notes ORDER BY created_at DESC LIMIT 40")
            notes = [{
                "id": r.id, "note": r.note, "author": r.author or "Unknown",
                "location": r.location or "", "priority": r.priority or "Normal",
                "resolved": bool(r.resolved), "created_at": str(r.created_at),
            } for r in cursor.fetchall()]
            return jsonify(_sort_handover_notes(notes))
        except Exception as e:
            log_event("error", f"Failed to fetch handover notes: {e}")
    notes = list(reversed(MEMORY_HANDOVER_NOTES))[:40]
    return jsonify(_sort_handover_notes(notes))

@app.route("/shift-handover", methods=["POST"])
def create_handover_note():
    data = request.json or {}
    note_text = (data.get("note") or "").strip()
    if not note_text:
        return jsonify({"message": "Note text is required"}), 400
    priority = data.get("priority") if data.get("priority") in ("Normal", "Watch", "Urgent") else "Normal"
    entry = {
        "note": note_text,
        "author": data.get("author", "Unknown"),
        "location": (data.get("location") or "").strip(),
        "priority": priority,
        "resolved": False,
        "created_at": str(datetime.now()),
    }

    if DB_AVAILABLE:
        try:
            entry["id"] = _db_insert_get_id(
                "INSERT INTO handover_notes (note, author, location, priority, resolved, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (entry["note"], entry["author"], entry["location"], entry["priority"], 0, entry["created_at"])
            )
            return jsonify(entry), 201
        except Exception as db_error:
            log_event("error", f"Failed to save handover note to database: {db_error}")
            return jsonify({"message": "Could not save the note — please try again."}), 503

    entry["id"] = (max([n["id"] for n in MEMORY_HANDOVER_NOTES], default=0) + 1)
    MEMORY_HANDOVER_NOTES.append(entry)
    return jsonify(entry), 201

@app.route("/shift-handover/<int:note_id>", methods=["PUT"])
def update_handover_note(note_id):
    data = request.json or {}
    if DB_AVAILABLE:
        try:
            if "resolved" in data:
                cursor.execute("UPDATE handover_notes SET resolved = ? WHERE id = ?", (1 if data["resolved"] else 0, note_id))
                conn.commit()
                if cursor.rowcount == 0:
                    return jsonify({"message": "Handover note not found"}), 404
            cursor.execute("SELECT * FROM handover_notes WHERE id = ?", (note_id,))
            r = cursor.fetchone()
            if not r:
                return jsonify({"message": "Handover note not found"}), 404
            return jsonify({
                "id": r.id, "note": r.note, "author": r.author or "Unknown",
                "location": r.location or "", "priority": r.priority or "Normal",
                "resolved": bool(r.resolved), "created_at": str(r.created_at),
            })
        except Exception as db_error:
            log_event("error", f"Failed to update handover note in database: {db_error}")
            return jsonify({"message": "Could not update the note — please try again."}), 503

    for note in MEMORY_HANDOVER_NOTES:
        if note["id"] == note_id:
            if "resolved" in data:
                note["resolved"] = bool(data["resolved"])
            return jsonify(note)
    return jsonify({"message": "Handover note not found"}), 404


# ---------------- RESCUE TEAMS (Rescue Worker) ----------------
# A named group of rescue workers (e.g. 3-4 people) that can be assigned to
# an operation as a unit, instead of an operation only ever having one
# assigned person. Persisted to the DB so teams survive a backend restart.
MEMORY_TEAMS = []

@app.route("/teams", methods=["GET"])
def get_teams():
    all_teams = list(MEMORY_TEAMS)
    seen_ids = {t["id"] for t in all_teams}
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT * FROM rescue_teams ORDER BY created_at DESC")
            for row in cursor.fetchall():
                if row.id in seen_ids:
                    continue
                all_teams.append({
                    "id": row.id, "name": row.name,
                    "member_ids": json.loads(row.member_ids) if row.member_ids else [],
                    "created_at": str(row.created_at),
                })
                seen_ids.add(row.id)
        except Exception as e:
            log_event("error", f"Failed to fetch rescue teams: {e}")
    return jsonify(all_teams)

@app.route("/teams", methods=["POST"])
def create_team():
    data = request.json or {}
    name = (data.get("name") or "").strip()
    member_ids = data.get("member_ids") or []
    if not name:
        return jsonify({"message": "Team name is required"}), 400
    if len(member_ids) < 2:
        return jsonify({"message": "A rescue team needs at least 2 members"}), 400
    team = {
        "id": (max([tm["id"] for tm in MEMORY_TEAMS], default=0) + 1),
        "name": name,
        "member_ids": member_ids,
        "created_at": str(datetime.now()),
    }
    MEMORY_TEAMS.append(team)

    if DB_AVAILABLE:
        try:
            team["id"] = _db_insert_get_id(
                "INSERT INTO rescue_teams (name, member_ids, created_at) VALUES (?, ?, ?)",
                (team["name"], json.dumps(team["member_ids"]), team["created_at"])
            )
        except Exception as db_error:
            log_event("error", f"Failed to save rescue team to database: {db_error}")
            MEMORY_TEAMS.remove(team)
            return jsonify({"message": "Could not save the team — please try again."}), 503

    return jsonify(team), 201

@app.route("/teams/<int:team_id>", methods=["PUT"])
def update_team(team_id):
    data = request.json or {}
    updated = None
    for team in MEMORY_TEAMS:
        if team["id"] == team_id:
            if "name" in data and (data["name"] or "").strip():
                team["name"] = data["name"].strip()
            if "member_ids" in data:
                team["member_ids"] = data["member_ids"]
            updated = team
            break

    if DB_AVAILABLE:
        try:
            cursor.execute(
                "UPDATE rescue_teams SET name = COALESCE(?, name), member_ids = COALESCE(?, member_ids) WHERE id = ?",
                (data.get("name"), json.dumps(data["member_ids"]) if "member_ids" in data else None, team_id)
            )
            conn.commit()
            if updated is None:
                cursor.execute("SELECT * FROM rescue_teams WHERE id = ?", (team_id,))
                row = cursor.fetchone()
                if row:
                    updated = {"id": row.id, "name": row.name, "member_ids": json.loads(row.member_ids) if row.member_ids else [], "created_at": str(row.created_at)}
        except Exception as db_error:
            log_event("error", f"Failed to update rescue team in database: {db_error}")

    if updated is None:
        return jsonify({"message": "Team not found"}), 404
    return jsonify(updated)

@app.route("/teams/<int:team_id>", methods=["DELETE"])
def delete_team(team_id):
    global MEMORY_TEAMS
    before = len(MEMORY_TEAMS)
    MEMORY_TEAMS = [tm for tm in MEMORY_TEAMS if tm["id"] != team_id]
    removed_from_memory = len(MEMORY_TEAMS) != before

    removed_from_db = False
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM rescue_teams WHERE id = ?", (team_id,))
            removed_from_db = cursor.rowcount > 0
            conn.commit()
        except Exception as db_error:
            log_event("error", f"Failed to delete rescue team from database: {db_error}")

    if not removed_from_memory and not removed_from_db:
        return jsonify({"message": "Team not found"}), 404
    return jsonify({"message": "Team deleted"})

@app.route("/advisories", methods=["GET"])
def get_advisories():
    all_advisories = list(MEMORY_ADVISORIES)
    seen_ids = {a["id"] for a in all_advisories}

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT * FROM advisories ORDER BY created_at DESC")
            for row in cursor.fetchall():
                row_id = getattr(row, "id", None)
                if row_id in seen_ids:
                    continue
                all_advisories.append({
                    "id": row_id, "title": getattr(row, "title", None), "message": getattr(row, "message", None),
                    "region": getattr(row, "region", None), "issued_by": getattr(row, "issued_by", None),
                    "created_at": str(getattr(row, "created_at", None)),
                })
                seen_ids.add(row_id)
        except Exception as e:
            log_event("error", f"Failed to fetch advisories: {e}")

    all_advisories.sort(key=lambda a: a["created_at"], reverse=True)
    return jsonify(all_advisories)

@app.route("/advisories", methods=["POST"])
def create_advisory():
    data = request.json or {}
    title = (data.get("title") or "").strip()
    message = (data.get("message") or "").strip()
    if not title or not message:
        return jsonify({"message": "Title and message are required"}), 400
    advisory = {
        "id": (max([a["id"] for a in MEMORY_ADVISORIES], default=0) + 1),
        "title": title, "message": message,
        "region": data.get("region", "All regions"),
        "issued_by": data.get("issued_by", "Government Official"),
        "created_at": str(datetime.now()),
    }
    MEMORY_ADVISORIES.append(advisory)
    saved_to_db = False

    if DB_AVAILABLE:
        try:
            cursor.execute(
                "INSERT INTO advisories (title, message, region, issued_by, created_at) VALUES (?, ?, ?, ?, ?)",
                (advisory["title"], advisory["message"], advisory["region"], advisory["issued_by"], advisory["created_at"])
            )
            conn.commit()
            cursor.execute("SELECT id FROM advisories WHERE title = ? AND created_at = ? ORDER BY id DESC", (advisory["title"], advisory["created_at"]))
            row = cursor.fetchone()
            if row:
                advisory["id"] = row.id if hasattr(row, "id") else row[0]
                saved_to_db = True
        except Exception as db_error:
            log_event("error", f"Failed to save advisory to database: {db_error}")

    notification_warning = None
    if saved_to_db:
        try:
            from notifications import create_advisory_notification
            create_advisory_notification(advisory)
        except Exception as notify_error:
            notification_warning = str(notify_error)
            log_event("error", f"Failed to create advisory notification: {notify_error}")
    else:
        notification_warning = "Advisory was not saved to the main database, so no notification was stored."
        log_event("error", notification_warning)

    log_event("info", f"Public advisory issued: {title} ({advisory['region']})")
    response_body = dict(advisory)
    if notification_warning:
        response_body["notification_warning"] = notification_warning
    return jsonify(response_body), 201

@app.route("/advisories/<int:advisory_id>", methods=["DELETE"])
def delete_advisory(advisory_id):
    MEMORY_ADVISORIES[:] = [a for a in MEMORY_ADVISORIES if a["id"] != advisory_id]
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM advisories WHERE id = ?", (advisory_id,))
            conn.commit()
        except Exception as db_error:
            log_event("error", f"Failed to delete advisory from database: {db_error}")
    return jsonify({"message": "Advisory withdrawn"})

# ---------------- RESOURCE GAP ANALYSIS (Government Official) ----------------
@app.route("/admin/seasonal-trend", methods=["GET"])
def seasonal_trend():
    """Groups the real prediction history by month so Government Officials
    can see how flood risk has trended over recent months — a genuine,
    data-driven seasonal comparison (not simulated)."""
    preds_resp = get_predictions()
    buckets = {}  # "YYYY-MM" -> {"Low": n, "Medium": n, "High": n, "total": n}
    for p in preds_resp.json:
        created = p.get("created_at")
        if not created:
            continue
        month_key = str(created)[:7]  # "YYYY-MM"
        risk = p.get("risk", "Unknown")
        if month_key not in buckets:
            buckets[month_key] = {"Low": 0, "Medium": 0, "High": 0, "total": 0}
        if risk in buckets[month_key]:
            buckets[month_key][risk] += 1
        buckets[month_key]["total"] += 1

    result = [{"month": k, **v} for k, v in sorted(buckets.items())]
    return jsonify(result[-12:])  # last 12 months of data present


@app.route("/admin/resource-gap-analysis", methods=["GET"])
def resource_gap_analysis():
    """For each known city: current risk level (from the latest prediction)
    vs how many shelters/hospitals are registered there — flags cities that
    are high-risk but under-resourced, for policy/resource-allocation use."""
    preds_resp = get_predictions()
    city_risk = {}
    for p in preds_resp.json:
        loc = p.get("location")
        if loc and loc not in city_risk:
            city_risk[loc] = p.get("risk", "Unknown")

    shelters = get_shelters().json
    hospitals = get_hospitals().json

    def count_for_city(items, city):
        city_l = city.lower()
        return len([i for i in items if city_l in (i.get("address") or "").lower() or city_l in (i.get("name") or "").lower()])

    RISK_SCORE = {"High": 3, "Medium": 2, "Low": 1, "Unknown": 0}
    rows = []
    for city in MAP_CITIES.keys():
        risk = city_risk.get(city, "Unknown")
        shelter_count = count_for_city(shelters, city)
        hospital_count = count_for_city(hospitals, city)
        rows.append({
            "city": city, "risk": risk,
            "shelters": shelter_count, "hospitals": hospital_count,
            "gap_flag": RISK_SCORE.get(risk, 0) >= 2 and (shelter_count + hospital_count) <= 3,
        })
    rows.sort(key=lambda r: (-RISK_SCORE.get(r["risk"], 0), r["shelters"] + r["hospitals"]))
    return jsonify(rows)

@app.route("/nearest-facilities", methods=["GET"])
def get_nearest_facilities():
    """Used by the Rescue Dashboard to show the closest shelter/hospital
    right on an operation's card, without the rescue worker needing to
    switch to the map."""
    location = request.args.get("location", "")
    coords = resolve_coordinates(location)
    if not coords:
        return jsonify({"shelter": None, "hospital": None})
    lat, lon = coords

    def nearest(items):
        best, best_dist = None, None
        for item in items:
            if not item.get("latitude") or not item.get("longitude"):
                continue
            dlat, dlon = item["latitude"] - lat, item["longitude"] - lon
            dist = (dlat ** 2 + dlon ** 2) ** 0.5  # good enough for "nearest" ranking over short lists
            if best_dist is None or dist < best_dist:
                best, best_dist = item, dist
        return best

    nearest_shelter = nearest(get_shelters().json)
    nearest_hospital = nearest(get_hospitals().json)
    return jsonify({"shelter": nearest_shelter, "hospital": nearest_hospital})

# ---------------- RESCUE STATS (for rescue team dashboard) ----------------
@app.route("/rescue-operations/stats", methods=["GET"])
def get_rescue_stats():
    ops = _get_all_rescue_operations()
    completed = [o for o in ops if o["status"] == "Completed"]

    durations = []
    for o in completed:
        try:
            start = datetime.fromisoformat(o["created_at"])
            end = datetime.fromisoformat(o["completed_at"])
            durations.append((end - start).total_seconds() / 60)  # minutes
        except Exception:
            pass

    total_rescued = sum(o.get("people_rescued") or 0 for o in completed)

    return jsonify({
        "total_operations": len(ops),
        "completed_operations": len(completed),
        "active_operations": len([o for o in ops if o["status"] != "Completed"]),
        "total_people_rescued": total_rescued,
        "avg_completion_minutes": round(sum(durations) / len(durations), 1) if durations else None,
    })

@app.route("/volunteers/<int:vol_id>", methods=["DELETE"])
def delete_volunteer(vol_id):
    MEMORY_VOLUNTEERS[:] = [v for v in MEMORY_VOLUNTEERS if v["id"] != vol_id]
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM volunteers WHERE id = ?", (vol_id,))
            conn.commit()
        except Exception as db_error:
            log_event("error", f"Failed to delete volunteer from database: {db_error}")
            return jsonify({"message": "Could not delete the volunteer — please try again."}), 503
    log_event("info", f"Deleted volunteer id {vol_id}")
    return jsonify({"message": "Volunteer deleted successfully"})

@app.route("/volunteers/<int:vol_id>/status", methods=["PUT"])
def update_volunteer_status(vol_id):
    data = request.json or {}
    new_status = data.get("availability", "Deployed")
    for v in MEMORY_VOLUNTEERS:
        if v["id"] == vol_id:
            v["availability"] = new_status
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE volunteers SET availability = ? WHERE id = ?", (new_status, vol_id))
            conn.commit()
        except Exception as e:
            print("Failed to update volunteer status:", e)
    return jsonify({"id": vol_id, "availability": new_status})

@app.route("/users/<int:user_id>/status", methods=["PUT"])
def update_user_status(user_id):
    data = request.json or {}
    new_status = data.get("status", "Inactive")
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE users SET status = ? WHERE id = ?", (new_status, user_id))
            conn.commit()
        except Exception as e:
            print("Failed to update user status:", e)
    return jsonify({"id": user_id, "status": new_status})

@app.route("/admin/accuracy-history", methods=["GET"])
def get_accuracy_history():
    return jsonify(MEMORY_ACCURACY_HISTORY)

@app.route("/admin/confidence-trend", methods=["GET"])
def get_confidence_trend():
    """Proxy quality signal: rolling average prediction confidence over time,
    grouped by day, from real predictions actually served (no ground truth
    needed — full accuracy tracking lives in /admin/accuracy-history, which
    updates whenever the model is retrained on new labeled data)."""
    preds_resp = get_predictions()
    preds = preds_resp.json
    by_day = {}
    for p in preds:
        if not p.get("created_at") or p.get("confidence") is None:
            continue
        day = str(p["created_at"])[:10]
        by_day.setdefault(day, []).append(p["confidence"])
    trend = [{"date": d, "avg_confidence": sum(v) / len(v), "count": len(v)} for d, v in sorted(by_day.items())]
    return jsonify(trend)

# ---------------- FORECAST-BASED PREDICTION (3-day outlook) ----------------
@app.route("/predict/forecast", methods=["POST"])
def predict_forecast():
    """FYP enhancement: instead of just 'today', use Open-Meteo's free
    forecast API to project flood risk for the next 3 days for a city."""
    data = request.json or {}
    location = data.get("location", "")
    match = resolve_coordinates(location)
    if not match:
        return jsonify({"message": f"'{location}' is not a recognised city for forecasting"}), 400
    lat, lon = match

    try:
        import urllib.request
        url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
               f"&daily=temperature_2m_max,precipitation_sum&forecast_days=3&timezone=auto")
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            weather = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return jsonify({"message": f"Could not fetch forecast: {e}"}), 502

    daily = weather.get("daily", {})
    dates = daily.get("time", [])
    temps = daily.get("temperature_2m_max", [])
    rains = daily.get("precipitation_sum", [])

    outlook = []
    for i in range(len(dates)):
        feature_dict, resolved_city, _ = build_feature_vector(
            MODEL_FEATURES, location=location, rainfall_mm=rains[i] if i < len(rains) else 0,
            temperature=temps[i] if i < len(temps) else None,
            date=datetime.strptime(dates[i], "%Y-%m-%d"),
        )
        features_df = pd.DataFrame([feature_dict], columns=MODEL_FEATURES)
        scaled = pd.DataFrame(scaler.transform(features_df), columns=MODEL_FEATURES)
        pred = int(model.predict(scaled)[0])
        conf = float(model.predict_proba(scaled)[0][pred]) if hasattr(model, "predict_proba") else None
        outlook.append({
            "date": dates[i], "risk": RISK_MAP.get(pred, "Unknown"), "confidence": conf,
            "rainfall": rains[i] if i < len(rains) else None, "temperature": temps[i] if i < len(temps) else None,
        })

    return jsonify({"location": location, "resolved_city": resolved_city, "outlook": outlook})

# ---------------- VOLUNTEERS (Safety/Emergency) ----------------
MEMORY_VOLUNTEERS = []

@app.route("/volunteers", methods=["GET"])
def get_volunteers():
    all_vols = list(MEMORY_VOLUNTEERS)
    seen_ids = {v["id"] for v in all_vols}
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT * FROM volunteers ORDER BY created_at DESC")
            for row in cursor.fetchall():
                if row.id in seen_ids:
                    continue
                all_vols.append({
                    "id": row.id, "name": row.name, "phone": row.phone, "city": row.city or "",
                    "skills": row.skills or "", "availability": row.availability or "Available",
                    "email": row.email or "", "created_at": str(row.created_at),
                })
                seen_ids.add(row.id)
        except Exception as e:
            log_event("error", f"Failed to fetch volunteers: {e}")
    return jsonify(all_vols)

@app.route("/volunteers", methods=["POST"])
def create_volunteer():
    data = request.json or {}
    name = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip()
    if not name or not phone:
        return jsonify({"message": "Name and phone are required"}), 400
    volunteer = {
        "id": (max([v["id"] for v in MEMORY_VOLUNTEERS], default=0) + 1),
        "name": name, "phone": phone, "city": data.get("city", ""),
        "skills": data.get("skills", ""), "availability": data.get("availability", "Available"),
        "email": data.get("email", ""), "created_at": str(datetime.now()),
    }
    MEMORY_VOLUNTEERS.append(volunteer)

    if DB_AVAILABLE:
        try:
            volunteer["id"] = _db_insert_get_id(
                "INSERT INTO volunteers (name, phone, city, skills, availability, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (volunteer["name"], volunteer["phone"], volunteer["city"], volunteer["skills"],
                 volunteer["availability"], volunteer["email"], volunteer["created_at"])
            )
        except Exception as db_error:
            log_event("error", f"Failed to save volunteer to database: {db_error}")
            MEMORY_VOLUNTEERS.remove(volunteer)
            return jsonify({"message": "Could not save the volunteer — please try again."}), 503

    log_event("info", f"New volunteer registered: {name} ({volunteer['city']})")
    return jsonify(volunteer), 201

# ---------------- FAMILY / EMERGENCY CONTACTS ----------------
MEMORY_FAMILY_CONTACTS = []  # {id, owner_email, name, phone, relation}

@app.route("/family-contacts", methods=["GET"])
def get_family_contacts():
    owner_email = (request.args.get("email") or "").strip().lower()
    contacts = [c for c in MEMORY_FAMILY_CONTACTS if c["owner_email"] == owner_email]
    return jsonify(contacts)

@app.route("/family-contacts", methods=["POST"])
def create_family_contact():
    data = request.json or {}
    owner_email = (data.get("owner_email") or "").strip().lower()
    name = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip()
    if not owner_email or not name or not phone:
        return jsonify({"message": "Owner email, name and phone are required"}), 400
    contact = {
        "id": (max([c["id"] for c in MEMORY_FAMILY_CONTACTS], default=0) + 1),
        "owner_email": owner_email, "name": name, "phone": phone,
        "relation": data.get("relation", ""),
    }
    MEMORY_FAMILY_CONTACTS.append(contact)
    return jsonify(contact), 201

@app.route("/family-contacts/<int:contact_id>", methods=["DELETE"])
def delete_family_contact(contact_id):
    MEMORY_FAMILY_CONTACTS[:] = [c for c in MEMORY_FAMILY_CONTACTS if c["id"] != contact_id]
    return jsonify({"message": "Contact removed"})

@app.route("/family-contacts/notify", methods=["POST"])
def notify_family_contacts():
    """No SMS/email service is configured for this deployment — notifications
    are logged (like the password-reset code) rather than actually sent."""
    data = request.json or {}
    owner_email = (data.get("owner_email") or "").strip().lower()
    message = data.get("message", "A flood risk alert was issued for your area.")
    contacts = [c for c in MEMORY_FAMILY_CONTACTS if c["owner_email"] == owner_email]
    for c in contacts:
        log_event("info", f"[FAMILY NOTIFY - simulated] To {c['name']} ({c['phone']}): {message}")
    return jsonify({"message": f"Notified {len(contacts)} contact(s) (simulated — see backend console).", "count": len(contacts)})

# ---------------- DONATIONS / RESOURCE PLEDGES ----------------
MEMORY_DONATIONS = []

@app.route("/donations", methods=["GET"])
def get_donations():
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT id, donor_name, contact, item, quantity, shelter_id, status, created_at FROM donations ORDER BY created_at DESC")
            rows = cursor.fetchall()
            result = []
            for row in rows:
                result.append({
                    "id": row.id,
                    "donor_name": row.donor_name,
                    "contact": getattr(row, "contact", ""),
                    "item": row.item,
                    "quantity": row.quantity,
                    "shelter_id": getattr(row, "shelter_id", None),
                    "status": row.status,
                    "created_at": str(row.created_at),
                })
            # Merge any in-memory pledges not yet in DB
            db_ids = {r["id"] for r in result}
            for d in MEMORY_DONATIONS:
                if d["id"] not in db_ids:
                    result.append(d)
            return jsonify(result)
        except Exception as e:
            print(f"[DONATIONS GET] DB error: {e}")
    return jsonify(MEMORY_DONATIONS)

@app.route("/donations", methods=["POST"])
def create_donation():
    data = request.json or {}
    donor_name = (data.get("donor_name") or "").strip()
    item = (data.get("item") or "").strip()
    if not donor_name or not item:
        return jsonify({"message": "Donor name and item are required"}), 400
    new_id = max([d["id"] for d in MEMORY_DONATIONS], default=0) + 1
    donation = {
        "id": new_id,
        "donor_name": donor_name, "contact": data.get("contact", ""),
        "item": item, "quantity": data.get("quantity", 1),
        "shelter_id": data.get("shelter_id"), "status": "Pledged",
        "created_at": str(datetime.now()),
    }
    if DB_AVAILABLE:
        try:
            cursor.execute(
                "INSERT INTO donations (donor_name, contact, item, quantity, shelter_id, status) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (donor_name, data.get("contact", ""), item, data.get("quantity", 1), data.get("shelter_id"), "Pledged")
            )
            row = cursor.fetchone()
            if row:
                donation["id"] = row.id
            conn.commit()
        except Exception as e:
            print(f"[DONATIONS POST] DB error: {e}")
    MEMORY_DONATIONS.append(donation)
    return jsonify(donation), 201

@app.route("/donations/<int:donation_id>", methods=["PUT"])
def update_donation(donation_id):
    data = request.json or {}
    new_status = data.get("status")
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE donations SET status = %s WHERE id = %s", (new_status, donation_id))
            conn.commit()
        except Exception as e:
            print(f"[DONATIONS PUT] DB error: {e}")
    for d in MEMORY_DONATIONS:
        if d["id"] == donation_id:
            d["status"] = new_status or d["status"]
            return jsonify(d)
    return jsonify({"id": donation_id, "status": new_status})

# ---------------- SHELTER QR CHECK-IN ----------------
MEMORY_CHECKINS = []  # {id, shelter_id, name, timestamp}

@app.route("/shelters/<int:shelter_id>/checkin", methods=["POST"])
def shelter_checkin(shelter_id):
    data = request.json or {}
    entry = {
        "id": (max([c["id"] for c in MEMORY_CHECKINS], default=0) + 1),
        "shelter_id": shelter_id, "name": data.get("name", "Anonymous"),
        "timestamp": str(datetime.now()),
    }
    MEMORY_CHECKINS.append(entry)
    for s in MEMORY_SHELTERS:
        if s["id"] == shelter_id:
            s["occupancy"] = (s.get("occupancy") or 0) + 1
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE shelters SET occupancy = COALESCE(occupancy, 0) + 1 WHERE id = ?", (shelter_id,))
            conn.commit()
        except Exception as e:
            print("Failed to update shelter occupancy on checkin:", e)
    return jsonify({"message": "Checked in successfully", "checkin": entry})

@app.route("/shelters/<int:shelter_id>/checkins", methods=["GET"])
def get_shelter_checkins(shelter_id):
    entries = [c for c in MEMORY_CHECKINS if c["shelter_id"] == shelter_id]
    return jsonify({"count": len(entries), "checkins": entries})

# ---------------- PDF EXPORT ----------------
def pdf_safe(text):
    """fpdf2's built-in core fonts (Helvetica etc.) only support Latin-1 —
    replace common characters our explanation text uses (bullets, em
    dashes, smart quotes) so generation doesn't crash, then drop anything
    else that still doesn't fit."""
    replacements = {
        "\u2022": "-", "\u2014": "-", "\u2013": "-", "\u2018": "'", "\u2019": "'",
        "\u201c": '"', "\u201d": '"', "\u2026": "...",
    }
    for bad, good in replacements.items():
        text = text.replace(bad, good)
    return text.encode("latin-1", "replace").decode("latin-1")


@app.route("/predict/pdf", methods=["POST"])
def prediction_pdf():
    """Generates a simple one-page PDF summary of a prediction the client
    already has (sent in the request body) — avoids needing DB row lookups."""
    data = request.json or {}
    try:
        from fpdf import FPDF
    except ImportError:
        return jsonify({"message": "PDF export requires the 'fpdf2' package — run: pip install fpdf2"}), 500

    try:
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 16)
        pdf.cell(0, 10, pdf_safe("Flood Risk Prediction Report"), ln=True)
        pdf.set_font("Helvetica", "", 11)
        pdf.ln(4)
        rows = [
            ("Location", data.get("location", "")),
            ("Risk Level", data.get("risk", "")),
            ("Confidence", f"{round((data.get('confidence') or 0) * 100, 1)}%"),
            ("Model Used", data.get("model_used", "")),
            ("Generated", str(datetime.now())),
        ]
        for label, value in rows:
            pdf.set_font("Helvetica", "B", 11)
            pdf.cell(45, 8, pdf_safe(f"{label}:"))
            pdf.set_font("Helvetica", "", 11)
            pdf.multi_cell(0, 8, pdf_safe(str(value)))
        pdf.ln(4)
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 8, "Explanation", ln=True)
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 6, pdf_safe(str(data.get("explanation", ""))))
        pdf_bytes = bytes(pdf.output())
    except Exception as e:
        log_event("error", f"PDF generation failed: {e}")
        return jsonify({"message": f"Could not generate PDF: {e}"}), 500

    from io import BytesIO
    buf = BytesIO(pdf_bytes)
    buf.seek(0)
    from flask import send_file
    return send_file(buf, mimetype="application/pdf", as_attachment=True, download_name="flood_prediction_report.pdf")


@app.route("/admin/district-report/<city>", methods=["GET"])
def district_report_pdf(city):
    """Official record PDF for Government Officials: a summary of a city's
    recent flood-risk history, current shelter/hospital coverage, and any
    active advisories/alerts — for local record-keeping and briefings."""
    try:
        from fpdf import FPDF
    except ImportError:
        return jsonify({"message": "PDF export requires the 'fpdf2' package — run: pip install fpdf2"}), 500

    preds = [p for p in get_predictions().json if (p.get("location") or "").lower() == city.lower()][:10]
    shelters = [s for s in get_shelters().json if city.lower() in (s.get("address") or "").lower() or city.lower() in (s.get("name") or "").lower()]
    hospitals = [h for h in get_hospitals().json if city.lower() in (h.get("address") or "").lower() or city.lower() in (h.get("name") or "").lower()]
    active_alerts = [a for a in MEMORY_ALERTS if a.get("location", "").lower() == city.lower() and a.get("status") != "Cancelled"]

    try:
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 16)
        pdf.cell(0, 10, pdf_safe(f"District Report: {city}"), ln=True)
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 6, pdf_safe(f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}"), ln=True)
        pdf.ln(4)

        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 8, "Resource Coverage", ln=True)
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 6, pdf_safe(f"Shelters registered: {len(shelters)}"), ln=True)
        pdf.cell(0, 6, pdf_safe(f"Hospitals registered: {len(hospitals)}"), ln=True)
        pdf.cell(0, 6, pdf_safe(f"Active alerts: {len(active_alerts)}"), ln=True)
        pdf.ln(4)

        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 8, "Recent Predictions", ln=True)
        pdf.set_font("Helvetica", "", 9)
        if not preds:
            pdf.cell(0, 6, pdf_safe("No predictions recorded for this city yet."), ln=True)
        for p in preds:
            line = f"{p.get('created_at', '')[:16]} — {p.get('risk', 'Unknown')} risk ({round((p.get('confidence') or 0) * 100)}% confidence)"
            pdf.cell(0, 6, pdf_safe(line), ln=True)

        pdf_bytes = bytes(pdf.output())
    except Exception as e:
        log_event("error", f"District report PDF failed: {e}")
        return jsonify({"message": f"Could not generate report: {e}"}), 500

    from io import BytesIO
    from flask import send_file
    buf = BytesIO(pdf_bytes)
    buf.seek(0)
    return send_file(buf, mimetype="application/pdf", as_attachment=True, download_name=f"district_report_{city}.pdf")

# ---------------- EMERGENCY EVENTS & DRILLS ----------------
MEMORY_EVENTS = [
    {
        "id": 1,
        "title": "Karachi Coastal Monsoon Response Drill",
        "location": "Karachi",
        "event_date": "2026-08-25",
        "event_type": "Emergency Drill",
        "status": "Scheduled",
        "notes": "Coordinating with NDMA and Rescue 1122 for simulated coastal evacuation."
    },
    {
        "id": 2,
        "title": "Lahore Relief Equipment Audit & Testing",
        "location": "Lahore",
        "event_date": "2026-08-28",
        "event_type": "Equipment Audit",
        "status": "Scheduled",
        "notes": "Testing high-capacity dewatering pumps and inflatable lifeboats."
    }
]

@app.route("/events", methods=["GET"])
def get_events():
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT id, title, location, event_date, event_type, status, notes, created_at FROM emergency_events ORDER BY id DESC")
            data = []
            for row in cursor.fetchall():
                data.append({
                    "id": row.id, "title": row.title, "location": row.location,
                    "event_date": row.event_date, "event_type": row.event_type,
                    "status": row.status, "notes": row.notes or "",
                    "created_at": str(row.created_at)
                })
            # Merge memory events if DB empty or missing
            if data:
                return jsonify(data)
        except Exception as e:
            print("EVENTS DB GET ERROR:", e)
    return jsonify(MEMORY_EVENTS)

@app.route("/events", methods=["POST"])
def create_event():
    data = request.json or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"message": "Title is required"}), 400
    
    event = {
        "id": max([e["id"] for e in MEMORY_EVENTS], default=0) + 1,
        "title": title,
        "location": data.get("location", ""),
        "event_date": data.get("event_date", ""),
        "event_type": data.get("event_type", "Drill"),
        "status": data.get("status", "Scheduled"),
        "notes": data.get("notes", ""),
        "created_at": str(datetime.now())
    }
    MEMORY_EVENTS.append(event)
    if DB_AVAILABLE:
        try:
            cursor.execute(
                "INSERT INTO emergency_events (title, location, event_date, event_type, status, notes) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (title, data.get("location", ""), data.get("event_date", ""), data.get("event_type", "Drill"), data.get("status", "Scheduled"), data.get("notes", ""))
            )
            row = cursor.fetchone()
            if row:
                event["id"] = row.id
            conn.commit()
        except Exception as e:
            print("EVENTS DB POST ERROR:", e)
    return jsonify(event), 201

@app.route("/events/<int:event_id>", methods=["DELETE"])
def delete_event(event_id):
    global MEMORY_EVENTS
    MEMORY_EVENTS = [e for e in MEMORY_EVENTS if e["id"] != event_id]
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM emergency_events WHERE id = %s", (event_id,))
            conn.commit()
        except Exception as e:
            print("EVENTS DB DELETE ERROR:", e)
    return jsonify({"message": "Event deleted successfully"})

# ---------------- RUN ----------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("=" * 60)
    print(f"  Flood Disaster Management System backend starting...")
    print(f"  Once ready, test it by visiting: http://127.0.0.1:{port}/health")
    print("=" * 60)
    try:
        # threaded=False is explicit and load-bearing, not just the default:
        # this whole file uses ONE shared database connection/cursor as a
        # module-level singleton (not one per request/thread). If Werkzeug's
        # dev server ever handles two requests at the same time on separate
        # threads, they can genuinely collide on that shared cursor mid-query
        # — which is exactly what SQLite's "Recursive use of cursors not
        # allowed" error means, and it showed up in practice on any page
        # that fires several API calls at once (e.g. the Map, which loads
        # shelters/hospitals/operations/reports/roads/predictions together).
        # Forcing single-threaded, one-request-at-a-time handling here
        # matches what the rest of the code already assumes and removes the
        # race entirely, instead of trying to make a shared cursor safe to
        # use from multiple threads at once.
        app.run(host="0.0.0.0", port=port, debug=False, threaded=False)
    except OSError as e:
        print("=" * 60)
        print(f"  COULD NOT START — port {port} is already in use.")
        print(f"  Error detail: {e}")
        print(f"  Another copy of this backend (or something else) is")
        print(f"  already running on port {port}. On Windows, close it with:")
        print(f"      taskkill /F /IM python.exe")
        print(f"  then run 'python app.py' again.")
        print("=" * 60)