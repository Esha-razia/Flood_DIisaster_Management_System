"""Shared validation for community and map incident submissions."""
import base64
import io
import re
from PIL import Image

def validate_report(data):
    errors = {}
    location = str(data.get('location') or '').strip()
    description = str(data.get('description') or '').strip()
    contact = str(data.get('contact') or '').strip()
    if len(location) < 3:
        errors['location'] = 'Enter an incident location or use your current location.'
    if len(description) < 10:
        errors['description'] = 'Description must contain at least 10 characters.'
    elif not description[0].isalpha() or ('a' <= description[0] <= 'z'):
        errors['description'] = 'Start the description with a capital letter.'
    if not re.fullmatch(r'03[0-9]{9}', contact):
        errors['contact'] = 'Enter an 11-digit mobile number, e.g. 03001234567.'
    if data.get('severity', 'High') not in ('Low', 'Medium', 'High'):
        errors['severity'] = 'Select a valid severity.'
    try:
        header, encoded = (data.get('imageUrl') or '').split(',', 1)
        formats = {'data:image/jpeg;base64':'JPEG', 'data:image/png;base64':'PNG',
                   'data:image/webp;base64':'WEBP', 'data:image/gif;base64':'GIF'}
        if header not in formats or len(encoded) > 4 * ((50 * 1024 * 1024 + 2)//3):
            raise ValueError()
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 50 * 1024 * 1024:
            raise ValueError()
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != formats[header]:
                raise ValueError()
            image.verify()
    except Exception:
        errors['image'] = 'Upload a valid JPG, PNG, WebP or GIF image (maximum 50 MB).'
    return errors
