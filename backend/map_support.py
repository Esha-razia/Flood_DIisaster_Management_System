"""FR-04: authorized edits, change tracking and coordinate-to-address lookup."""
import json
import math
import os
import threading
import time
import urllib.parse
import urllib.request
import uuid
from flask import jsonify, request
from notifications import identity

EDIT_ROLES = {'admin', 'government_official', 'rescue_worker'}
_revision = 0
_instance = uuid.uuid4().hex
_cache = {}
_lookup_lock = threading.Lock()
_last_lookup = 0.0

def register(app):
    @app.before_request
    def authorize_map_edits():
        resource = request.path.strip('/').split('/')[0]
        if resource == 'community-reports' and (request.method in {'PUT','PATCH','DELETE'}):
            if identity().get('role') not in EDIT_ROLES:
                return jsonify(message='Official authorization required'), 403
        if resource in {'shelters', 'hospitals', 'blocked-roads'} and request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            if identity().get('role') not in EDIT_ROLES:
                return jsonify(message='Official authorization required'), 403
            data = request.get_json(silent=True) or {}
            for field, limit in [('latitude', 90), ('longitude', 180)]:
                if field in data and data[field] is not None:
                    try:
                        value = float(data[field])
                        if not math.isfinite(value) or abs(value) > limit:
                            raise ValueError()
                    except (ValueError, TypeError):
                        return jsonify(message=f'Invalid {field}'), 400

    @app.after_request
    def map_changed(response):
        global _revision
        resource = request.path.strip('/').split('/')[0]
        if response.status_code < 400 and request.method in {'POST', 'PUT', 'PATCH', 'DELETE'} and resource in {'shelters', 'hospitals', 'blocked-roads', 'rescue-operations', 'community-reports', 'predict'}:
            _revision += 1
        return response

    @app.get('/map-revision')
    def revision():
        response = jsonify(revision=f'{_instance}:{_revision}')
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/reverse-geocode')
    def reverse_geocode():
        global _last_lookup
        try:
            lat = float(request.args['lat'])
            lng = float(request.args['lng'])
            if not math.isfinite(lat) or not math.isfinite(lng) or abs(lat) > 90 or abs(lng) > 180:
                raise ValueError()
        except (KeyError, ValueError, TypeError):
            return jsonify(message='Valid latitude and longitude are required'), 400
        key = (round(lat, 6), round(lng, 6))
        with _lookup_lock:
            if key in _cache:
                return jsonify(_cache[key])
            # Nominatim permits at most one lookup per second; cache click/GPS lookups.
            delay = 1.05 - (time.monotonic() - _last_lookup)
            if delay > 0:
                time.sleep(delay)
            _last_lookup = time.monotonic()
            base = os.environ.get('FMS_GEOCODER_URL', 'https://nominatim.openstreetmap.org/reverse')
            query = urllib.parse.urlencode({'format':'jsonv2', 'lat':lat, 'lon':lng, 'zoom':18, 'addressdetails':1, 'accept-language':'en'})
            req = urllib.request.Request(base + '?' + query, headers={'User-Agent':'FloodDisasterManagement/1.0 (interactive location lookup)', 'Accept':'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=4) as remote:
                    data = json.load(remote)
                name = data.get('display_name')
                if not name:
                    return jsonify(message='No mapped address found for this point'), 404
                result = {'location':name, 'address':data.get('address',{}), 'latitude':lat, 'longitude':lng}
                if len(_cache) > 500:
                    _cache.clear()
                _cache[key] = result
                return jsonify(result)
            except Exception as primary_error:
                app.logger.warning('Nominatim reverse lookup failed: %s', primary_error)
                try:
                    params = urllib.parse.urlencode({'lat':lat,'lon':lng,'lang':'en','limit':1,'radius':0.2})
                    req = urllib.request.Request('https://photon.komoot.io/reverse?' + params, headers={'User-Agent':'FloodDisasterManagement/1.0','Accept':'application/json'})
                    with urllib.request.urlopen(req, timeout=4) as remote: fallback = json.load(remote)
                    features = fallback.get('features') or []
                    properties = features[0].get('properties', {}) if features else {}
                    parts = [properties.get(k) for k in ('name','housenumber','street','district','city','county','state','country')]
                    name = ', '.join(dict.fromkeys(str(v) for v in parts if v))
                    if not name: return jsonify(message='No mapped address found for this point'), 404
                    result = {'location':name,'address':properties,'latitude':lat,'longitude':lng}
                    _cache[key] = result
                    return jsonify(result)
                except Exception as fallback_error:
                    app.logger.warning('Photon reverse lookup failed: %s', fallback_error)
                    return jsonify(message='Address services could not be reached. Check internet access or enter the address manually.'), 503

def resolve_report_address(address):
    """Resolve a typed incident address; never invent a map point."""
    query = urllib.parse.urlencode({
        'q': address, 'format': 'jsonv2', 'addressdetails': 1,
        'limit': 1, 'countrycodes': 'pk'
    })
    req = urllib.request.Request(
        'https://nominatim.openstreetmap.org/search?' + query,
        headers={'User-Agent':'FloodDisasterManagement/1.0 (incident address lookup)', 'Accept':'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=8) as remote:
            results = json.load(remote)
        if not results:
            return None
        result = results[0]
        lat, lng = float(result['lat']), float(result['lon'])
        if not math.isfinite(lat) or not math.isfinite(lng) or abs(lat)>90 or abs(lng)>180:
            return None
        return {'latitude':lat, 'longitude':lng,
                'region':result.get('address', {}).get('state', '')}
    except Exception:
        return None
