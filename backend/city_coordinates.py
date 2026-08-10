"""Real city coordinates for ~50 major Pakistani cities/towns, covering all
provinces plus AJK and Gilgit-Baltistan. Used to place map markers for
records that only store a free-text location (rescue operations, community
reports, shelters/hospitals without a manually-pinned lat/lng) and to
auto-fill weather data on the citizen prediction form.

NOTE: this is a broader list than the 10 cities the ML model itself was
trained on (see feature_engineering.SUPPORTED_CITIES) — those 10 remain
fixed since the model's city one-hot encoding can't change without
retraining. This list is only for map/location display and defaults.
"""

MAP_CITIES = {
    "Karachi": (24.8607, 67.0011),
    "Lahore": (31.5204, 74.3587),
    "Faisalabad": (31.4504, 73.135),
    "Rawalpindi": (33.5651, 73.0169),
    "Multan": (30.1575, 71.5249),
    "Hyderabad": (25.396, 68.3578),
    "Gujranwala": (32.1877, 74.1945),
    "Peshawar": (34.0151, 71.5249),
    "Quetta": (30.1798, 66.975),
    "Islamabad": (33.6844, 73.0479),
    "Sialkot": (32.4945, 74.5229),
    "Sargodha": (32.0836, 72.6711),
    "Bahawalpur": (29.3956, 71.6836),
    "Sukkur": (27.7052, 68.8574),
    "Larkana": (27.559, 68.2123),
    "Sheikhupura": (31.7167, 73.985),
    "Jhang": (31.2704, 72.3181),
    "Rahim Yar Khan": (28.4202, 70.2952),
    "Gujrat": (32.5731, 74.0789),
    "Mardan": (34.1989, 72.0404),
    "Kasur": (31.118, 74.4467),
    "Okara": (30.8081, 73.4453),
    "Sahiwal": (30.6682, 73.1114),
    "Nawabshah": (26.2442, 68.41),
    "Mingora": (34.7717, 72.3604),
    "Dera Ghazi Khan": (30.0561, 70.6345),
    "Mirpur Khas": (25.5268, 69.0107),
    "Chiniot": (31.72, 72.9781),
    "Kamoke": (32.0989, 74.2263),
    "Mandi Bahauddin": (32.5859, 73.4917),
    "Jacobabad": (28.2769, 68.4381),
    "Jhelum": (32.9425, 73.7257),
    "Kohat": (33.59, 71.44),
    "Shikarpur": (27.9556, 68.6382),
    "Khanewal": (30.3015, 71.931),
    "Muzaffargarh": (30.0725, 71.1932),
    "Abbottabad": (34.1463, 73.2116),
    "Muridke": (31.8025, 74.2645),
    "Bahawalnagar": (29.9989, 73.2578),
    "Khairpur": (27.5295, 68.7592),
    "Turbat": (26.0031, 63.0483),
    "Dadu": (26.7308, 67.7761),
    "Chaman": (30.921, 66.4597),
    "Charsadda": (34.15, 71.74),
    "Nowshera": (34.015, 71.975),
    "Swabi": (34.12, 72.47),
    "Bannu": (32.988, 70.603),
    "Dera Ismail Khan": (31.831, 70.901),
    "Muzaffarabad": (34.37, 73.47),
    "Mirpur": (33.1478, 73.7508),
    "Gilgit": (35.9208, 74.3144),
    "Skardu": (35.2971, 75.6333),
    "Gwadar": (25.1264, 62.3225),
}

# Backwards-compatible alias used elsewhere in this file
CITY_COORDINATES = MAP_CITIES


def resolve_coordinates(location_text: str):
    """Best-effort match of a free-text location to a known city's coordinates."""
    if not location_text:
        return None
    loc = location_text.strip().lower()
    for city, coords in MAP_CITIES.items():
        if city.lower() in loc or loc in city.lower():
            return coords
    return None
