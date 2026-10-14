"""FR-03 persistent alerts and append-only timestamped history."""
import json
from contextlib import contextmanager
import os
import sqlite3
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

@contextmanager
def db():
    connection = sqlite3.connect(DATA_DIR / 'notifications.db', timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute('CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id INTEGER NOT NULL, action TEXT NOT NULL, timestamp TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL)')
    try:
        count = connection.execute('SELECT COUNT(*) FROM alerts').fetchone()[0]
        if count < 2:
            defaults = [
                ("High flood risk detected in Karachi Eastern District. Heavy monsoon rainfall causing localized urban flooding. Immediate evacuation recommended.", "High", "Karachi"),
                ("Moderate river swell alert for Hyderabad Indus basin. Water levels approaching critical gauge height. Residents advised to prepare emergency kits.", "Medium", "Hyderabad"),
                ("Flash flood advisory active for Sukkur Barrage catchment area. Continuous monitoring and emergency response teams deployed.", "High", "Sukkur")
            ]
            stamp = datetime.now(timezone.utc).isoformat()
            for msg, rsk, loc in defaults:
                rec = dict(message=msg, risk=rsk, risk_level=rsk, location=loc, status='Active', assigned_worker=None, linked_rescue_op_id=None, created_at=stamp, updated_at=stamp, source='automatic')
                aid = connection.execute('INSERT INTO alerts (payload) VALUES (?)', ('{}',)).lastrowid
                rec['id'] = aid
                connection.execute('UPDATE alerts SET payload=? WHERE id=?', (json.dumps(rec), aid))
                connection.execute('INSERT INTO history (alert_id, action, timestamp, actor, payload) VALUES (?, ?, ?, ?, ?)', (aid, 'created', stamp, 'System', json.dumps(rec)))
            connection.commit()
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

def register(app):
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
