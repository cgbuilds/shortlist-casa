import type { NeighborhoodVibe, PropertyListing, UserMatrix } from "@/lib/types";

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

type AmenityCounts = { cafes: number; shops: number };

const inflight = new Map<string, Promise<AmenityCounts>>();
const cache = new Map<string, AmenityCounts>();

export function cellKey(lat: number, lng: number) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

export function inferVibe(cafes: number, shops: number): NeighborhoodVibe {
  const n = cafes + shops;
  if (n >= 40) return "busy";
  if (cafes >= 1 && shops >= 3) return "local_center";
  if (n >= 8) return "local_center";
  return "sleepy";
}

export function inferWalkable(cafes: number, shops: number) {
  return cafes >= 1 && shops >= 2;
}

export function matrixWantsAmenities(matrix: UserMatrix) {
  return ["walkable", "local_amenities", "neighborhood_vibe"].some((id) => matrix.dimensions[id]?.enabled);
}

async function overpassCounts(lat: number, lng: number): Promise<AmenityCounts> {
  const query = `[out:json][timeout:12];
(
  node["amenity"="cafe"](around:800,${lat},${lng});
  node["amenity"="coffee_shop"](around:800,${lat},${lng});
  node["shop"](around:800,${lat},${lng});
);
out tags;`;
  let lastErr: unknown;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "HomesteadMatrix/1.0 (family home grader)",
        },
        body: `data=${encodeURIComponent(query)}`,
        cache: "no-store",
        signal: AbortSignal.timeout(14000),
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { elements?: { tags?: Record<string, string> }[] };
      let cafes = 0;
      let shops = 0;
      for (const el of data.elements ?? []) {
        const amenity = el.tags?.amenity;
        if (amenity === "cafe" || amenity === "coffee_shop") cafes += 1;
        else if (el.tags?.shop) shops += 1;
      }
      return { cafes, shops };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Overpass failed");
}

async function countsForCell(lat: number, lng: number): Promise<AmenityCounts> {
  const key = cellKey(lat, lng);
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;
  const work = overpassCounts(lat, lng)
    .then((counts) => {
      cache.set(key, counts);
      inflight.delete(key);
      return counts;
    })
    .catch(() => {
      const empty = { cafes: -1, shops: -1 };
      cache.set(key, empty);
      inflight.delete(key);
      return empty;
    });
  inflight.set(key, work);
  return work;
}

export async function enrichListingsForMatrix(
  listings: PropertyListing[],
  matrix: UserMatrix
): Promise<PropertyListing[]> {
  if (!matrixWantsAmenities(matrix)) return listings;
  const keys = new Set<string>();
  for (const l of listings) {
    if (l.latitude == null || l.longitude == null) continue;
    keys.add(cellKey(l.latitude, l.longitude));
  }
  const toFetch = [...keys].slice(0, 12);
  await Promise.all(
    toFetch.map(async (key) => {
      const [lat, lng] = key.split(",").map(Number);
      await countsForCell(lat, lng);
    })
  );
  return listings.map((l) => {
    if (l.latitude == null || l.longitude == null) return l;
    const counts = cache.get(cellKey(l.latitude, l.longitude));
    if (!counts || counts.cafes < 0) return l;
    const vibe = l.facts.neighborhoodVibe ?? inferVibe(counts.cafes, counts.shops);
    const walkable = l.facts.walkable ?? inferWalkable(counts.cafes, counts.shops);
    return {
      ...l,
      facts: {
        ...l.facts,
        cafeCount: l.facts.cafeCount ?? counts.cafes,
        shopCount: l.facts.shopCount ?? counts.shops,
        neighborhoodVibe: vibe,
        walkable,
      },
    };
  });
}
