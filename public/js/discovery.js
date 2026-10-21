import { distanceKm, filterStations, hasCoordinates } from './domain.js';

export function compareStations(a, b, sort, summaries, center, distances) {
  if (sort === 'name') return a.name.localeCompare(b.name, 'ko');
  const field = {available:'available',count:'matching',power:'maxPower'}[sort];
  if (field) {
    const delta = (summaries.get(b.id)?.[field] || 0) - (summaries.get(a.id)?.[field] || 0);
    if (delta) return delta;
  }
  return (distances?.get(a.id) ?? distanceKm(center, a)) - (distances?.get(b.id) ?? distanceKm(center, b)) || a.name.localeCompare(b.name, 'ko');
}

export function nearbyAlternatives(station, stations, regions, filters, now = Date.now(), threshold = 600, radiusKm = 5, limit = 3) {
  if (!hasCoordinates(station)) return [];
  const candidates = filterStations(stations, regions, {...filters,query:'',favorites:false}, new Set(), now, threshold);
  const seen = new Set([String(station.id)]);
  return candidates.filter(candidate => {
    const id = String(candidate.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return hasCoordinates(candidate) && distanceKm(station, candidate) <= radiusKm;
  }).sort((a,b) => distanceKm(station,a) - distanceKm(station,b) || a.name.localeCompare(b.name,'ko')).slice(0,limit);
}

export function estimateChargingCost(energyValue, priceValue) {
  if (!String(energyValue).trim() || !String(priceValue).trim()) return null;
  const energy = Number(energyValue), price = Number(priceValue);
  if (!Number.isFinite(energy) || !Number.isFinite(price) || energy <= 0 || energy > 1000 || price <= 0 || price > 5000) return null;
  return Math.round(energy * price);
}
