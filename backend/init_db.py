import os
import pyodbc
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SCHEMA_FILE = BASE_DIR.parent / "database" / "schema.sql"

CONNECTIONS = [
    r"DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=master;Trusted_Connection=yes;",
    r"DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost\SQLEXPRESS;DATABASE=master;Trusted_Connection=yes;",
    r"DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost\SQLEXPRESS01;DATABASE=master;Trusted_Connection=yes;",
]


def run_sql(cursor, sql_text):
    statements = [s.strip() for s in sql_text.split(";") if s.strip()]
    for statement in statements:
        try:
            cursor.execute(statement)
        except Exception as exc:
            print(f"Skipping statement due to error: {exc}\nSTATEMENT: {statement}")


def main():
    if not SCHEMA_FILE.exists():
        raise FileNotFoundError(f"Schema file not found: {SCHEMA_FILE}")

    for conn_str in CONNECTIONS:
        try:
            conn = pyodbc.connect(conn_str, timeout=5)
            cursor = conn.cursor()
            print(f"Connected to SQL Server using: {conn_str}")
            break
        except Exception as e:
            print(f"Could not connect using: {conn_str}\n  {e}")
            conn = None
            cursor = None
    else:
        raise RuntimeError("Could not connect to any SQL Server instance. Check your server names and SQL services.")

    cursor.execute("SELECT name FROM sys.databases WHERE name = 'flood_db'")
    if cursor.fetchone() is None:
        print("Database flood_db not found. Creating...")
        conn.autocommit = True
        cursor.execute("CREATE DATABASE flood_db")
        conn.autocommit = False
        print("Created database flood_db.")
    else:
        print("Database flood_db already exists.")

    cursor.execute("USE flood_db")
    schema_text = SCHEMA_FILE.read_text(encoding='utf-8')
    run_sql(cursor, schema_text)
    conn.commit()
    print("Schema applied to flood_db.")
    conn.close()


if __name__ == '__main__':
    main()
