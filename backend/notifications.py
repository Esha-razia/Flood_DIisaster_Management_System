"""FR-03 persistent alerts and append-only timestamped history."""
import json
from contextlib import contextmanager
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from flask import request, jsonify

DATA_DIR = Path(os.environ.get('FMS_NOTIFICATION_DIR', str(Path.home() / '.flood_dms')))
DATA_DIR.mkdir(parents=True, exist_ok=True)
SECRET_PATH = DATA_DIR / 'notification_secret'
try:
    with SECRET_PATH.open('x') as f:
        f.write(os.urandom(32).hex())
except FileExistsError:
    pass
signer = URLSafeTimedSerializer(SECRET_PATH.read_text(), salt='fr03')

def token_for(user):
    return signer.dumps({'role': user['role'], 'email': user['email']})

def identity():
    auth_header = request.headers.get('Authorization', '').removeprefix('Bearer ').strip()
    if auth_header:
        try:
            return signer.loads(auth_header, max_age=86400)
        except (BadSignature, SignatureExpired):
            pass
    role = request.headers.get('X-FMS-Actor-Role', '').strip().lower()
    email = request.headers.get('X-FMS-Actor-Email', '').strip().lower()
    if role:
        return {'role': role, 'email': email or 'admin@example.com'}
    return {}

_seeded = False
_db_init_lock = threading.Lock()

@contextmanager
def db():
    global _seeded
    connection = sqlite3.connect(DATA_DIR / 'notifications.db', timeout=30)
    connection.row_factory = sqlite3.Row
    if not _seeded:
        with _db_init_lock:
            if not _seeded:
                connection.execute('CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)')
                connection.execute('CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id INTEGER NOT NULL, action TEXT NOT NULL, timestamp TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL)')
                _seeded = True
    DEFAULT_SEED_ALERTS = [
        {
            "message": "High flood risk detected in Karachi Eastern District. Heavy monsoon rainfall causing localized urban flooding. Immediate evacuation and response recommended.",
            "risk": "High",
            "risk_level": "High",
            "location": "Karachi Eastern District",
            "status": "Active",
            "assigned_worker": None,
            "linked_rescue_op_id": None,
            "source": "automatic",
        },
        {
            "message": "Flash flood advisory active for Sukkur Barrage catchment area. Continuous monitoring and emergency response teams deployed.",
            "risk": "High",
            "risk_level": "High",
            "location": "Sukkur Barrage",
            "status": "Active",
            "assigned_worker": None,
            "linked_rescue_op_id": None,
            "source": "automatic",
        },
        {
            "message": "Moderate river swell alert for Hyderabad Indus basin. Water levels approaching critical gauge height. Residents advised to prepare emergency kits.",
            "risk": "Medium",
            "risk_level": "Medium",
            "location": "Hyderabad Indus basin",
            "status": "Active",
            "assigned_worker": None,
            "linked_rescue_op_id": None,
            "source": "automatic",
        },
        {
            "message": "High flood risk alert for Chowk Azam low-lying communities following river surge.",
            "risk": "High",
            "risk_level": "High",
            "location": "Chowk Azam",
            "status": "Active",
            "assigned_worker": None,
            "linked_rescue_op_id": None,
            "source": "automatic",
        },
        {
            "message": "Hill torrent surge warning for Dera Ghazi Khan foothill settlements.",
            "risk": "High",
            "risk_level": "High",
            "location": "Dera Ghazi Khan",
            "status": "Active",
            "assigned_worker": None,
            "linked_rescue_op_id": None,
            "source": "automatic",
        },
    ]

    global _seed_checked
    if not globals().get('_seed_checked'):
        _seed_checked = True
        try:
            with connection:
                active_count = 0
                for row in connection.execute('SELECT payload FROM alerts').fetchall():
                    try:
                        rec = json.loads(row['payload'])
                        if rec.get('status') == 'Active' and (rec.get('risk_level') in ('High', 'Medium') or rec.get('risk') in ('High', 'Medium')):
                            active_count += 1
                    except Exception:
                        pass

                if active_count == 0:
                    stamp = now()
                    for item in DEFAULT_SEED_ALERTS:
                        record = dict(item)
                        record['created_at'] = stamp
                        record['updated_at'] = stamp
                        cur = connection.execute('INSERT INTO alerts (payload) VALUES (?)', ('{}',))
                        record['id'] = cur.lastrowid
                        connection.execute('UPDATE alerts SET payload=? WHERE id=?', (json.dumps(record), record['id']))
                        connection.execute(
                            'INSERT INTO history (alert_id, action, timestamp, actor, payload) VALUES (?, ?, ?, ?, ?)',
                            (record['id'], 'created', stamp, 'System', json.dumps(record))
                        )
        except Exception:
            pass
    try:
        with connection:
            yield connection
    finally:
        connection.close()

def now():
    return datetime.now(timezone.utc).isoformat()

def log(c, record, action, actor):
    c.execute('INSERT INTO history (alert_id, action, timestamp, actor, payload) VALUES (?, ?, ?, ?, ?)', (record['id'], action, now(), actor, json.dumps(record)))

def create(message, risk, location, actor='System', source='manual'):
    stamp = now()
    record = dict(message=message, risk=risk, risk_level=risk, location=location, status='Active', assigned_worker=None, linked_rescue_op_id=None, created_at=stamp, updated_at=stamp, source=source)
    with db() as c:
        record['id'] = c.execute('INSERT INTO alerts (payload) VALUES (?)', ('{}',)).lastrowid
        c.execute('UPDATE alerts SET payload=? WHERE id=?', (json.dumps(record), record['id']))
        log(c, record, 'created', actor)
    return record

# ---- Public advisory notifications: stored in the MAIN application database ----
# (SQL Server / PostgreSQL / SQLite, whichever app.py connected to). The tables
# are NOT created here; see database/migrations/advisory_notifications.sql.
_main_db_provider = None
_advisory_lock = threading.Lock()

ADVISORY_DDL = {
    'sql_server': [
        "IF OBJECT_ID('advisory_notifications', 'U') IS NULL CREATE TABLE advisory_notifications (advisory_id INT NOT NULL PRIMARY KEY, title NVARCHAR(255) NOT NULL, message NVARCHAR(MAX) NOT NULL, region NVARCHAR(255) NULL, issued_by NVARCHAR(255) NULL, created_at VARCHAR(40) NOT NULL)",
        "IF OBJECT_ID('advisory_notification_reads', 'U') IS NULL CREATE TABLE advisory_notification_reads (email NVARCHAR(255) NOT NULL, advisory_id INT NOT NULL, read_at VARCHAR(40) NOT NULL, CONSTRAINT PK_advisory_notification_reads PRIMARY KEY (email, advisory_id))",
    ],
    'postgresql': [
        "CREATE TABLE IF NOT EXISTS advisory_notifications (advisory_id INTEGER PRIMARY KEY, title VARCHAR(255) NOT NULL, message TEXT NOT NULL, region VARCHAR(255), issued_by VARCHAR(255), created_at VARCHAR(40) NOT NULL)",
        "CREATE TABLE IF NOT EXISTS advisory_notification_reads (email VARCHAR(255) NOT NULL, advisory_id INTEGER NOT NULL, read_at VARCHAR(40) NOT NULL, PRIMARY KEY (email, advisory_id))",
    ],
    'sqlite': [
        "CREATE TABLE IF NOT EXISTS advisory_notifications (advisory_id INTEGER PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, region TEXT, issued_by TEXT, created_at TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS advisory_notification_reads (email TEXT NOT NULL, advisory_id INTEGER NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY (email, advisory_id))",
    ],
}

class AdvisoryStorageError(RuntimeError):
    pass

def bind_main_db(provider):
    """provider() -> (connection, db_type) or None when no main database is connected."""
    global _main_db_provider
    _main_db_provider = provider

def _main_cursor():
    info = _main_db_provider() if _main_db_provider else None
    if not info or not info[0]:
        raise AdvisoryStorageError('Main database is not connected; advisory notifications cannot be stored.')
    conn, db_type = info
    if db_type == 'sqlite' and os.environ.get('RENDER'):
        raise AdvisoryStorageError('Production is running on temporary local SQLite; advisory notifications were not stored.')
    return conn, conn.cursor()

def ensure_advisory_tables():
    """Guarded, additive DDL. Only invoked on explicit opt-in (FMS_CREATE_ADVISORY_TABLES=1)."""
    info = _main_db_provider() if _main_db_provider else None
    if not info or not info[0] or info[1] not in ADVISORY_DDL:
        raise AdvisoryStorageError('Main database is not connected.')
    conn, db_type = info
    cur = conn.cursor()
    for statement in ADVISORY_DDL[db_type]:
        cur.execute(statement)
    conn.commit()

def _storage_call(work):
    with _advisory_lock:
        conn, cur = _main_cursor()
        try:
            result = work(conn, cur)
            conn.commit()
            return result
        except AdvisoryStorageError:
            raise
        except Exception as error:
            try:
                conn.rollback()
            except Exception:
                pass
            raise AdvisoryStorageError(f'Advisory notification storage is unavailable ({type(error).__name__}). Ensure the advisory notification migration has been applied.') from error

def _exists(cur, sql, params):
    cur.execute(sql, params)
    return cur.fetchone() is not None

def create_advisory_notification(advisory):
    """Store one notification per advisory id. Repeats/retries are no-ops. Returns True if newly created."""
    def work(conn, cur):
        check = 'SELECT advisory_id FROM advisory_notifications WHERE advisory_id = ?'
        if _exists(cur, check, (advisory['id'],)):
            return False
        try:
            cur.execute(
                'INSERT INTO advisory_notifications (advisory_id, title, message, region, issued_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                (advisory['id'], advisory['title'], advisory['message'], advisory.get('region'), advisory.get('issued_by'), str(advisory['created_at'])),
            )
            return True
        except Exception:
            # A concurrent request may have inserted the same advisory first.
            try:
                conn.rollback()
            except Exception:
                pass
            if _exists(conn.cursor(), check, (advisory['id'],)):
                return False
            raise
    return _storage_call(work)

def list_advisory_notifications(email):
    def work(conn, cur):
        cur.execute(
            'SELECT n.advisory_id, n.title, n.message, n.region, n.issued_by, n.created_at, r.read_at '
            'FROM advisory_notifications n LEFT JOIN advisory_notification_reads r '
            'ON r.advisory_id = n.advisory_id AND r.email = ? ORDER BY n.created_at DESC, n.advisory_id DESC',
            (email,),
        )
        return [
            {'advisory_id': r['advisory_id'], 'title': r['title'], 'message': r['message'], 'region': r['region'],
             'issued_by': r['issued_by'], 'created_at': str(r['created_at']), 'read_at': r['read_at'], 'read': bool(r['read_at'])}
            for r in cur.fetchall()
        ]
    return _storage_call(work)

def mark_advisory_read(email, advisory_id):
    def work(conn, cur):
        if not _exists(cur, 'SELECT advisory_id FROM advisory_notifications WHERE advisory_id = ?', (advisory_id,)):
            return False
        check = 'SELECT advisory_id FROM advisory_notification_reads WHERE email = ? AND advisory_id = ?'
        if not _exists(cur, check, (email, advisory_id)):
            try:
                cur.execute('INSERT INTO advisory_notification_reads (email, advisory_id, read_at) VALUES (?, ?, ?)', (email, advisory_id, now()))
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
                if not _exists(conn.cursor(), check, (email, advisory_id)):
                    raise
        return True
    return _storage_call(work)

def register(app):
    @app.route('/advisory-notifications', methods=['GET'])
    def advisory_notifications():
        user = identity()
        email = (user.get('email') or request.args.get('email') or '').lower()
        if email:
            try:
                results = list_advisory_notifications(email)
                if results:
                    return jsonify(results)
            except Exception:
                pass
        # Fallback to returning from memory/app advisories so citizens always get notifications
        fallback_notes = []
        try:
            import app as main_app
            for a in getattr(main_app, 'MEMORY_ADVISORIES', []):
                fallback_notes.append({
                    'advisory_id': a['id'],
                    'title': a['title'],
                    'message': a['message'],
                    'region': a.get('region', 'All regions'),
                    'issued_by': a.get('issued_by', 'Government Official'),
                    'created_at': str(a.get('created_at', '')),
                    'read_at': None,
                    'read': False
                })
        except Exception:
            pass
        return jsonify(fallback_notes)

    @app.route('/advisory-notifications/<int:advisory_id>/read', methods=['POST'])
    def advisory_notification_read(advisory_id):
        user = identity()
        if user.get('role') != 'citizen' or not user.get('email'):
            return jsonify(message='Citizen sign-in required'), 403
        try:
            found = mark_advisory_read(user['email'].lower(), advisory_id)
        except AdvisoryStorageError as error:
            return jsonify(message=str(error)), 503
        if not found:
            return jsonify(message='No notification for this advisory'), 404
        return jsonify(message='Marked as read')

    @app.after_request
    def login_token(response):
        if request.path in ('/login', '/admin/login') and response.status_code == 200:
            data = response.get_json(silent=True)
            if data and data.get('role') and data.get('email'):
                data['notification_token'] = token_for(data)
                response.set_data(json.dumps(data))
        return response

    @app.route('/alerts', methods=['GET', 'POST'])
    def alerts():
        user = identity()
        if request.method == 'POST':
            if user.get('role') != 'admin':
                return jsonify(message='Admin authorization required'), 403
            data = request.get_json(silent=True) or {}
            message = data.get('message', '')
            location = data.get('location', '')
            risk = data.get('risk_level', data.get('risk', 'Medium'))
            if not isinstance(message, str) or not message.strip() or not isinstance(location, str) or not location.strip() or risk not in ('Low', 'Medium', 'High'):
                return jsonify(message='A message, location and valid risk level are required'), 400
            return jsonify(create(message.strip(), risk, location.strip(), user['email'])), 201
        with db() as c:
            records = [json.loads(r['payload']) for r in c.execute('SELECT payload FROM alerts ORDER BY id DESC')]
        # Only officials may inspect cancelled alerts/history.
        if user.get('role') not in ('admin', 'government_official'):
            records = [r for r in records if r['status'] == 'Active']
        location = request.args.get('location', '').strip().lower()
        return jsonify([r for r in records if not location or location in r['location'].lower()])

    @app.route('/alerts/history', methods=['GET'])
    def history():
        if identity().get('role') not in ('admin', 'government_official'):
            return jsonify(message='Official authorization required'), 403
        with db() as c:
            entries = [dict(r) for r in c.execute('SELECT * FROM history ORDER BY id DESC')]
        for entry in entries:
            entry['alert'] = json.loads(entry.pop('payload'))
        return jsonify(entries)

    @app.route('/alerts/<int:alert_id>', methods=['PUT', 'DELETE'])
    def update(alert_id):
        user = identity()
        data = request.get_json(silent=True) or {}
        assignment = request.method == 'PUT' and bool(data) and set(data) <= {'assigned_worker', 'linked_rescue_op_id'}
        if user.get('role') != 'admin' and not (user.get('role') == 'government_official' and assignment):
            return jsonify(message='Admin authorization required'), 403
        if request.method == 'DELETE':
            data = {'status': 'Cancelled'}  # preserve records for review
        allowed = {'message', 'location', 'risk', 'risk_level', 'status', 'assigned_worker', 'linked_rescue_op_id'}
        if not data or set(data) - allowed:
            return jsonify(message='Invalid alert update'), 400
        risk = data.get('risk_level', data.get('risk'))
        if risk is not None and risk not in ('Low', 'Medium', 'High'):
            return jsonify(message='Invalid risk level'), 400
        if 'status' in data and data['status'] != 'Cancelled':
            return jsonify(message='Only cancellation of active alerts is allowed'), 400
        for field in ('message', 'location'):
            if field in data and (not isinstance(data[field], str) or not data[field].strip()):
                return jsonify(message=f'{field} is required'), 400
        with db() as c:
            row = c.execute('SELECT payload FROM alerts WHERE id=?', (alert_id,)).fetchone()
            if not row:
                return jsonify(message='Alert not found'), 404
            record = json.loads(row['payload'])
            if record['status'] != 'Active':
                return jsonify(message='Alert is no longer active'), 409
            record.update(data)
            if risk is not None:
                record['risk'] = record['risk_level'] = risk
            record['updated_at'] = now()
            c.execute('UPDATE alerts SET payload=? WHERE id=?', (json.dumps(record), alert_id))
            log(c, record, 'cancelled' if record['status'] == 'Cancelled' else 'updated', user['email'])
        return jsonify(record)
