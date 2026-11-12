// Only explicit registered geographic information establishes city membership.
// A nearest result elsewhere in Pakistan is not a facility in the prediction city.
export function facilitiesForCity(records, city, origin, distance) {
  const normalize = value => String(value || "").normalize("NFKC").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const target = normalize(city);
  if (!target || !Array.isArray(records)) return [];
  return records.filter(record => {
    const explicitCity = normalize(record.city);
    if (explicitCity) return explicitCity === target;
    return [record.address, record.location].some(value =>
      (` ${normalize(value)} `).includes(` ${target} `));
  }).map(record => {
    const valid = record.latitude != null && record.longitude != null &&
      String(record.latitude).trim() !== "" && String(record.longitude).trim() !== "" &&
      Number.isFinite(Number(record.latitude)) && Number.isFinite(Number(record.longitude)) &&
      Math.abs(Number(record.latitude)) <= 90 && Math.abs(Number(record.longitude)) <= 180;
    return { ...record, distanceKm: valid && origin
      ? distance(origin[0], origin[1], Number(record.latitude), Number(record.longitude)) : null };
  }).sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)).slice(0, 5);
}
