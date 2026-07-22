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
from datetime import datetime, timedelta
from sklearn.preprocessing import MinMaxScaler
from sklearn.feature_selection import VarianceThreshold
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
from feature_engineering import build_feature_vector, SUPPORTED_CITIES
from city_coordinates import resolve_coordinates, MAP_CITIES

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False
    print("shap not installed — run: pip install shap. Falling back to feature-importance explanations.")

app = Flask(__name__)
CORS(app)

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

class SQLiteRowObject:
    def __init__(self, cursor, row):
        for idx, col in enumerate(cursor.description):
            name = col[0]
            val = row[idx]
            if name in ('created_at', 'completed_at', 'updated_at') and isinstance(val, str):
                try:
                    val = val.replace(" ", "T")
                    val = datetime.fromisoformat(val)
                except Exception:
                    pass
            setattr(self, name, val)

class PostgreSQLRowObject:
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

class CompatibleCursor:
    def __init__(self, real_conn, db_type, parent_connection=None):
        # Holding the CONNECTION (not a single cursor) lets us hand out a
        # brand new low-level cursor on every execute() call below — this is
        # what actually fixes "Recursive use of cursors not allowed": that
        # SQLite error happens when the *same* cursor object is reused for a
        # new query while an earlier query on it hasn't been fully consumed
        # yet (e.g. one request's DB save overlapping another request's DB
        # read on the single shared cursor this app used everywhere). A
        # fresh cursor per call means calls can never collide like that.
        self.real_conn = real_conn
        self.db_type = db_type
        self.parent_connection = parent_connection  # CompatibleConnection, for reconnecting on a dead PostgreSQL link
        self.real_cursor = real_conn.cursor()  # kept for direct attribute access (e.g. .description)

    def execute(self, query, params=None):
        pg_query = query.replace("?", "%s") if self.db_type == "postgresql" else query
        try:
            self.real_cursor = self.real_conn.cursor()
            if params is not None:
                return self.real_cursor.execute(pg_query, params)
            else:
                return self.real_cursor.execute(pg_query)
        except Exception as e:
            # Managed PostgreSQL (like Render's) closes connections that sit
            # idle for a while, and a free-tier backend waking up from sleep
            # can also leave the old connection dead. Without this, every
            # query on this shared connection would keep failing the same
            # way until the process was manually restarted — which is
            # exactly what looked like "registration/login randomly breaks
            # every few minutes". One reconnect-and-retry fixes it silently.
            # (Retries on ANY exception here, not just ones that "look like"
            # a connection error by message text — psycopg2's wording for a
            # dead connection varies too much to match reliably, and a
            # reconnect is cheap/harmless to attempt even if the original
            # error was unrelated.)
            if self.db_type == "postgresql" and self.parent_connection is not None:
                try:
                    self.real_conn = self.parent_connection._reconnect()
                    self.real_cursor = self.real_conn.cursor()
                    if params is not None:
                        return self.real_cursor.execute(pg_query, params)
                    else:
                        return self.real_cursor.execute(pg_query)
                except Exception:
                    raise e  # reconnect attempt itself failed — surface the original error
            raise

    def fetchone(self):
        row = self.real_cursor.fetchone()
        if row and self.db_type == "postgresql":
            return PostgreSQLRowObject(self.real_cursor.description, row)
        return row

    def fetchall(self):
        rows = self.real_cursor.fetchall()
        if rows and self.db_type == "postgresql":
            return [PostgreSQLRowObject(self.real_cursor.description, r) for r in rows]
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
      status TEXT,
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
      assignments TEXT
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
        "predictions": ["user_id", "user_email"],
        "alerts": ["location", "status", "assigned_worker", "linked_rescue_op_id"],
        "rescue_operations": ["description", "people_rescued", "resources_used", "completion_notes", "needs_backup", "update_log"],
    }
    for table, columns in expected_columns.items():
        try:
            cursor.execute(f"PRAGMA table_info({table})")
            existing = {getattr(row, "name", None) for row in cursor.fetchall()}
            for col in columns:
                if col not in existing:
                    cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
        except Exception as e:
            print(f"[MIGRATION] Could not check/update '{table}': {e}")

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
      status TEXT,
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
      assignments TEXT
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
    integer_columns_pg = {"people_rescued", "needs_backup"}
    expected_columns_pg = {
        "users": ["status", "is_verified", "otp", "on_duty"],
        "predictions": ["user_id", "user_email"],
        "alerts": ["location", "status", "assigned_worker", "linked_rescue_op_id"],
        "rescue_operations": ["description", "people_rescued", "resources_used", "completion_notes", "needs_backup", "update_log"],
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
                col_type = "INTEGER" if col in integer_columns_pg else "TEXT"
                if col not in existing:
                    cursor.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {col_type}")
                elif col in integer_columns_pg and existing[col] not in ("integer", "bigint", "smallint"):
                    # Repair a column that an earlier, blanket-TEXT version of
                    # this migration already created with the wrong type.
                    # NULLIF(..., '') avoids a cast error on empty strings.
                    cursor.execute(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE INTEGER USING NULLIF({col}, '')::integer")
        except Exception as e:
            print(f"[MIGRATION] Could not check/update '{table}': {e}")

    conn.commit()

DB_AVAILABLE = False
conn = None
cursor = None
DB_TYPE = None

DATABASE_URL = os.environ.get("DATABASE_URL")

# 1. Try PostgreSQL if DATABASE_URL is provided (production cloud database)
if DATABASE_URL:
    import time
    pg_connected = False
    last_pg_error = None
    # Retry a few times with a short pause — a single transient failure here
    # (the managed Postgres instance still waking up, a momentary network
    # blip) used to fall all the way back to a brand-new, empty SQLite
    # database instead of trying again, making real data "disappear" after
    # a redeploy even though it was safe the whole time in PostgreSQL.
    for attempt in range(1, 4):
        try:
            import psycopg2
            raw_conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
            raw_conn.autocommit = True  # each statement commits itself — removes any window where
                                         # execute() succeeds but a later conn.commit() fails on a
                                         # connection that died in between; also matches the same
                                         # autocommit fix already used for the SQL Server path.
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

# 2. Try SQL Server (local development primary database)
if not DB_AVAILABLE and pyodbc is not None:
    try:
        conn = pyodbc.connect(
            "DRIVER={ODBC Driver 17 for SQL Server};"
            "SERVER=localhost;"
            "DATABASE=flood_db;"
            "Trusted_Connection=yes;",
            timeout=2
        )
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
            app_data_dir = os.path.join(os.path.expanduser("~"), ".flood_dms")
            os.makedirs(app_data_dir, exist_ok=True)
            db_path = os.path.join(app_data_dir, "database.db")
            raw_conn = sqlite3.connect(db_path, check_same_thread=False)
            raw_conn.row_factory = SQLiteRowObject
            conn = CompatibleConnection(raw_conn, "sqlite")
            cursor = conn.cursor()
            DB_AVAILABLE = True
            DB_TYPE = "sqlite"
            initialize_sqlite_db(cursor, conn)
            print(f"Database (SQLite) connected successfully at {db_path}")
        except Exception as sqlite_err:
            print(f"SQLite connection failed: {sqlite_err}")
            print("Running without database - predictions will work but data won't be saved")
            DB_AVAILABLE = False
            conn = None
            cursor = None

#  LOAD MODEL + SCALER (new multi-city models, trained on FLOOD_DATASET.csv)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
scaler = joblib.load(os.path.join(BASE_DIR, "model", "flood_scaler.pkl"))
MODEL_FEATURES = list(scaler.feature_names_in_)

# XGBoost is the best-performing model (per training comparison); Random Forest
# is kept as an automatic fallback in case xgboost isn't installed on this machine.
try:
    model = joblib.load(os.path.join(BASE_DIR, "model", "flood_model_xgb.pkl"))
    ACTIVE_MODEL_NAME = "XGBoost"
except Exception as e:
    print(f"XGBoost model failed to load ({e}); falling back to Random Forest.")
    model = joblib.load(os.path.join(BASE_DIR, "model", "flood_model_rf.pkl"))
    ACTIVE_MODEL_NAME = "Random Forest"

# SHAP explainer for real, per-prediction feature attributions (FR-11)
SHAP_EXPLAINER = None
if SHAP_AVAILABLE:
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
    else:
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

    return jsonify({"message": "User registered successfully"})

# ---------------- LOGIN ----------------
@app.route("/login", methods=["POST"])
def login():
    data = request.json or {}
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not email or not password:
        return jsonify({"message": "Email and password are required"}), 400

    # Check the database FIRST when available -- it's the authoritative,
    # persistent record. MEMORY_USERS is only a same-session convenience
    # cache and resets on every server restart, so checking it first (or
    # only) is exactly what caused "Invalid credentials" for real,
    # previously-registered accounts after any backend restart.
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email,))
            db_user = cursor.fetchone()
        except Exception as e:
            log_event("error", f"Login DB query error for {email}: {e}")
            db_user = None

        if db_user and getattr(db_user, "password", "") == password:
            status = getattr(db_user, "status", "Active")
            if status != "Active":
                return jsonify({"message": "User account is deactivated"}), 403
            log_event("info", f"Login success (DB): {email}")
            return jsonify({
                "message": "Login success",
                "id": db_user.id,
                "role": db_user.role,
                "name": db_user.name,
                "email": db_user.email
            })

    # Fall back to the in-memory list (covers the seeded default admin and
    # any DB-unavailable deployments)
    user = next(
        (u for u in MEMORY_USERS
         if u.get("email", "").strip().lower() == email
         and u.get("password", "") == password),
        None
    )
    if user:
        if user.get("status", "Active") != "Active":
            return jsonify({"message": "User account is deactivated"}), 403
        log_event("info", f"Login success (memory): {email}")
        return jsonify({
            "message": "Login success",
            "id": user["id"],
            "role": user["role"],
            "name": user["name"],
            "email": user["email"]
        })

    log_event("warning", f"Failed login attempt for {email}")
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
                data.append({
                    "id": row.id,
                    "name": row.name,
                    "email": row.email,
                    "role": row.role,
                    "status": getattr(row, "status", "Active"),
                    "on_duty": bool(on_duty_val) if on_duty_val is not None else True,
                    "created_at": row.created_at.isoformat() if row.created_at else None
                })
        except Exception as e:
            print("USERS DB ERROR:", e)
            try:
                cursor.execute("SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC")
                rows = cursor.fetchall()
                for row in rows:
                    db_emails.add(row.email)
                    data.append({
                        "id": row.id,
                        "name": row.name,
                        "email": row.email,
                        "role": row.role,
                        "status": "Active",
                        "created_at": row.created_at.isoformat() if row.created_at else None
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

    # No SMTP service is configured for this deployment, so the "email" is
    # simulated by logging it to the backend console — the code/token itself
    # is real and the reset below actually updates the password.
    print(f"\n[PASSWORD RESET] Verification code for {email}: {token} (expires in 15 min)\n")

    return jsonify({"message": "A verification code has been generated. Check the backend console (email sending is simulated in this deployment)."})

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
    if not record or record["token"] != token:
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
        if hasattr(model, 'predict_proba'):
            probabilities = model.predict_proba(scaled_features)[0]
            confidence = float(probabilities[prediction])
        else:
            confidence = 0.75 if risk == "Low" else 0.82 if risk == "Medium" else 0.90

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
Model Confidence: {(confidence * 100):.1f}%
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
            "city": resolved_city,
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
            "model_used": ACTIVE_MODEL_NAME,
            "user_email": user_email,
            "created_at": str(datetime.now())
        }

        if DB_AVAILABLE:
            try:
                cursor.execute("""
                    INSERT INTO predictions
                    (location, rainfall, river_level, temperature, input_data, risk, confidence, explanation, user_email)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    data.get("location"),
                    rainfall,
                    river_level,
                    temperature,
                    json.dumps(input_data),
                    risk,
                    confidence,
                    explanation,
                    user_email
                ))
                conn.commit()
            except Exception as db_error:
                log_event("error", f"Failed to save prediction to database: {db_error}")
        else:
            # Save to memory when database is not available
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
            
            alert_record = {
                "id": len(MEMORY_ALERTS) + 1,
                "message": alert_message,
                "risk_level": risk,
                "risk": risk,
                "location": location,
                "status": "Active",
                "assigned_worker": None,
                "linked_rescue_op_id": None,
                "created_at": str(datetime.now())
            }
            
            MEMORY_ALERTS.append(alert_record)
            
            if DB_AVAILABLE:
                try:
                    cursor.execute("""
                        INSERT INTO alerts (message, risk_level, location)
                        VALUES (?, ?, ?)
                    """, (alert_message, risk, location))
                    conn.commit()
                except Exception as db_error:
                    print(f"Failed to save alert to database: {db_error}")

        model_comparison = None
        if COMPARISON_MODEL is not None:
            try:
                cmp_pred = int(COMPARISON_MODEL.predict(scaled_features)[0])
                cmp_conf = float(COMPARISON_MODEL.predict_proba(scaled_features)[0][cmp_pred]) if hasattr(COMPARISON_MODEL, "predict_proba") else None
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
            "confidence": 0.70,
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
            cursor.execute("SELECT * FROM predictions ORDER BY created_at DESC")
            rows = cursor.fetchall()

            for row in rows:
                input_data = None
                try:
                    input_data = json.loads(row.input_data) if row.input_data else None
                except Exception:
                    input_data = None

                record = {
                    "location": getattr(row, "location", None),
                    "rainfall": getattr(row, "rainfall", None),
                    "river_level": getattr(row, "river_level", None),
                    "temperature": getattr(row, "temperature", None),
                    "input_data": input_data,
                    "risk": getattr(row, "risk", None),
                    "confidence": getattr(row, "confidence", None),
                    "explanation": getattr(row, "explanation", None),
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

# ---------------- ALERTS ----------------
@app.route("/alerts", methods=["GET"])
def get_alerts():
    location_filter = (request.args.get("location") or "").strip().lower()
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT id, message, risk_level, location, status, assigned_worker, linked_rescue_op_id, created_at FROM alerts ORDER BY created_at DESC")
            rows = cursor.fetchall()
            data = []
            seen_ids = set()
            for row in rows:
                record = {
                    "id": getattr(row, "id", None),
                    "message": getattr(row, "message", None),
                    "risk_level": getattr(row, "risk_level", None),
                    "risk": getattr(row, "risk_level", None),
                    "location": getattr(row, "location", None),
                    "status": getattr(row, "status", None),
                    "assigned_worker": getattr(row, "assigned_worker", None),
                    "linked_rescue_op_id": getattr(row, "linked_rescue_op_id", None),
                    "created_at": getattr(row, "created_at", None).isoformat() if getattr(row, "created_at", None) is not None else None
                }
                data.append(record)
                seen_ids.add(record["id"])
            # Append in-memory alerts if not duplicated
            for alert in MEMORY_ALERTS[::-1]:
                if alert["id"] not in seen_ids:
                    data.append(alert)
            if location_filter:
                # Used by the Citizen Dashboard's "alerts in your area" —
                # everywhere else (Admin/Rescue/Navbar) calls this with no
                # filter and still gets every alert, unchanged.
                data = [a for a in data if location_filter in (a.get("location") or "").strip().lower()]
            return jsonify(data)
        except Exception as e:
            log_event("error", f"Failed to fetch alerts: {e}")
            fallback = MEMORY_ALERTS[::-1]
            if location_filter:
                fallback = [a for a in fallback if location_filter in (a.get("location") or "").strip().lower()]
            return jsonify(fallback)
    else:
        # Return in-memory alerts
        fallback = MEMORY_ALERTS[::-1]  # Reverse to show newest first
        if location_filter:
            fallback = [a for a in fallback if location_filter in (a.get("location") or "").strip().lower()]
        return jsonify(fallback)

@app.route("/alerts", methods=["POST"])
def create_alert():
    data = request.json
    
    alert_record = {
        "id": len(MEMORY_ALERTS) + 1,
        "message": data["message"],
        "risk_level": data.get("risk_level", "Medium"),
        "risk": data.get("risk", data.get("risk_level", "Medium")),
        "location": data.get("location", "Unknown"),
        "status": "Active",
        "assigned_worker": None,
        "linked_rescue_op_id": None,
        "created_at": str(datetime.now())
    }
    
    MEMORY_ALERTS.append(alert_record)
    
    if DB_AVAILABLE:
        try:
            cursor.execute("""
                INSERT INTO alerts (message, risk_level, location)
                VALUES (?, ?, ?)
            """, (data["message"], data.get("risk_level", "Medium"), data.get("location", "Unknown")))
            conn.commit()
        except Exception as db_error:
            print(f"Failed to save alert to database: {db_error}")
    
    return jsonify(alert_record)

@app.route("/alerts/<int:alert_id>", methods=["DELETE"])
def delete_alert(alert_id):
    # Remove from memory
    MEMORY_ALERTS[:] = [a for a in MEMORY_ALERTS if a["id"] != alert_id]
    
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
            conn.commit()
        except Exception as db_error:
            print(f"Failed to delete alert from database: {db_error}")
    
    return jsonify({"message": "Alert deleted successfully"})

@app.route("/alerts/<int:alert_id>", methods=["PUT"])
def update_alert(alert_id):
    """FR03-04: allow admins to cancel or update an active alert."""
    data = request.json or {}
    updated = None
    for a in MEMORY_ALERTS:
        if a["id"] == alert_id:
            if "message" in data:
                a["message"] = data["message"]
            if "risk_level" in data:
                a["risk_level"] = data["risk_level"]
                a["risk"] = data["risk_level"]
            if "location" in data:
                a["location"] = data["location"]
            if "status" in data:
                a["status"] = data["status"]  # e.g. "Cancelled"
            if "assigned_worker" in data:
                a["assigned_worker"] = data["assigned_worker"]
                log_event("info", f"Alert #{alert_id} ({a.get('location')}) escalated — rescue worker '{data['assigned_worker']}' assigned")
            if "linked_rescue_op_id" in data:
                a["linked_rescue_op_id"] = data["linked_rescue_op_id"]
            updated = a
            break

    if DB_AVAILABLE:
        try:
            cursor.execute(
                "UPDATE alerts SET message = COALESCE(?, message), risk_level = COALESCE(?, risk_level), "
                "location = COALESCE(?, location), status = COALESCE(?, status), "
                "assigned_worker = COALESCE(?, assigned_worker), linked_rescue_op_id = COALESCE(?, linked_rescue_op_id) WHERE id = ?",
                (data.get("message"), data.get("risk_level"), data.get("location"), data.get("status"),
                 data.get("assigned_worker"), data.get("linked_rescue_op_id"), alert_id)
            )
            conn.commit()
        except Exception as db_error:
            log_event("error", f"Failed to update alert in database: {db_error}")

    if not updated and not DB_AVAILABLE:
        return jsonify({"message": "Alert not found"}), 404
    return jsonify(updated or {"id": alert_id, **data})

# ---------------- RESCUE OPERATIONS (FR-05) ----------------
MEMORY_RESCUE_OPS = []
RISK_PRIORITY = {"High": 1, "Medium": 2, "Low": 3}

@app.route("/rescue-operations", methods=["GET"])
def get_rescue_operations():
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
                })
                seen_ids.add(row_id)
        except Exception as e:
            log_event("error", f"Failed to fetch rescue operations: {e}")

    # FR05-07: prioritize by risk level, most urgent first; then newest first
    ops = sorted(all_ops, key=lambda o: o["created_at"], reverse=True)
    ops = sorted(ops, key=lambda o: RISK_PRIORITY.get(o["risk_level"], 9))
    return jsonify(ops)

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
    else:
        cursor.execute(insert_query_with_qmarks, params)
        conn.commit()
        cursor.execute("SELECT last_insert_rowid() AS new_id")
        row = cursor.fetchone()
        if not row:
            raise RuntimeError("last_insert_rowid() returned no row")
        return row.new_id if hasattr(row, "new_id") else row[0]


def _create_rescue_op_internal(location, description="", risk_level="Medium", assigned_team="Unassigned"):
    """Shared by the manual '+ New Operation' form and the automatic
    community-report -> rescue-operation link (see update_community_report_status)."""
    op = {
        "id": (max([o["id"] for o in MEMORY_RESCUE_OPS], default=0) + 1),
        "location": location,
        "description": description,
        "risk_level": risk_level,
        "assigned_team": assigned_team or "Unassigned",
        "status": "Assigned",
        "created_at": str(datetime.now()),
        "updated_at": str(datetime.now()),
        "completed_at": None,
        "needs_backup": False,
        "update_log": [],
    }
    MEMORY_RESCUE_OPS.append(op)

    if DB_AVAILABLE:
        try:
            op["id"] = _db_insert_get_id(
                "INSERT INTO rescue_operations (location, description, risk_level, assigned_team, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (op["location"], op["description"], op["risk_level"], op["assigned_team"], op["status"], op["created_at"], op["updated_at"])
            )
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

    try:
        op = _create_rescue_op_internal(
            location=location, description=data.get("description", ""),
            risk_level=data.get("risk_level", "Medium"), assigned_team=data.get("assigned_team", "Unassigned"),
        )
    except Exception:
        return jsonify({"message": "Could not save the operation to the database — please try again."}), 503
    # FR05-03: notify relevant rescue teams when a new operation is created.
    # No real push/SMS gateway is wired up yet, so this is logged server-side;
    # swap this for a real notification service (e.g. Twilio/email) when ready.
    return jsonify(op), 201

@app.route("/rescue-operations/<int:op_id>/status", methods=["PUT"])
def update_rescue_operation_status(op_id):
    data = request.json or {}
    new_status = data.get("status")
    if new_status not in ("Assigned", "In Progress", "Completed"):
        return jsonify({"message": "Invalid status"}), 400

    updated_at = str(datetime.now())
    completed_at = updated_at if new_status == "Completed" else None
    people_rescued = data.get("people_rescued") if new_status == "Completed" else None
    resources_used = data.get("resources_used", "") if new_status == "Completed" else None
    completion_notes = data.get("completion_notes", "") if new_status == "Completed" else None
    assigned_team = data.get("assigned_team")
    needs_backup = data.get("needs_backup")  # True/False/None (None = leave unchanged)

    result = None
    for op in MEMORY_RESCUE_OPS:
        if op["id"] == op_id:
            op["status"] = new_status
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
                "UPDATE rescue_operations SET status = ?, updated_at = ?, "
                "assigned_team = COALESCE(?, assigned_team), completed_at = COALESCE(?, completed_at), "
                "people_rescued = COALESCE(?, people_rescued), resources_used = COALESCE(?, resources_used), "
                "completion_notes = COALESCE(?, completion_notes), needs_backup = COALESCE(?, needs_backup) WHERE id = ?",
                (new_status, updated_at, assigned_team, completed_at, people_rescued, resources_used, completion_notes, needs_backup_db, op_id)
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

    if result is None:
        return jsonify({"message": "Rescue operation not found"}), 404
    return jsonify(result)


@app.route("/rescue-operations/<int:op_id>", methods=["DELETE"])
def delete_rescue_operation(op_id):
    """Removes an operation entirely — for stuck/duplicate test entries
    (e.g. ones left over from an earlier id-mismatch bug) that a coordinator
    wants off the board rather than something to keep acting on."""
    global MEMORY_RESCUE_OPS
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

@app.route("/shelters", methods=["GET"])
def get_shelters():
    data = list(MEMORY_SHELTERS)
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT id, name, address, capacity, contact, latitude, longitude FROM shelters ORDER BY id DESC")
            for row in cursor.fetchall():
                data.append({
                    "id": row.id, "name": row.name, "name_ur": None, "address": row.address,
                    "capacity": row.capacity, "contact": row.contact,
                    "latitude": row.latitude, "longitude": row.longitude,
                })
        except Exception as e:
            print("SHELTERS DB ERROR:", e)
    return jsonify(data)

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

    shelter = {
        "id": (max([s["id"] for s in MEMORY_SHELTERS], default=0) + 1),
        "name": name, "name_ur": data.get("name_ur") or None, "address": address,
        "capacity": data.get("capacity"), "contact": data.get("contact", ""),
        "latitude": safe_float(data.get("latitude"), None) if data.get("latitude") not in (None, "") else None,
        "longitude": safe_float(data.get("longitude"), None) if data.get("longitude") not in (None, "") else None,
    }
    MEMORY_SHELTERS.append(shelter)

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT COUNT(*) AS c FROM shelters WHERE LOWER(name)=? AND LOWER(address)=?", (name.lower(), address.lower()))
            if cursor.fetchone().c == 0:
                cursor.execute(
                    "INSERT INTO shelters (name, address, capacity, contact, latitude, longitude) VALUES (?,?,?,?,?,?)",
                    (name, address, shelter["capacity"], shelter["contact"], shelter["latitude"], shelter["longitude"])
                )
                conn.commit()
            else:
                return jsonify({"message": "A shelter with this name and address already exists"}), 400
        except Exception as e:
            print("Failed to save shelter to database:", e)

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
                "UPDATE shelters SET name=?, address=?, capacity=?, contact=?, latitude=?, longitude=? WHERE id=?",
                (data.get("name"), data.get("address"), data.get("capacity"), data.get("contact"),
                 data.get("latitude"), data.get("longitude"), shelter_id)
            )
            conn.commit()
        except Exception as e:
            print("Failed to update shelter in database:", e)

    if not updated and not DB_AVAILABLE:
        return jsonify({"message": "Shelter not found"}), 404
    return jsonify(updated or {"id": shelter_id, **data})

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
    data = list(MEMORY_HOSPITALS)
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT id, name, address, contact, services, latitude, longitude FROM hospitals ORDER BY id DESC")
            for row in cursor.fetchall():
                data.append({
                    "id": row.id, "name": row.name, "name_ur": None, "address": row.address,
                    "contact": row.contact, "services": row.services,
                    "latitude": row.latitude, "longitude": row.longitude,
                })
        except Exception as e:
            print("HOSPITALS DB ERROR:", e)
    return jsonify(data)

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

    hospital = {
        "id": (max([h["id"] for h in MEMORY_HOSPITALS], default=0) + 1),
        "name": name, "name_ur": data.get("name_ur") or None, "address": address,
        "contact": data.get("contact", ""), "services": data.get("services", ""),
        "latitude": safe_float(data.get("latitude"), None) if data.get("latitude") not in (None, "") else None,
        "longitude": safe_float(data.get("longitude"), None) if data.get("longitude") not in (None, "") else None,
    }
    MEMORY_HOSPITALS.append(hospital)

    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT COUNT(*) AS c FROM hospitals WHERE LOWER(name)=? AND LOWER(address)=?", (name.lower(), address.lower()))
            if cursor.fetchone().c == 0:
                cursor.execute(
                    "INSERT INTO hospitals (name, address, contact, services, latitude, longitude) VALUES (?,?,?,?,?,?)",
                    (name, address, hospital["contact"], hospital["services"], hospital["latitude"], hospital["longitude"])
                )
                conn.commit()
            else:
                return jsonify({"message": "A hospital with this name and address already exists"}), 400
        except Exception as e:
            print("Failed to save hospital to database:", e)

    return jsonify(hospital), 201

@app.route("/hospitals/<int:hospital_id>", methods=["PUT"])
def update_hospital(hospital_id):
    data = request.json or {}
    updated = None
    for h in MEMORY_HOSPITALS:
        if h["id"] == hospital_id:
            h.update({k: data[k] for k in ("name", "address", "contact", "services", "latitude", "longitude") if k in data})
            updated = h
            break

    if DB_AVAILABLE:
        try:
            cursor.execute(
                "UPDATE hospitals SET name=?, address=?, contact=?, services=?, latitude=?, longitude=? WHERE id=?",
                (data.get("name"), data.get("address"), data.get("contact"), data.get("services"),
                 data.get("latitude"), data.get("longitude"), hospital_id)
            )
            conn.commit()
        except Exception as e:
            print("Failed to update hospital in database:", e)

    if not updated and not DB_AVAILABLE:
        return jsonify({"message": "Hospital not found"}), 404
    return jsonify(updated or {"id": hospital_id, **data})

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

# ---------------- COMMUNITY REPORTS (FR-06) ----------------
MEMORY_COMMUNITY_REPORTS = []

def _next_tracking_id():
    n = len(MEMORY_COMMUNITY_REPORTS) + 1
    if DB_AVAILABLE:
        try:
            cursor.execute("SELECT COUNT(*) AS c FROM community_reports")
            n = cursor.fetchone().c + 1
        except Exception:
            pass
    return f"FMS-{1000 + n}"

@app.route("/community-reports", methods=["GET"])
def get_community_reports():
    data = list(MEMORY_COMMUNITY_REPORTS)
    if DB_AVAILABLE:
        try:
            cursor.execute("""SELECT id, tracking_id, location, region, incident_type, severity, status,
                               author_name, author_email, description, contact, image_url, notes, created_at
                               FROM community_reports ORDER BY created_at DESC""")
            for row in cursor.fetchall():
                data.append({
                    "id": row.id, "trackingId": row.tracking_id, "location": row.location,
                    "region": row.region, "type": row.incident_type, "severity": row.severity,
                    "status": row.status, "authorName": row.author_name, "authorEmail": row.author_email,
                    "description": row.description, "contact": row.contact, "imageUrl": row.image_url,
                    "notes": row.notes, "createdAt": row.created_at.isoformat() if row.created_at else None,
                    "confirmedBy": [],
                })
        except Exception as e:
            print("COMMUNITY REPORTS DB ERROR:", e)
    return jsonify(data)

@app.route("/community-reports", methods=["POST"])
def create_community_report():
    data = request.json or {}
    location = (data.get("location") or "").strip()
    description = (data.get("description") or "").strip()
    contact = (data.get("contact") or "").strip()
    if not location or not description or not contact:
        return jsonify({"message": "Location, description and contact are required"}), 400

    tracking_id = _next_tracking_id()
    report = {
        "id": (max([r["id"] for r in MEMORY_COMMUNITY_REPORTS], default=0) + 1),
        "trackingId": tracking_id,
        "location": location,
        "region": data.get("region", ""),
        "type": data.get("type", "Flooding"),
        "severity": data.get("severity", "High"),
        "status": "Submitted",  # FR06-01
        "authorName": data.get("authorName", "Guest User"),
        "authorEmail": data.get("authorEmail", ""),
        "description": description,
        "contact": contact,
        "imageUrl": data.get("imageUrl", ""),  # FR06-05
        "notes": "Incident added to the community review queue.",
        "createdAt": str(datetime.now()),
        "confirmedBy": [],
    }
    MEMORY_COMMUNITY_REPORTS.append(report)

    if DB_AVAILABLE:
        try:
            cursor.execute("""INSERT INTO community_reports
                (tracking_id, location, region, incident_type, severity, status, author_name, author_email,
                 description, contact, image_url, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (tracking_id, location, report["region"], report["type"], report["severity"], report["status"],
                 report["authorName"], report["authorEmail"], description, contact, report["imageUrl"], report["notes"]))
            conn.commit()
        except Exception as e:
            print("Failed to save community report to database:", e)

    # FR06-03: acknowledgment happens via the tracking_id returned in this response
    return jsonify(report), 201

@app.route("/community-reports/<int:report_id>/status", methods=["PUT"])
def update_community_report_status(report_id):
    data = request.json or {}
    new_status = data.get("status")
    if new_status not in ("Submitted", "Under Review", "Action Taken", "Resolved"):
        return jsonify({"message": "Invalid status"}), 400

    updated = None
    linked_op = None
    for r in MEMORY_COMMUNITY_REPORTS:
        if r["id"] == report_id:
            r["status"] = new_status

            # FR06-04 made real: moving a report to "Action Taken" creates an
            # actual Rescue Operation (FR-05) linked back to this report,
            # instead of just flipping a status label. If one's already
            # linked (e.g. re-clicking), it's reused rather than duplicated.
            if new_status == "Action Taken" and not r.get("linked_rescue_op_id"):
                try:
                    linked_op = _create_rescue_op_internal(
                        location=r["location"],
                        description=f"Community report {r['trackingId']}: {r['description']}",
                        risk_level=r.get("severity", "Medium"),
                        assigned_team=data.get("assigned_team", "Unassigned"),
                    )
                except Exception:
                    r["status"] = "Submitted"  # roll back — dispatch didn't actually succeed
                    return jsonify({"message": "Could not create the rescue operation — please try again."}), 503
                r["linked_rescue_op_id"] = linked_op["id"]
                r["notes"] = f"Action taken — Rescue Operation #{linked_op['id']} created and dispatched to {r['location']}."
            else:
                r["notes"] = f"Status updated to {new_status}."

            updated = r
            break

    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE community_reports SET status=?, notes=? WHERE id=?",
                            (new_status, (updated or {}).get("notes", f"Status updated to {new_status}."), report_id))
            conn.commit()
        except Exception as e:
            print("Failed to update community report in database:", e)

    if not updated and not DB_AVAILABLE:
        return jsonify({"message": "Report not found"}), 404
    result = dict(updated or {"id": report_id, "status": new_status})
    if linked_op:
        result["linked_rescue_op"] = linked_op
    return jsonify(result)

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
        "id": (max([r["id"] for r in MEMORY_BLOCKED_ROADS], default=0) + 1),
        "name": name, "location": location,
        "latitude": lat, "longitude": lng,
        "reason": data.get("reason", ""), "status": "Blocked",
    }
    MEMORY_BLOCKED_ROADS.append(road)

    if DB_AVAILABLE:
        try:
            cursor.execute(
                "INSERT INTO blocked_roads (name, location, latitude, longitude, reason, status) VALUES (?,?,?,?,?,?)",
                (name, location, lat, lng, road["reason"], "Blocked")
            )
            conn.commit()
        except Exception as e:
            print("Failed to save blocked road:", e)

    return jsonify(road), 201

@app.route("/blocked-roads/<int:road_id>", methods=["PUT"])
def update_blocked_road(road_id):
    """Allows officials to mark a road as Cleared (FR04-03/04-05)."""
    data = request.json or {}
    updated = None
    for r in MEMORY_BLOCKED_ROADS:
        if r["id"] == road_id:
            if "status" in data:
                r["status"] = data["status"]
            updated = r
            break
    if DB_AVAILABLE:
        try:
            cursor.execute("UPDATE blocked_roads SET status = ? WHERE id = ?", (data.get("status"), road_id))
            conn.commit()
        except Exception as e:
            print("Failed to update blocked road:", e)
    if not updated and not DB_AVAILABLE:
        return jsonify({"message": "Blocked road not found"}), 404
    return jsonify(updated or {"id": road_id, **data})

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
        if s.get("latitude") and s.get("longitude"):
            markers.append({"id": f"shelter-{s['id']}", "type": "shelter", "category_color": "teal",
                             "name": s["name"], "name_ur": s.get("name_ur"), "location": s.get("address"),
                             "latitude": s["latitude"], "longitude": s["longitude"]})

    hospitals_resp = get_hospitals()
    for h in hospitals_resp.json:
        if h.get("latitude") and h.get("longitude"):
            markers.append({"id": f"hospital-{h['id']}", "type": "hospital", "category_color": "marigold",
                             "name": h["name"], "name_ur": h.get("name_ur"), "location": h.get("address"),
                             "latitude": h["latitude"], "longitude": h["longitude"]})

    ops_resp = get_rescue_operations()
    for op in ops_resp.json:
        coords = resolve_coordinates(op.get("location", ""))
        if coords:
            markers.append({"id": f"rescue-{op['id']}", "type": "rescue_operation",
                             "category_color": "violet",
                             "name": f"Rescue: {op.get('location')}", "location": op.get("description", ""),
                             "status": op.get("status"), "risk_level": op.get("risk_level"),
                             "latitude": coords[0], "longitude": coords[1]})

    reports_resp = get_community_reports()
    for rep in reports_resp.json:
        coords = resolve_coordinates(rep.get("location", ""))
        if coords:
            markers.append({"id": f"report-{rep['id']}", "type": "community_report",
                             "category_color": "black",
                             "name": f"Report: {rep.get('type')}", "location": rep.get("location"),
                             "status": rep.get("status"), "severity": rep.get("severity"),
                             "latitude": coords[0], "longitude": coords[1]})

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

# ---------------- SEED SAMPLE DATA (so the app isn't empty on first run) ----------------
def seed_sample_data():
    if MEMORY_SHELTERS:
        return  # already seeded (or a restart with data still in memory)

    # 2-3 named hospitals and 2 relief-camp-style shelters per known city, so
    # every city a citizen searches for has real, distinct facilities to
    # find (not one generic "{city} General Hospital" record). Major cities
    # use genuine well-known hospital names; smaller towns use Pakistan's
    # standard DHQ/THQ hospital naming convention. Coordinates are jittered
    # slightly around the city center so markers don't overlap on the map.
    # Administrators should still verify/update contact numbers and exact
    # addresses for their region.
    MEMORY_SHELTERS.extend([
        {"id": 1, "name": "Karachi Sports Complex Relief Camp", "name_ur": "کراچی سپورٹس کمپلیکس ریلیف کیمپ", "address": "Karachi", "capacity": 100, "contact": "", "latitude": 24.86884, "longitude": 66.98705},
        {"id": 2, "name": "Govt Degree College Karachi Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج کراچی ریلیف کیمپ", "address": "Karachi", "capacity": 100, "contact": "", "latitude": 24.82694, "longitude": 67.00142},
        {"id": 3, "name": "Lahore Sports Complex Relief Camp", "name_ur": "لاہور سپورٹس کمپلیکس ریلیف کیمپ", "address": "Lahore", "capacity": 100, "contact": "", "latitude": 31.54369, "longitude": 74.34849},
        {"id": 4, "name": "Govt Degree College Lahore Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج لاہور ریلیف کیمپ", "address": "Lahore", "capacity": 250, "contact": "", "latitude": 31.50123, "longitude": 74.33803},
        {"id": 5, "name": "Faisalabad Sports Complex Relief Camp", "name_ur": "فیصل آباد سپورٹس کمپلیکس ریلیف کیمپ", "address": "Faisalabad", "capacity": 200, "contact": "", "latitude": 31.45974, "longitude": 73.14421},
        {"id": 6, "name": "Govt Degree College Faisalabad Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج فیصل آباد ریلیف کیمپ", "address": "Faisalabad", "capacity": 250, "contact": "", "latitude": 31.45475, "longitude": 73.16339},
        {"id": 7, "name": "Rawalpindi Sports Complex Relief Camp", "name_ur": "راولپنڈی سپورٹس کمپلیکس ریلیف کیمپ", "address": "Rawalpindi", "capacity": 100, "contact": "", "latitude": 33.52422, "longitude": 73.00874},
        {"id": 8, "name": "Govt Degree College Rawalpindi Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج راولپنڈی ریلیف کیمپ", "address": "Rawalpindi", "capacity": 200, "contact": "", "latitude": 33.62333, "longitude": 73.03822},
        {"id": 9, "name": "Multan Sports Complex Relief Camp", "name_ur": "ملتان سپورٹس کمپلیکس ریلیف کیمپ", "address": "Multan", "capacity": 150, "contact": "", "latitude": 30.14582, "longitude": 71.51619},
        {"id": 10, "name": "Govt Degree College Multan Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج ملتان ریلیف کیمپ", "address": "Multan", "capacity": 200, "contact": "", "latitude": 30.18172, "longitude": 71.53591},
        {"id": 11, "name": "Hyderabad Sports Complex Relief Camp", "name_ur": "حیدرآباد سپورٹس کمپلیکس ریلیف کیمپ", "address": "Hyderabad", "capacity": 250, "contact": "", "latitude": 25.38515, "longitude": 68.37249},
        {"id": 12, "name": "Govt Degree College Hyderabad Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج حیدرآباد ریلیف کیمپ", "address": "Hyderabad", "capacity": 150, "contact": "", "latitude": 25.41815, "longitude": 68.37837},
        {"id": 13, "name": "Gujranwala Sports Complex Relief Camp", "name_ur": "گوجرانوالہ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Gujranwala", "capacity": 200, "contact": "", "latitude": 32.14866, "longitude": 74.20689},
        {"id": 14, "name": "Govt Degree College Gujranwala Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج گوجرانوالہ ریلیف کیمپ", "address": "Gujranwala", "capacity": 200, "contact": "", "latitude": 32.15322, "longitude": 74.19445},
        {"id": 15, "name": "Peshawar Sports Complex Relief Camp", "name_ur": "پشاور سپورٹس کمپلیکس ریلیف کیمپ", "address": "Peshawar", "capacity": 200, "contact": "", "latitude": 34.03733, "longitude": 71.52275},
        {"id": 16, "name": "Govt Degree College Peshawar Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج پشاور ریلیف کیمپ", "address": "Peshawar", "capacity": 250, "contact": "", "latitude": 33.99854, "longitude": 71.55474},
        {"id": 17, "name": "Quetta Sports Complex Relief Camp", "name_ur": "کوئٹہ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Quetta", "capacity": 150, "contact": "", "latitude": 30.19127, "longitude": 66.98376},
        {"id": 18, "name": "Govt Degree College Quetta Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج کوئٹہ ریلیف کیمپ", "address": "Quetta", "capacity": 250, "contact": "", "latitude": 30.19137, "longitude": 66.96809},
        {"id": 19, "name": "Islamabad Sports Complex Relief Camp", "name_ur": "اسلام آباد سپورٹس کمپلیکس ریلیف کیمپ", "address": "Islamabad", "capacity": 100, "contact": "", "latitude": 33.70075, "longitude": 73.04901},
        {"id": 20, "name": "Govt Degree College Islamabad Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج اسلام آباد ریلیف کیمپ", "address": "Islamabad", "capacity": 200, "contact": "", "latitude": 33.71663, "longitude": 73.03831},
        {"id": 21, "name": "Sialkot Sports Complex Relief Camp", "name_ur": "سیالکوٹ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Sialkot", "capacity": 200, "contact": "", "latitude": 32.53697, "longitude": 74.53076},
        {"id": 22, "name": "Govt Degree College Sialkot Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج سیالکوٹ ریلیف کیمپ", "address": "Sialkot", "capacity": 100, "contact": "", "latitude": 32.53896, "longitude": 74.51081},
        {"id": 23, "name": "Sargodha Sports Complex Relief Camp", "name_ur": "سرگودھا سپورٹس کمپلیکس ریلیف کیمپ", "address": "Sargodha", "capacity": 100, "contact": "", "latitude": 32.09251, "longitude": 72.67076},
        {"id": 24, "name": "Govt Degree College Sargodha Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج سرگودھا ریلیف کیمپ", "address": "Sargodha", "capacity": 100, "contact": "", "latitude": 32.13509, "longitude": 72.69382},
        {"id": 25, "name": "Bahawalpur Sports Complex Relief Camp", "name_ur": "بہاولپور سپورٹس کمپلیکس ریلیف کیمپ", "address": "Bahawalpur", "capacity": 100, "contact": "", "latitude": 29.35831, "longitude": 71.68318},
        {"id": 26, "name": "Govt Degree College Bahawalpur Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج بہاولپور ریلیف کیمپ", "address": "Bahawalpur", "capacity": 100, "contact": "", "latitude": 29.45296, "longitude": 71.68556},
        {"id": 27, "name": "Sukkur Sports Complex Relief Camp", "name_ur": "سکھر سپورٹس کمپلیکس ریلیف کیمپ", "address": "Sukkur", "capacity": 250, "contact": "", "latitude": 27.74699, "longitude": 68.87027},
        {"id": 28, "name": "Govt Degree College Sukkur Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج سکھر ریلیف کیمپ", "address": "Sukkur", "capacity": 150, "contact": "", "latitude": 27.73075, "longitude": 68.85134},
        {"id": 29, "name": "Larkana Sports Complex Relief Camp", "name_ur": "لاڑکانہ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Larkana", "capacity": 250, "contact": "", "latitude": 27.52489, "longitude": 68.20404},
        {"id": 30, "name": "Govt Degree College Larkana Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج لاڑکانہ ریلیف کیمپ", "address": "Larkana", "capacity": 200, "contact": "", "latitude": 27.50152, "longitude": 68.21554},
        {"id": 31, "name": "Sheikhupura Sports Complex Relief Camp", "name_ur": "شیخوپورہ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Sheikhupura", "capacity": 100, "contact": "", "latitude": 31.75319, "longitude": 73.99579},
        {"id": 32, "name": "Govt Degree College Sheikhupura Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج شیخوپورہ ریلیف کیمپ", "address": "Sheikhupura", "capacity": 100, "contact": "", "latitude": 31.7184, "longitude": 73.97171},
        {"id": 33, "name": "Jhang Sports Complex Relief Camp", "name_ur": "جھنگ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Jhang", "capacity": 250, "contact": "", "latitude": 31.24727, "longitude": 72.31729},
        {"id": 34, "name": "Govt Degree College Jhang Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج جھنگ ریلیف کیمپ", "address": "Jhang", "capacity": 250, "contact": "", "latitude": 31.23325, "longitude": 72.29392},
        {"id": 35, "name": "Rahim Yar Khan Sports Complex Relief Camp", "name_ur": "رحیم یار خان سپورٹس کمپلیکس ریلیف کیمپ", "address": "Rahim Yar Khan", "capacity": 100, "contact": "", "latitude": 28.38066, "longitude": 70.30205},
        {"id": 36, "name": "Govt Degree College Rahim Yar Khan Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج رحیم یار خان ریلیف کیمپ", "address": "Rahim Yar Khan", "capacity": 100, "contact": "", "latitude": 28.39004, "longitude": 70.27661},
        {"id": 37, "name": "Gujrat Sports Complex Relief Camp", "name_ur": "گجرات سپورٹس کمپلیکس ریلیف کیمپ", "address": "Gujrat", "capacity": 100, "contact": "", "latitude": 32.56798, "longitude": 74.08974},
        {"id": 38, "name": "Govt Degree College Gujrat Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج گجرات ریلیف کیمپ", "address": "Gujrat", "capacity": 100, "contact": "", "latitude": 32.51917, "longitude": 74.10886},
        {"id": 39, "name": "Mardan Sports Complex Relief Camp", "name_ur": "مردان سپورٹس کمپلیکس ریلیف کیمپ", "address": "Mardan", "capacity": 150, "contact": "", "latitude": 34.16887, "longitude": 72.03997},
        {"id": 40, "name": "Govt Degree College Mardan Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج مردان ریلیف کیمپ", "address": "Mardan", "capacity": 150, "contact": "", "latitude": 34.24266, "longitude": 72.06455},
        {"id": 41, "name": "Kasur Sports Complex Relief Camp", "name_ur": "قصور سپورٹس کمپلیکس ریلیف کیمپ", "address": "Kasur", "capacity": 250, "contact": "", "latitude": 31.09867, "longitude": 74.4526},
        {"id": 42, "name": "Govt Degree College Kasur Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج قصور ریلیف کیمپ", "address": "Kasur", "capacity": 250, "contact": "", "latitude": 31.07658, "longitude": 74.4345},
        {"id": 43, "name": "Okara Sports Complex Relief Camp", "name_ur": "اوکاڑہ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Okara", "capacity": 100, "contact": "", "latitude": 30.76761, "longitude": 73.4446},
        {"id": 44, "name": "Govt Degree College Okara Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج اوکاڑہ ریلیف کیمپ", "address": "Okara", "capacity": 150, "contact": "", "latitude": 30.75493, "longitude": 73.44577},
        {"id": 45, "name": "Sahiwal Sports Complex Relief Camp", "name_ur": "ساہیوال سپورٹس کمپلیکس ریلیف کیمپ", "address": "Sahiwal", "capacity": 250, "contact": "", "latitude": 30.63399, "longitude": 73.12311},
        {"id": 46, "name": "Govt Degree College Sahiwal Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج ساہیوال ریلیف کیمپ", "address": "Sahiwal", "capacity": 150, "contact": "", "latitude": 30.67767, "longitude": 73.08378},
        {"id": 47, "name": "Nawabshah Sports Complex Relief Camp", "name_ur": "نوابشاہ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Nawabshah", "capacity": 200, "contact": "", "latitude": 26.21758, "longitude": 68.41649},
        {"id": 48, "name": "Govt Degree College Nawabshah Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج نوابشاہ ریلیف کیمپ", "address": "Nawabshah", "capacity": 150, "contact": "", "latitude": 26.21607, "longitude": 68.38785},
        {"id": 49, "name": "Mingora Sports Complex Relief Camp", "name_ur": "مینگورہ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Mingora", "capacity": 100, "contact": "", "latitude": 34.76795, "longitude": 72.37535},
        {"id": 50, "name": "Govt Degree College Mingora Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج مینگورہ ریلیف کیمپ", "address": "Mingora", "capacity": 100, "contact": "", "latitude": 34.72049, "longitude": 72.34319},
        {"id": 51, "name": "Dera Ghazi Khan Sports Complex Relief Camp", "name_ur": "ڈیرہ غازی خان سپورٹس کمپلیکس ریلیف کیمپ", "address": "Dera Ghazi Khan", "capacity": 100, "contact": "", "latitude": 30.09023, "longitude": 70.63059},
        {"id": 52, "name": "Govt Degree College Dera Ghazi Khan Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج ڈیرہ غازی خان ریلیف کیمپ", "address": "Dera Ghazi Khan", "capacity": 150, "contact": "", "latitude": 30.04868, "longitude": 70.63709},
        {"id": 53, "name": "Mirpur Khas Sports Complex Relief Camp", "name_ur": "میرپورخاص سپورٹس کمپلیکس ریلیف کیمپ", "address": "Mirpur Khas", "capacity": 200, "contact": "", "latitude": 25.56566, "longitude": 68.99881},
        {"id": 54, "name": "Govt Degree College Mirpur Khas Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج میرپورخاص ریلیف کیمپ", "address": "Mirpur Khas", "capacity": 150, "contact": "", "latitude": 25.49854, "longitude": 69.03408},
        {"id": 55, "name": "Chiniot Sports Complex Relief Camp", "name_ur": "چنیوٹ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Chiniot", "capacity": 200, "contact": "", "latitude": 31.69332, "longitude": 72.98213},
        {"id": 56, "name": "Govt Degree College Chiniot Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج چنیوٹ ریلیف کیمپ", "address": "Chiniot", "capacity": 200, "contact": "", "latitude": 31.72065, "longitude": 72.96317},
        {"id": 57, "name": "Kamoke Sports Complex Relief Camp", "name_ur": "کاموکی سپورٹس کمپلیکس ریلیف کیمپ", "address": "Kamoke", "capacity": 100, "contact": "", "latitude": 32.05422, "longitude": 74.23443},
        {"id": 58, "name": "Govt Degree College Kamoke Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج کاموکی ریلیف کیمپ", "address": "Kamoke", "capacity": 200, "contact": "", "latitude": 32.05829, "longitude": 74.22281},
        {"id": 59, "name": "Mandi Bahauddin Sports Complex Relief Camp", "name_ur": "منڈی بہاؤالدین سپورٹس کمپلیکس ریلیف کیمپ", "address": "Mandi Bahauddin", "capacity": 150, "contact": "", "latitude": 32.59, "longitude": 73.50174},
        {"id": 60, "name": "Govt Degree College Mandi Bahauddin Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج منڈی بہاؤالدین ریلیف کیمپ", "address": "Mandi Bahauddin", "capacity": 150, "contact": "", "latitude": 32.57747, "longitude": 73.46421},
        {"id": 61, "name": "Jacobabad Sports Complex Relief Camp", "name_ur": "جیکب آباد سپورٹس کمپلیکس ریلیف کیمپ", "address": "Jacobabad", "capacity": 200, "contact": "", "latitude": 28.25081, "longitude": 68.43059},
        {"id": 62, "name": "Govt Degree College Jacobabad Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج جیکب آباد ریلیف کیمپ", "address": "Jacobabad", "capacity": 100, "contact": "", "latitude": 28.25934, "longitude": 68.44169},
        {"id": 63, "name": "Jhelum Sports Complex Relief Camp", "name_ur": "جہلم سپورٹس کمپلیکس ریلیف کیمپ", "address": "Jhelum", "capacity": 150, "contact": "", "latitude": 32.97531, "longitude": 73.73999},
        {"id": 64, "name": "Govt Degree College Jhelum Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج جہلم ریلیف کیمپ", "address": "Jhelum", "capacity": 150, "contact": "", "latitude": 32.98827, "longitude": 73.69719},
        {"id": 65, "name": "Kohat Sports Complex Relief Camp", "name_ur": "کوہاٹ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Kohat", "capacity": 150, "contact": "", "latitude": 33.56901, "longitude": 71.44862},
        {"id": 66, "name": "Govt Degree College Kohat Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج کوہاٹ ریلیف کیمپ", "address": "Kohat", "capacity": 100, "contact": "", "latitude": 33.57591, "longitude": 71.41232},
        {"id": 67, "name": "Shikarpur Sports Complex Relief Camp", "name_ur": "شکارپور سپورٹس کمپلیکس ریلیف کیمپ", "address": "Shikarpur", "capacity": 150, "contact": "", "latitude": 27.93066, "longitude": 68.643},
        {"id": 68, "name": "Govt Degree College Shikarpur Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج شکارپور ریلیف کیمپ", "address": "Shikarpur", "capacity": 250, "contact": "", "latitude": 27.93499, "longitude": 68.66006},
        {"id": 69, "name": "Khanewal Sports Complex Relief Camp", "name_ur": "خانیوال سپورٹس کمپلیکس ریلیف کیمپ", "address": "Khanewal", "capacity": 200, "contact": "", "latitude": 30.34103, "longitude": 71.91946},
        {"id": 70, "name": "Govt Degree College Khanewal Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج خانیوال ریلیف کیمپ", "address": "Khanewal", "capacity": 200, "contact": "", "latitude": 30.26293, "longitude": 71.95875},
        {"id": 71, "name": "Muzaffargarh Sports Complex Relief Camp", "name_ur": "مظفر گڑھ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Muzaffargarh", "capacity": 200, "contact": "", "latitude": 30.06678, "longitude": 71.20773},
        {"id": 72, "name": "Govt Degree College Muzaffargarh Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج مظفر گڑھ ریلیف کیمپ", "address": "Muzaffargarh", "capacity": 100, "contact": "", "latitude": 30.05872, "longitude": 71.1978},
        {"id": 73, "name": "Abbottabad Sports Complex Relief Camp", "name_ur": "ایبٹ آباد سپورٹس کمپلیکس ریلیف کیمپ", "address": "Abbottabad", "capacity": 150, "contact": "", "latitude": 34.13408, "longitude": 73.1987},
        {"id": 74, "name": "Govt Degree College Abbottabad Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج ایبٹ آباد ریلیف کیمپ", "address": "Abbottabad", "capacity": 200, "contact": "", "latitude": 34.16108, "longitude": 73.2214},
        {"id": 75, "name": "Muridke Sports Complex Relief Camp", "name_ur": "مریدکے سپورٹس کمپلیکس ریلیف کیمپ", "address": "Muridke", "capacity": 200, "contact": "", "latitude": 31.79372, "longitude": 74.25837},
        {"id": 76, "name": "Govt Degree College Muridke Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج مریدکے ریلیف کیمپ", "address": "Muridke", "capacity": 150, "contact": "", "latitude": 31.76552, "longitude": 74.2744},
        {"id": 77, "name": "Bahawalnagar Sports Complex Relief Camp", "name_ur": "بہاولنگر سپورٹس کمپلیکس ریلیف کیمپ", "address": "Bahawalnagar", "capacity": 250, "contact": "", "latitude": 30.00321, "longitude": 73.24281},
        {"id": 78, "name": "Govt Degree College Bahawalnagar Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج بہاولنگر ریلیف کیمپ", "address": "Bahawalnagar", "capacity": 200, "contact": "", "latitude": 29.96412, "longitude": 73.27495},
        {"id": 79, "name": "Khairpur Sports Complex Relief Camp", "name_ur": "خیرپور سپورٹس کمپلیکس ریلیف کیمپ", "address": "Khairpur", "capacity": 250, "contact": "", "latitude": 27.55594, "longitude": 68.77299},
        {"id": 80, "name": "Govt Degree College Khairpur Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج خیرپور ریلیف کیمپ", "address": "Khairpur", "capacity": 150, "contact": "", "latitude": 27.54856, "longitude": 68.74623},
        {"id": 81, "name": "Turbat Sports Complex Relief Camp", "name_ur": "تربت سپورٹس کمپلیکس ریلیف کیمپ", "address": "Turbat", "capacity": 150, "contact": "", "latitude": 26.01865, "longitude": 63.04004},
        {"id": 82, "name": "Govt Degree College Turbat Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج تربت ریلیف کیمپ", "address": "Turbat", "capacity": 150, "contact": "", "latitude": 25.96078, "longitude": 63.02107},
        {"id": 83, "name": "Dadu Sports Complex Relief Camp", "name_ur": "دادو سپورٹس کمپلیکس ریلیف کیمپ", "address": "Dadu", "capacity": 150, "contact": "", "latitude": 26.75045, "longitude": 67.77262},
        {"id": 84, "name": "Govt Degree College Dadu Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج دادو ریلیف کیمپ", "address": "Dadu", "capacity": 250, "contact": "", "latitude": 26.70008, "longitude": 67.78546},
        {"id": 85, "name": "Chaman Sports Complex Relief Camp", "name_ur": "چمن سپورٹس کمپلیکس ریلیف کیمپ", "address": "Chaman", "capacity": 250, "contact": "", "latitude": 30.8957, "longitude": 66.46882},
        {"id": 86, "name": "Govt Degree College Chaman Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج چمن ریلیف کیمپ", "address": "Chaman", "capacity": 250, "contact": "", "latitude": 30.86703, "longitude": 66.44465},
        {"id": 87, "name": "Charsadda Sports Complex Relief Camp", "name_ur": "چارسدہ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Charsadda", "capacity": 200, "contact": "", "latitude": 34.1905, "longitude": 71.75174},
        {"id": 88, "name": "Govt Degree College Charsadda Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج چارسدہ ریلیف کیمپ", "address": "Charsadda", "capacity": 250, "contact": "", "latitude": 34.18967, "longitude": 71.74287},
        {"id": 89, "name": "Nowshera Sports Complex Relief Camp", "name_ur": "نوشہرہ سپورٹس کمپلیکس ریلیف کیمپ", "address": "Nowshera", "capacity": 150, "contact": "", "latitude": 34.04559, "longitude": 71.96832},
        {"id": 90, "name": "Govt Degree College Nowshera Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج نوشہرہ ریلیف کیمپ", "address": "Nowshera", "capacity": 250, "contact": "", "latitude": 34.03021, "longitude": 71.96148},
        {"id": 91, "name": "Swabi Sports Complex Relief Camp", "name_ur": "صوابی سپورٹس کمپلیکس ریلیف کیمپ", "address": "Swabi", "capacity": 100, "contact": "", "latitude": 34.08745, "longitude": 72.46194},
        {"id": 92, "name": "Govt Degree College Swabi Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج صوابی ریلیف کیمپ", "address": "Swabi", "capacity": 150, "contact": "", "latitude": 34.14477, "longitude": 72.44385},
        {"id": 93, "name": "Bannu Sports Complex Relief Camp", "name_ur": "بنوں سپورٹس کمپلیکس ریلیف کیمپ", "address": "Bannu", "capacity": 250, "contact": "", "latitude": 32.97805, "longitude": 70.61109},
        {"id": 94, "name": "Govt Degree College Bannu Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج بنوں ریلیف کیمپ", "address": "Bannu", "capacity": 100, "contact": "", "latitude": 33.03081, "longitude": 70.61894},
        {"id": 95, "name": "Dera Ismail Khan Sports Complex Relief Camp", "name_ur": "ڈیرہ اسماعیل خان سپورٹس کمپلیکس ریلیف کیمپ", "address": "Dera Ismail Khan", "capacity": 250, "contact": "", "latitude": 31.83444, "longitude": 70.90804},
        {"id": 96, "name": "Govt Degree College Dera Ismail Khan Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج ڈیرہ اسماعیل خان ریلیف کیمپ", "address": "Dera Ismail Khan", "capacity": 150, "contact": "", "latitude": 31.82959, "longitude": 70.88738},
        {"id": 97, "name": "Muzaffarabad Sports Complex Relief Camp", "name_ur": "مظفرآباد سپورٹس کمپلیکس ریلیف کیمپ", "address": "Muzaffarabad", "capacity": 150, "contact": "", "latitude": 34.40065, "longitude": 73.48259},
        {"id": 98, "name": "Govt Degree College Muzaffarabad Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج مظفرآباد ریلیف کیمپ", "address": "Muzaffarabad", "capacity": 100, "contact": "", "latitude": 34.41883, "longitude": 73.47551},
        {"id": 99, "name": "Mirpur Sports Complex Relief Camp", "name_ur": "میرپور سپورٹس کمپلیکس ریلیف کیمپ", "address": "Mirpur", "capacity": 150, "contact": "", "latitude": 33.10733, "longitude": 73.74717},
        {"id": 100, "name": "Govt Degree College Mirpur Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج میرپور ریلیف کیمپ", "address": "Mirpur", "capacity": 150, "contact": "", "latitude": 33.14236, "longitude": 73.74105},
        {"id": 101, "name": "Gilgit Sports Complex Relief Camp", "name_ur": "گلگت سپورٹس کمپلیکس ریلیف کیمپ", "address": "Gilgit", "capacity": 250, "contact": "", "latitude": 35.8985, "longitude": 74.30186},
        {"id": 102, "name": "Govt Degree College Gilgit Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج گلگت ریلیف کیمپ", "address": "Gilgit", "capacity": 100, "contact": "", "latitude": 35.95068, "longitude": 74.28753},
        {"id": 103, "name": "Skardu Sports Complex Relief Camp", "name_ur": "سکردو سپورٹس کمپلیکس ریلیف کیمپ", "address": "Skardu", "capacity": 100, "contact": "", "latitude": 35.32241, "longitude": 75.63785},
        {"id": 104, "name": "Govt Degree College Skardu Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج سکردو ریلیف کیمپ", "address": "Skardu", "capacity": 100, "contact": "", "latitude": 35.35105, "longitude": 75.61526},
        {"id": 105, "name": "Gwadar Sports Complex Relief Camp", "name_ur": "گوادر سپورٹس کمپلیکس ریلیف کیمپ", "address": "Gwadar", "capacity": 150, "contact": "", "latitude": 25.12402, "longitude": 62.31093},
        {"id": 106, "name": "Govt Degree College Gwadar Relief Camp", "name_ur": "گورنمنٹ ڈگری کالج گوادر ریلیف کیمپ", "address": "Gwadar", "capacity": 150, "contact": "", "latitude": 25.1222, "longitude": 62.30787},
    ])
    MEMORY_HOSPITALS.extend([
        {"id": 1, "name": "Jinnah Postgraduate Medical Centre", "name_ur": "جناح پوسٹ گریجویٹ میڈیکل سینٹر", "address": "Karachi", "contact": "", "services": "Emergency", "latitude": 24.86488, "longitude": 66.9156},
        {"id": 2, "name": "Civil Hospital Karachi", "name_ur": "سول ہسپتال کراچی", "address": "Karachi", "contact": "", "services": "Emergency", "latitude": 24.8472, "longitude": 66.94297},
        {"id": 3, "name": "Aga Khan University Hospital", "name_ur": "آغا خان یونیورسٹی ہسپتال", "address": "Karachi", "contact": "", "services": "Emergency", "latitude": 24.88198, "longitude": 67.04351},
        {"id": 4, "name": "Mayo Hospital", "name_ur": "میو ہسپتال", "address": "Lahore", "contact": "", "services": "Emergency", "latitude": 31.5062, "longitude": 74.30449},
        {"id": 5, "name": "Jinnah Hospital Lahore", "name_ur": "جناح ہسپتال لاہور", "address": "Lahore", "contact": "", "services": "Emergency", "latitude": 31.52939, "longitude": 74.36814},
        {"id": 6, "name": "Services Hospital Lahore", "name_ur": "سروسز ہسپتال لاہور", "address": "Lahore", "contact": "", "services": "Emergency", "latitude": 31.49524, "longitude": 74.38012},
        {"id": 7, "name": "Allied Hospital Faisalabad", "name_ur": "الائیڈ ہسپتال فیصل آباد", "address": "Faisalabad", "contact": "", "services": "Emergency", "latitude": 31.46412, "longitude": 73.10559},
        {"id": 8, "name": "DHQ Hospital Faisalabad", "name_ur": "ڈی ایچ کیو ہسپتال فیصل آباد", "address": "Faisalabad", "contact": "", "services": "Emergency", "latitude": 31.42596, "longitude": 73.05031},
        {"id": 9, "name": "Benazir Bhutto Hospital", "name_ur": "بے نظیر بھٹو ہسپتال", "address": "Rawalpindi", "contact": "", "services": "Emergency", "latitude": 33.56146, "longitude": 73.02627},
        {"id": 10, "name": "Holy Family Hospital", "name_ur": "ہولی فیملی ہسپتال", "address": "Rawalpindi", "contact": "", "services": "Emergency", "latitude": 33.58486, "longitude": 73.04179},
        {"id": 11, "name": "DHQ Hospital Rawalpindi", "name_ur": "ڈی ایچ کیو ہسپتال راولپنڈی", "address": "Rawalpindi", "contact": "", "services": "Emergency", "latitude": 33.59765, "longitude": 73.03546},
        {"id": 12, "name": "Nishtar Hospital Multan", "name_ur": "نشتر ہسپتال ملتان", "address": "Multan", "contact": "", "services": "Emergency", "latitude": 30.16849, "longitude": 71.50332},
        {"id": 13, "name": "DHQ Hospital Multan", "name_ur": "ڈی ایچ کیو ہسپتال ملتان", "address": "Multan", "contact": "", "services": "Emergency", "latitude": 30.1547, "longitude": 71.59506},
        {"id": 14, "name": "Liaquat University Hospital", "name_ur": "لیاقت یونیورسٹی ہسپتال", "address": "Hyderabad", "contact": "", "services": "Emergency", "latitude": 25.38314, "longitude": 68.3821},
        {"id": 15, "name": "Civil Hospital Hyderabad", "name_ur": "سول ہسپتال حیدرآباد", "address": "Hyderabad", "contact": "", "services": "Emergency", "latitude": 25.39805, "longitude": 68.30421},
        {"id": 16, "name": "DHQ Hospital Gujranwala", "name_ur": "ڈی ایچ کیو ہسپتال گوجرانوالہ", "address": "Gujranwala", "contact": "", "services": "Emergency", "latitude": 32.19598, "longitude": 74.14573},
        {"id": 17, "name": "Aziz Bhatti Shaheed Teaching Hospital", "name_ur": "عزیز بھٹی شہید ٹیچنگ ہسپتال", "address": "Gujranwala", "contact": "", "services": "Emergency", "latitude": 32.15963, "longitude": 74.15575},
        {"id": 18, "name": "Lady Reading Hospital", "name_ur": "لیڈی ریڈنگ ہسپتال", "address": "Peshawar", "contact": "", "services": "Emergency", "latitude": 34.02664, "longitude": 71.55061},
        {"id": 19, "name": "Khyber Teaching Hospital", "name_ur": "خیبر ٹیچنگ ہسپتال", "address": "Peshawar", "contact": "", "services": "Emergency", "latitude": 33.99367, "longitude": 71.44922},
        {"id": 20, "name": "Sandeman Provincial Hospital", "name_ur": "سنڈیمن پرووِنشل ہسپتال", "address": "Quetta", "contact": "", "services": "Emergency", "latitude": 30.16895, "longitude": 66.97383},
        {"id": 21, "name": "Bolan Medical Complex Hospital", "name_ur": "بولان میڈیکل کمپلیکس ہسپتال", "address": "Quetta", "contact": "", "services": "Emergency", "latitude": 30.19515, "longitude": 67.05083},
        {"id": 22, "name": "Pakistan Institute of Medical Sciences (PIMS)", "name_ur": "پاکستان انسٹی ٹیوٹ آف میڈیکل سائنسز (پمز)", "address": "Islamabad", "contact": "", "services": "Emergency", "latitude": 33.68728, "longitude": 73.04215},
        {"id": 23, "name": "Shifa International Hospital", "name_ur": "شفاء انٹرنیشنل ہسپتال", "address": "Islamabad", "contact": "", "services": "Emergency", "latitude": 33.66948, "longitude": 73.05908},
        {"id": 24, "name": "Polyclinic Hospital", "name_ur": "پولی کلینک ہسپتال", "address": "Islamabad", "contact": "", "services": "Emergency", "latitude": 33.72422, "longitude": 73.09117},
        {"id": 25, "name": "Allama Iqbal Memorial Hospital", "name_ur": "علامہ اقبال میموریل ہسپتال", "address": "Sialkot", "contact": "", "services": "Emergency", "latitude": 32.48831, "longitude": 74.46137},
        {"id": 26, "name": "DHQ Hospital Sialkot", "name_ur": "ڈی ایچ کیو ہسپتال سیالکوٹ", "address": "Sialkot", "contact": "", "services": "Emergency", "latitude": 32.46469, "longitude": 74.56954},
        {"id": 27, "name": "DHQ Hospital Sargodha", "name_ur": "ڈی ایچ کیو ہسپتال سرگودھا", "address": "Sargodha", "contact": "", "services": "Emergency", "latitude": 32.08777, "longitude": 72.69071},
        {"id": 28, "name": "Sargodha Medical College Hospital", "name_ur": "سرگودھا میڈیکل کالج ہسپتال", "address": "Sargodha", "contact": "", "services": "Emergency", "latitude": 32.06277, "longitude": 72.72623},
        {"id": 29, "name": "Bahawal Victoria Hospital", "name_ur": "بہاول وکٹوریہ ہسپتال", "address": "Bahawalpur", "contact": "", "services": "Emergency", "latitude": 29.40555, "longitude": 71.64895},
        {"id": 30, "name": "DHQ Hospital Bahawalpur", "name_ur": "ڈی ایچ کیو ہسپتال بہاولپور", "address": "Bahawalpur", "contact": "", "services": "Emergency", "latitude": 29.36908, "longitude": 71.76298},
        {"id": 31, "name": "Ghulam Muhammad Mahar Medical College Hospital", "name_ur": "غلام محمد مہر میڈیکل کالج ہسپتال", "address": "Sukkur", "contact": "", "services": "Emergency", "latitude": 27.69397, "longitude": 68.88616},
        {"id": 32, "name": "Civil Hospital Sukkur", "name_ur": "سول ہسپتال سکھر", "address": "Sukkur", "contact": "", "services": "Emergency", "latitude": 27.73201, "longitude": 68.78708},
        {"id": 33, "name": "Chandka Medical College Hospital", "name_ur": "چانڈکا میڈیکل کالج ہسپتال", "address": "Larkana", "contact": "", "services": "Emergency", "latitude": 27.56415, "longitude": 68.18952},
        {"id": 34, "name": "DHQ Hospital Sheikhupura", "name_ur": "ڈی ایچ کیو ہسپتال شیخوپورہ", "address": "Sheikhupura", "contact": "", "services": "Emergency", "latitude": 31.71935, "longitude": 73.89629},
        {"id": 35, "name": "THQ Hospital Sheikhupura", "name_ur": "ٹی ایچ کیو ہسپتال شیخوپورہ", "address": "Sheikhupura", "contact": "", "services": "Emergency", "latitude": 31.72917, "longitude": 73.89236},
        {"id": 36, "name": "DHQ Hospital Jhang", "name_ur": "ڈی ایچ کیو ہسپتال جھنگ", "address": "Jhang", "contact": "", "services": "Emergency", "latitude": 31.26996, "longitude": 72.32516},
        {"id": 37, "name": "THQ Hospital Jhang", "name_ur": "ٹی ایچ کیو ہسپتال جھنگ", "address": "Jhang", "contact": "", "services": "Emergency", "latitude": 31.2838, "longitude": 72.3984},
        {"id": 38, "name": "DHQ Hospital Rahim Yar Khan", "name_ur": "ڈی ایچ کیو ہسپتال رحیم یار خان", "address": "Rahim Yar Khan", "contact": "", "services": "Emergency", "latitude": 28.41813, "longitude": 70.28144},
        {"id": 39, "name": "THQ Hospital Rahim Yar Khan", "name_ur": "ٹی ایچ کیو ہسپتال رحیم یار خان", "address": "Rahim Yar Khan", "contact": "", "services": "Emergency", "latitude": 28.41822, "longitude": 70.34331},
        {"id": 40, "name": "DHQ Hospital Gujrat", "name_ur": "ڈی ایچ کیو ہسپتال گجرات", "address": "Gujrat", "contact": "", "services": "Emergency", "latitude": 32.57156, "longitude": 74.06484},
        {"id": 41, "name": "THQ Hospital Gujrat", "name_ur": "ٹی ایچ کیو ہسپتال گجرات", "address": "Gujrat", "contact": "", "services": "Emergency", "latitude": 32.55981, "longitude": 74.02636},
        {"id": 42, "name": "Mardan Medical Complex", "name_ur": "مردان میڈیکل کمپلیکس", "address": "Mardan", "contact": "", "services": "Emergency", "latitude": 34.20898, "longitude": 72.12482},
        {"id": 43, "name": "DHQ Hospital Kasur", "name_ur": "ڈی ایچ کیو ہسپتال قصور", "address": "Kasur", "contact": "", "services": "Emergency", "latitude": 31.10794, "longitude": 74.35709},
        {"id": 44, "name": "THQ Hospital Kasur", "name_ur": "ٹی ایچ کیو ہسپتال قصور", "address": "Kasur", "contact": "", "services": "Emergency", "latitude": 31.11143, "longitude": 74.53627},
        {"id": 45, "name": "DHQ Hospital Okara", "name_ur": "ڈی ایچ کیو ہسپتال اوکاڑہ", "address": "Okara", "contact": "", "services": "Emergency", "latitude": 30.82216, "longitude": 73.45955},
        {"id": 46, "name": "THQ Hospital Okara", "name_ur": "ٹی ایچ کیو ہسپتال اوکاڑہ", "address": "Okara", "contact": "", "services": "Emergency", "latitude": 30.81063, "longitude": 73.49737},
        {"id": 47, "name": "DHQ Hospital Sahiwal", "name_ur": "ڈی ایچ کیو ہسپتال ساہیوال", "address": "Sahiwal", "contact": "", "services": "Emergency", "latitude": 30.67874, "longitude": 73.03373},
        {"id": 48, "name": "THQ Hospital Sahiwal", "name_ur": "ٹی ایچ کیو ہسپتال ساہیوال", "address": "Sahiwal", "contact": "", "services": "Emergency", "latitude": 30.64228, "longitude": 73.18738},
        {"id": 49, "name": "DHQ Hospital Nawabshah", "name_ur": "ڈی ایچ کیو ہسپتال نوابشاہ", "address": "Nawabshah", "contact": "", "services": "Emergency", "latitude": 26.23166, "longitude": 68.43833},
        {"id": 50, "name": "THQ Hospital Nawabshah", "name_ur": "ٹی ایچ کیو ہسپتال نوابشاہ", "address": "Nawabshah", "contact": "", "services": "Emergency", "latitude": 26.24811, "longitude": 68.37144},
        {"id": 51, "name": "DHQ Hospital Mingora", "name_ur": "ڈی ایچ کیو ہسپتال مینگورہ", "address": "Mingora", "contact": "", "services": "Emergency", "latitude": 34.77607, "longitude": 72.3527},
        {"id": 52, "name": "THQ Hospital Mingora", "name_ur": "ٹی ایچ کیو ہسپتال مینگورہ", "address": "Mingora", "contact": "", "services": "Emergency", "latitude": 34.79744, "longitude": 72.4519},
        {"id": 53, "name": "DHQ Hospital Dera Ghazi Khan", "name_ur": "ڈی ایچ کیو ہسپتال ڈیرہ غازی خان", "address": "Dera Ghazi Khan", "contact": "", "services": "Emergency", "latitude": 30.04906, "longitude": 70.71249},
        {"id": 54, "name": "DHQ Hospital Mirpur Khas", "name_ur": "ڈی ایچ کیو ہسپتال میرپورخاص", "address": "Mirpur Khas", "contact": "", "services": "Emergency", "latitude": 25.52088, "longitude": 69.09779},
        {"id": 55, "name": "THQ Hospital Mirpur Khas", "name_ur": "ٹی ایچ کیو ہسپتال میرپورخاص", "address": "Mirpur Khas", "contact": "", "services": "Emergency", "latitude": 25.54523, "longitude": 69.01678},
        {"id": 56, "name": "DHQ Hospital Chiniot", "name_ur": "ڈی ایچ کیو ہسپتال چنیوٹ", "address": "Chiniot", "contact": "", "services": "Emergency", "latitude": 31.72727, "longitude": 72.91608},
        {"id": 57, "name": "THQ Hospital Chiniot", "name_ur": "ٹی ایچ کیو ہسپتال چنیوٹ", "address": "Chiniot", "contact": "", "services": "Emergency", "latitude": 31.70691, "longitude": 72.91733},
        {"id": 58, "name": "DHQ Hospital Kamoke", "name_ur": "ڈی ایچ کیو ہسپتال کاموکی", "address": "Kamoke", "contact": "", "services": "Emergency", "latitude": 32.11114, "longitude": 74.14544},
        {"id": 59, "name": "THQ Hospital Kamoke", "name_ur": "ٹی ایچ کیو ہسپتال کاموکی", "address": "Kamoke", "contact": "", "services": "Emergency", "latitude": 32.10696, "longitude": 74.29546},
        {"id": 60, "name": "DHQ Hospital Mandi Bahauddin", "name_ur": "ڈی ایچ کیو ہسپتال منڈی بہاؤالدین", "address": "Mandi Bahauddin", "contact": "", "services": "Emergency", "latitude": 32.59207, "longitude": 73.50266},
        {"id": 61, "name": "THQ Hospital Mandi Bahauddin", "name_ur": "ٹی ایچ کیو ہسپتال منڈی بہاؤالدین", "address": "Mandi Bahauddin", "contact": "", "services": "Emergency", "latitude": 32.56261, "longitude": 73.58516},
        {"id": 62, "name": "DHQ Hospital Jacobabad", "name_ur": "ڈی ایچ کیو ہسپتال جیکب آباد", "address": "Jacobabad", "contact": "", "services": "Emergency", "latitude": 28.27284, "longitude": 68.51606},
        {"id": 63, "name": "THQ Hospital Jacobabad", "name_ur": "ٹی ایچ کیو ہسپتال جیکب آباد", "address": "Jacobabad", "contact": "", "services": "Emergency", "latitude": 28.30523, "longitude": 68.34148},
        {"id": 64, "name": "DHQ Hospital Jhelum", "name_ur": "ڈی ایچ کیو ہسپتال جہلم", "address": "Jhelum", "contact": "", "services": "Emergency", "latitude": 32.95374, "longitude": 73.81099},
        {"id": 65, "name": "THQ Hospital Jhelum", "name_ur": "ٹی ایچ کیو ہسپتال جہلم", "address": "Jhelum", "contact": "", "services": "Emergency", "latitude": 32.95747, "longitude": 73.81511},
        {"id": 66, "name": "DHQ Hospital Kohat", "name_ur": "ڈی ایچ کیو ہسپتال کوہاٹ", "address": "Kohat", "contact": "", "services": "Emergency", "latitude": 33.5971, "longitude": 71.40979},
        {"id": 67, "name": "THQ Hospital Kohat", "name_ur": "ٹی ایچ کیو ہسپتال کوہاٹ", "address": "Kohat", "contact": "", "services": "Emergency", "latitude": 33.61585, "longitude": 71.50347},
        {"id": 68, "name": "DHQ Hospital Shikarpur", "name_ur": "ڈی ایچ کیو ہسپتال شکارپور", "address": "Shikarpur", "contact": "", "services": "Emergency", "latitude": 27.95472, "longitude": 68.58412},
        {"id": 69, "name": "THQ Hospital Shikarpur", "name_ur": "ٹی ایچ کیو ہسپتال شکارپور", "address": "Shikarpur", "contact": "", "services": "Emergency", "latitude": 27.98071, "longitude": 68.60663},
        {"id": 70, "name": "DHQ Hospital Khanewal", "name_ur": "ڈی ایچ کیو ہسپتال خانیوال", "address": "Khanewal", "contact": "", "services": "Emergency", "latitude": 30.31551, "longitude": 71.89124},
        {"id": 71, "name": "THQ Hospital Khanewal", "name_ur": "ٹی ایچ کیو ہسپتال خانیوال", "address": "Khanewal", "contact": "", "services": "Emergency", "latitude": 30.30999, "longitude": 71.90993},
        {"id": 72, "name": "DHQ Hospital Muzaffargarh", "name_ur": "ڈی ایچ کیو ہسپتال مظفر گڑھ", "address": "Muzaffargarh", "contact": "", "services": "Emergency", "latitude": 30.06546, "longitude": 71.12271},
        {"id": 73, "name": "THQ Hospital Muzaffargarh", "name_ur": "ٹی ایچ کیو ہسپتال مظفر گڑھ", "address": "Muzaffargarh", "contact": "", "services": "Emergency", "latitude": 30.06857, "longitude": 71.24119},
        {"id": 74, "name": "Ayub Teaching Hospital", "name_ur": "ایوب ٹیچنگ ہسپتال", "address": "Abbottabad", "contact": "", "services": "Emergency", "latitude": 34.13894, "longitude": 73.24918},
        {"id": 75, "name": "DHQ Hospital Abbottabad", "name_ur": "ڈی ایچ کیو ہسپتال ایبٹ آباد", "address": "Abbottabad", "contact": "", "services": "Emergency", "latitude": 34.1164, "longitude": 73.30097},
        {"id": 76, "name": "DHQ Hospital Muridke", "name_ur": "ڈی ایچ کیو ہسپتال مریدکے", "address": "Muridke", "contact": "", "services": "Emergency", "latitude": 31.79124, "longitude": 74.33651},
        {"id": 77, "name": "THQ Hospital Muridke", "name_ur": "ٹی ایچ کیو ہسپتال مریدکے", "address": "Muridke", "contact": "", "services": "Emergency", "latitude": 31.80293, "longitude": 74.29955},
        {"id": 78, "name": "DHQ Hospital Bahawalnagar", "name_ur": "ڈی ایچ کیو ہسپتال بہاولنگر", "address": "Bahawalnagar", "contact": "", "services": "Emergency", "latitude": 29.99527, "longitude": 73.30246},
        {"id": 79, "name": "THQ Hospital Bahawalnagar", "name_ur": "ٹی ایچ کیو ہسپتال بہاولنگر", "address": "Bahawalnagar", "contact": "", "services": "Emergency", "latitude": 29.97934, "longitude": 73.27231},
        {"id": 80, "name": "DHQ Hospital Khairpur", "name_ur": "ڈی ایچ کیو ہسپتال خیرپور", "address": "Khairpur", "contact": "", "services": "Emergency", "latitude": 27.5327, "longitude": 68.7272},
        {"id": 81, "name": "THQ Hospital Khairpur", "name_ur": "ٹی ایچ کیو ہسپتال خیرپور", "address": "Khairpur", "contact": "", "services": "Emergency", "latitude": 27.52601, "longitude": 68.79608},
        {"id": 82, "name": "DHQ Hospital Turbat", "name_ur": "ڈی ایچ کیو ہسپتال تربت", "address": "Turbat", "contact": "", "services": "Emergency", "latitude": 26.00802, "longitude": 63.06977},
        {"id": 83, "name": "THQ Hospital Turbat", "name_ur": "ٹی ایچ کیو ہسپتال تربت", "address": "Turbat", "contact": "", "services": "Emergency", "latitude": 25.9787, "longitude": 63.14322},
        {"id": 84, "name": "DHQ Hospital Dadu", "name_ur": "ڈی ایچ کیو ہسپتال دادو", "address": "Dadu", "contact": "", "services": "Emergency", "latitude": 26.74532, "longitude": 67.79613},
        {"id": 85, "name": "THQ Hospital Dadu", "name_ur": "ٹی ایچ کیو ہسپتال دادو", "address": "Dadu", "contact": "", "services": "Emergency", "latitude": 26.74691, "longitude": 67.76674},
        {"id": 86, "name": "DHQ Hospital Chaman", "name_ur": "ڈی ایچ کیو ہسپتال چمن", "address": "Chaman", "contact": "", "services": "Emergency", "latitude": 30.90617, "longitude": 66.50487},
        {"id": 87, "name": "THQ Hospital Chaman", "name_ur": "ٹی ایچ کیو ہسپتال چمن", "address": "Chaman", "contact": "", "services": "Emergency", "latitude": 30.9372, "longitude": 66.37708},
        {"id": 88, "name": "DHQ Hospital Charsadda", "name_ur": "ڈی ایچ کیو ہسپتال چارسدہ", "address": "Charsadda", "contact": "", "services": "Emergency", "latitude": 34.16045, "longitude": 71.73216},
        {"id": 89, "name": "THQ Hospital Charsadda", "name_ur": "ٹی ایچ کیو ہسپتال چارسدہ", "address": "Charsadda", "contact": "", "services": "Emergency", "latitude": 34.16808, "longitude": 71.77519},
        {"id": 90, "name": "DHQ Hospital Nowshera", "name_ur": "ڈی ایچ کیو ہسپتال نوشہرہ", "address": "Nowshera", "contact": "", "services": "Emergency", "latitude": 34.02692, "longitude": 72.01886},
        {"id": 91, "name": "THQ Hospital Nowshera", "name_ur": "ٹی ایچ کیو ہسپتال نوشہرہ", "address": "Nowshera", "contact": "", "services": "Emergency", "latitude": 34.01348, "longitude": 71.92443},
        {"id": 92, "name": "DHQ Hospital Swabi", "name_ur": "ڈی ایچ کیو ہسپتال صوابی", "address": "Swabi", "contact": "", "services": "Emergency", "latitude": 34.10732, "longitude": 72.43143},
        {"id": 93, "name": "THQ Hospital Swabi", "name_ur": "ٹی ایچ کیو ہسپتال صوابی", "address": "Swabi", "contact": "", "services": "Emergency", "latitude": 34.1063, "longitude": 72.43214},
        {"id": 94, "name": "DHQ Hospital Bannu", "name_ur": "ڈی ایچ کیو ہسپتال بنوں", "address": "Bannu", "contact": "", "services": "Emergency", "latitude": 32.98523, "longitude": 70.61067},
        {"id": 95, "name": "THQ Hospital Bannu", "name_ur": "ٹی ایچ کیو ہسپتال بنوں", "address": "Bannu", "contact": "", "services": "Emergency", "latitude": 32.98295, "longitude": 70.54144},
        {"id": 96, "name": "DHQ Hospital Dera Ismail Khan", "name_ur": "ڈی ایچ کیو ہسپتال ڈیرہ اسماعیل خان", "address": "Dera Ismail Khan", "contact": "", "services": "Emergency", "latitude": 31.82741, "longitude": 70.81206},
        {"id": 97, "name": "THQ Hospital Dera Ismail Khan", "name_ur": "ٹی ایچ کیو ہسپتال ڈیرہ اسماعیل خان", "address": "Dera Ismail Khan", "contact": "", "services": "Emergency", "latitude": 31.82211, "longitude": 70.95423},
        {"id": 98, "name": "Combined Military Hospital Muzaffarabad", "name_ur": "کمبائنڈ ملٹری ہسپتال مظفرآباد", "address": "Muzaffarabad", "contact": "", "services": "Emergency", "latitude": 34.36957, "longitude": 73.44999},
        {"id": 99, "name": "Abbas Institute of Medical Sciences", "name_ur": "عباس انسٹی ٹیوٹ آف میڈیکل سائنسز", "address": "Muzaffarabad", "contact": "", "services": "Emergency", "latitude": 34.38013, "longitude": 73.53261},
        {"id": 100, "name": "DHQ Hospital Mirpur", "name_ur": "ڈی ایچ کیو ہسپتال میرپور", "address": "Mirpur", "contact": "", "services": "Emergency", "latitude": 33.15269, "longitude": 73.67591},
        {"id": 101, "name": "THQ Hospital Mirpur", "name_ur": "ٹی ایچ کیو ہسپتال میرپور", "address": "Mirpur", "contact": "", "services": "Emergency", "latitude": 33.14352, "longitude": 73.82784},
        {"id": 102, "name": "DHQ Hospital Gilgit", "name_ur": "ڈی ایچ کیو ہسپتال گلگت", "address": "Gilgit", "contact": "", "services": "Emergency", "latitude": 35.93219, "longitude": 74.27449},
        {"id": 103, "name": "DHQ Hospital Skardu", "name_ur": "ڈی ایچ کیو ہسپتال سکردو", "address": "Skardu", "contact": "", "services": "Emergency", "latitude": 35.31066, "longitude": 75.58366},
        {"id": 104, "name": "Gwadar DHQ Hospital", "name_ur": "گوادر ڈی ایچ کیو ہسپتال", "address": "Gwadar", "contact": "", "services": "Emergency", "latitude": 25.11201, "longitude": 62.25993},
    ])

    # Rescue operations, community reports and blocked roads are intentionally
    # left empty — they should reflect only what real users actually submit
    # (via the Rescue Dashboard, Community page, and Admin/Rescue map tools).

    print(f"[SEED] {len(MEMORY_SHELTERS)} shelters + {len(MEMORY_HOSPITALS)} hospitals (per known city) loaded. "
          f"No dummy rescue operations, community reports, or blocked roads were added.")

seed_sample_data()

# ---------------- SYSTEM LOGS (NFR06-02) ----------------
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
    {"id": 1, "name": "Rescue Boat #1", "notes": "", "quantity": 1, "assignments": []},
    {"id": 2, "name": "Rescue Boat #2", "notes": "", "quantity": 1, "assignments": []},
    {"id": 3, "name": "Medical Kit A", "notes": "", "quantity": 4, "assignments": []},
    {"id": 4, "name": "Medical Kit B", "notes": "", "quantity": 4, "assignments": []},
    {"id": 5, "name": "4x4 Rescue Vehicle", "notes": "", "quantity": 1, "assignments": []},
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
                "INSERT INTO equipment_items (name, quantity, notes, assignments) VALUES (?, ?, ?, ?)",
                (seed["name"], seed["quantity"], seed["notes"], json.dumps(seed["assignments"]))
            )
        conn.commit()
    cursor.execute("SELECT * FROM equipment_items ORDER BY id")
    return [{
        "id": r.id, "name": r.name, "quantity": r.quantity,
        "notes": r.notes or "", "assignments": json.loads(r.assignments) if r.assignments else [],
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
    item = {"name": name, "notes": data.get("notes", ""), "quantity": quantity, "assignments": []}

    if DB_AVAILABLE:
        try:
            item["id"] = _db_insert_get_id(
                "INSERT INTO equipment_items (name, quantity, notes, assignments) VALUES (?, ?, ?, ?)",
                (item["name"], item["quantity"], item["notes"], json.dumps(item["assignments"]))
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
            "assignments": json.loads(r.assignments) if r.assignments else []}

@app.route("/equipment/<int:item_id>", methods=["PUT"])
def update_equipment(item_id):
    data = request.json or {}
    if DB_AVAILABLE:
        try:
            item = _get_equipment_row(item_id)
            if item is None:
                return jsonify({"message": "Equipment item not found"}), 404
            notes = data.get("notes", item["notes"])
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
            cursor.execute("UPDATE equipment_items SET notes = ?, quantity = ? WHERE id = ?", (notes, quantity, item_id))
            conn.commit()
            item["notes"], item["quantity"] = notes, quantity
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
    """Deploy a specific quantity of this item to one operation. Calling this
    again for an operation that's already got some of this item updates that
    operation's share (rather than adding a duplicate line)."""
    data = request.json or {}
    op_id = data.get("op_id")
    try:
        qty = int(data.get("qty", 0))
    except (TypeError, ValueError):
        qty = 0
    if not op_id or qty <= 0:
        return jsonify({"message": "op_id and a positive qty are required"}), 400

    if DB_AVAILABLE:
        try:
            item = _get_equipment_row(item_id)
            if item is None:
                return jsonify({"message": "Equipment item not found"}), 404
            other_deployed = sum(a["qty"] for a in item["assignments"] if a["op_id"] != op_id)
            if other_deployed + qty > item["quantity"]:
                available = item["quantity"] - other_deployed
                return jsonify({"message": f"Only {available} of {item['name']} available to deploy"}), 400
            op = next((o for o in MEMORY_RESCUE_OPS if o["id"] == op_id), None)
            item["assignments"] = [a for a in item["assignments"] if a["op_id"] != op_id]
            item["assignments"].append({"op_id": op_id, "qty": qty, "location": op["location"] if op else f"Operation #{op_id}"})
            cursor.execute("UPDATE equipment_items SET assignments = ? WHERE id = ?", (json.dumps(item["assignments"]), item_id))
            conn.commit()
            return jsonify(_equipment_with_derived_fields(item))
        except Exception as db_error:
            log_event("error", f"Failed to save equipment assignment to database: {db_error}")
            return jsonify({"message": "Could not save the deployment — please try again."}), 503

    for item in MEMORY_EQUIPMENT:
        if item["id"] == item_id:
            other_deployed = sum(a["qty"] for a in item["assignments"] if a["op_id"] != op_id)
            if other_deployed + qty > item["quantity"]:
                available = item["quantity"] - other_deployed
                return jsonify({"message": f"Only {available} of {item['name']} available to deploy"}), 400
            item["assignments"] = [a for a in item["assignments"] if a["op_id"] != op_id]
            op = next((o for o in MEMORY_RESCUE_OPS if o["id"] == op_id), None)
            item["assignments"].append({
                "op_id": op_id,
                "qty": qty,
                "location": op["location"] if op else f"Operation #{op_id}",
            })
            return jsonify(_equipment_with_derived_fields(item))
    return jsonify({"message": "Equipment item not found"}), 404

@app.route("/equipment/<int:item_id>/assign/<int:op_id>", methods=["DELETE"])
def unassign_equipment(item_id, op_id):
    """Free up whatever quantity of this item was deployed to the given operation."""
    if DB_AVAILABLE:
        try:
            item = _get_equipment_row(item_id)
            if item is None:
                return jsonify({"message": "Equipment item not found"}), 404
            item["assignments"] = [a for a in item["assignments"] if a["op_id"] != op_id]
            cursor.execute("UPDATE equipment_items SET assignments = ? WHERE id = ?", (json.dumps(item["assignments"]), item_id))
            conn.commit()
            return jsonify(_equipment_with_derived_fields(item))
        except Exception as db_error:
            log_event("error", f"Failed to remove equipment assignment in database: {db_error}")
            return jsonify({"message": "Could not free up the equipment — please try again."}), 503

    for item in MEMORY_EQUIPMENT:
        if item["id"] == item_id:
            item["assignments"] = [a for a in item["assignments"] if a["op_id"] != op_id]
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
        except Exception as db_error:
            log_event("error", f"Failed to save advisory to database: {db_error}")

    log_event("info", f"Public advisory issued: {title} ({advisory['region']})")
    return jsonify(advisory), 201

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
    ops = MEMORY_RESCUE_OPS
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

@app.route("/volunteers/<int:vol_id>", methods=["DELETE"])
def delete_volunteer(vol_id):
    MEMORY_VOLUNTEERS[:] = [v for v in MEMORY_VOLUNTEERS if v["id"] != vol_id]
    if DB_AVAILABLE:
        try:
            cursor.execute("DELETE FROM volunteers WHERE id = ?", (vol_id,))
            conn.commit()
        except Exception as db_error:
            log_event("error", f"Failed to delete volunteer from database: {db_error}")
    return jsonify({"message": "Volunteer removed"})

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
    return jsonify(MEMORY_DONATIONS)

@app.route("/donations", methods=["POST"])
def create_donation():
    data = request.json or {}
    donor_name = (data.get("donor_name") or "").strip()
    item = (data.get("item") or "").strip()
    if not donor_name or not item:
        return jsonify({"message": "Donor name and item are required"}), 400
    donation = {
        "id": (max([d["id"] for d in MEMORY_DONATIONS], default=0) + 1),
        "donor_name": donor_name, "contact": data.get("contact", ""),
        "item": item, "quantity": data.get("quantity", 1),
        "shelter_id": data.get("shelter_id"), "status": "Pledged",
        "created_at": str(datetime.now()),
    }
    MEMORY_DONATIONS.append(donation)
    return jsonify(donation), 201

@app.route("/donations/<int:donation_id>", methods=["PUT"])
def update_donation(donation_id):
    data = request.json or {}
    for d in MEMORY_DONATIONS:
        if d["id"] == donation_id:
            d["status"] = data.get("status", d["status"])
            return jsonify(d)
    return jsonify({"message": "Donation not found"}), 404

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

# ==================================================================
# END NEW FEATURES BATCH
# ==================================================================

# ---------------- RUN ----------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("=" * 60)
    print(f"  Flood Disaster Management System backend starting...")
    print(f"  Once ready, test it by visiting: http://127.0.0.1:{port}/health")
    print("=" * 60)
    try:
        app.run(host="0.0.0.0", port=port, debug=False)
    except OSError as e:
        print("=" * 60)
        print(f"  COULD NOT START — port {port} is already in use.")
        print(f"  Error detail: {e}")
        print(f"  Another copy of this backend (or something else) is")
        print(f"  already running on port {port}. On Windows, close it with:")
        print(f"      taskkill /F /IM python.exe")
        print(f"  then run 'python app.py' again.")
        print("=" * 60)