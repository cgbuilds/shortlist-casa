const MILES_PER_DEG_LAT = 69;

export const SEARCH_RADIUS_MILES = 20;

export function radiusBounds(
  lat: number,
  lng: number,
  miles = SEARCH_RADIUS_MILES
): [[number, number], [number, number]] {
  const dLat = miles / MILES_PER_DEG_LAT;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = miles / (MILES_PER_DEG_LAT * Math.max(0.2, Math.abs(cos)));
  return [
    [lat - dLat, lng - dLng],
    [lat + dLat, lng + dLng],
  ];
}

export function milesToMeters(miles: number) {
  return miles * 1609.34;
}

export function readPhoneLocation(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  });
}
