"""
Feature engineering for the flood risk models trained on FLOOD_DATASET.csv
(10 Pakistani cities, 2000-2024, chronological split, MinMaxScaler + RF/XGB).

The models expect exactly these 20 features, in this order
(taken from scaler.feature_names_in_):

    temperature, humidity, wind_speed, soil_moisture_top, soil_7day_avg,
    month, year, is_monsoon, season, rain_intensity,
    city_Faisalabad, city_Gujranwala, city_Hyderabad, city_Karachi, city_Lahore,
    city_Multan, city_Peshawar, city_Rawalpindi, city_Sialkot, city_Sukkur

Formulas below were reverse-engineered directly from FLOOD_DATASET.csv and
verified to reproduce FINAL_FEATURES exactly as used in
Flood_Preprocessing_Training.ipynb.
"""

import json
import os
from datetime import datetime

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CLIMATOLOGY_PATH = os.path.join(CURRENT_DIR, "city_climatology.json")

SUPPORTED_CITIES = [
    "Faisalabad", "Gujranwala", "Hyderabad", "Karachi", "Lahore",
    "Multan", "Peshawar", "Rawalpindi", "Sialkot", "Sukkur",
]

with open(CLIMATOLOGY_PATH, "r") as f:
    CITY_CLIMATOLOGY = json.load(f)


def season_from_month(month: int) -> int:
    """Winter=1 (Dec,Jan,Feb), Pre-Monsoon=2 (Mar-May), Monsoon=3 (Jun-Sep), Post-Monsoon=4 (Oct,Nov)."""
    if month in (12, 1, 2):
        return 1
    if month in (3, 4, 5):
        return 2
    if month in (6, 7, 8, 9):
        return 3
    return 4  # 10, 11


def is_monsoon_from_month(month: int) -> int:
    return 1 if month in (6, 7, 8, 9) else 0


def rain_intensity_bucket(rainfall_mm: float) -> int:
    """Reproduces the dataset's rain_intensity categorical bucket."""
    if rainfall_mm <= 0:
        return 0
    if rainfall_mm <= 2.5:
        return 1
    if rainfall_mm <= 7.6:
        return 2
    if rainfall_mm <= 15:
        return 3
    return 4


def resolve_city(location: str) -> str:
    """Match a free-text location to one of the 10 model-supported cities.
    Falls back to the nearest known city name (case-insensitive substring match);
    if nothing matches, returns None so the caller can decide how to handle it."""
    if not location:
        return None
    loc = location.strip().lower()
    for city in SUPPORTED_CITIES:
        if city.lower() == loc:
            return city
    for city in SUPPORTED_CITIES:
        if city.lower() in loc or loc in city.lower():
            return city
    return None


def get_climatology(city: str, month: int) -> dict:
    """Historical average humidity/wind/soil-moisture for this city+month.
    Falls back to Lahore (dataset's most complete series) if city unknown,
    and to nationwide monthly average if month somehow missing."""
    city_data = CITY_CLIMATOLOGY.get(city) or CITY_CLIMATOLOGY.get("Lahore")
    month_data = city_data.get(str(month))
    if month_data is None:
        # average across all months for that city as a last resort
        vals = list(city_data.values())
        keys = vals[0].keys()
        month_data = {k: sum(v[k] for v in vals) / len(vals) for k in keys}
    return month_data


def build_feature_vector(
    scaler_feature_order: list,
    location: str,
    rainfall_mm: float,
    temperature: float = None,
    humidity: float = None,
    wind_speed: float = None,
    soil_moisture_top: float = None,
    soil_7day_avg: float = None,
    date: datetime = None,
) -> tuple:
    """
    Builds the 20-value feature vector (as a dict) in the exact order the
    scaler/model expect. Any value not explicitly supplied by the user is
    filled from the city+month climatology (real historical averages),
    not an arbitrary global constant.

    Returns (feature_dict_in_order, resolved_city, warnings)
    """
    warnings = []
    date = date or datetime.now()
    month, year = date.month, date.year

    city = resolve_city(location)
    if city is None:
        city = "Lahore"
        warnings.append(
            f"'{location}' is not one of the 10 cities the model was trained on "
            f"({', '.join(SUPPORTED_CITIES)}). Falling back to Lahore's climate "
            f"profile for the missing weather inputs; the prediction may be less "
            f"accurate for this location."
        )

    clim = get_climatology(city, month)

    if temperature is None:
        temperature = clim["temperature"]
        warnings.append("temperature not provided — using historical city/month average")
    if humidity is None:
        humidity = clim["humidity"]
    if wind_speed is None:
        wind_speed = clim["wind_speed"]
    if soil_moisture_top is None:
        soil_moisture_top = clim["soil_moisture_top"]
    if soil_7day_avg is None:
        soil_7day_avg = clim["soil_7day_avg"]

    values = {
        "temperature": float(temperature),
        "humidity": float(humidity),
        "wind_speed": float(wind_speed),
        "soil_moisture_top": float(soil_moisture_top),
        "soil_7day_avg": float(soil_7day_avg),
        "month": float(month),
        "year": float(year),
        "is_monsoon": float(is_monsoon_from_month(month)),
        "season": float(season_from_month(month)),
        "rain_intensity": float(rain_intensity_bucket(rainfall_mm)),
    }
    for c in SUPPORTED_CITIES:
        values[f"city_{c}"] = 1.0 if c == city else 0.0

    # Return in the exact order the scaler expects
    ordered = {name: values[name] for name in scaler_feature_order}
    return ordered, city, warnings
