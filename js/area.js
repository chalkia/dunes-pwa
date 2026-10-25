// Η περιοχή της δράσης. Προέρχεται από το αρχείο KMZ (πολύγωνο «Περιοχή»).
// Σειρά συντεταγμένων GeoJSON: [μήκος, πλάτος].
export const AREA = {
  type: 'Feature',
  properties: { name: 'Περιοχή' },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [24.5118357, 35.3696579],
      [24.5119322, 35.3687918],
      [24.5175971, 35.3695967],
      [24.5174039, 35.3703491],
      [24.5118357, 35.3696579],
    ]],
  },
};

// Περιβάλλον ορθογώνιο της περιοχής: { south, west, north, east }.
export function areaBounds() {
  const ring = AREA.geometry.coordinates[0];
  const lons = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lons),
    east: Math.max(...lons),
  };
}
