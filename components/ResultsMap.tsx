"use client";

import { useEffect, useState } from "react";
import L from "leaflet";
import { CircleMarker, Circle, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { GradeResult, PropertyListing } from "@/lib/types";
import { formatAskPrice } from "@/lib/listing-market";
import { outboundListingLinks } from "@/lib/outbound-links";
import { gradeCaption } from "@/lib/grade";
import { milesToMeters, radiusBounds, SEARCH_RADIUS_MILES } from "@/lib/geo";

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const OSM_DE = "https://tile.openstreetmap.de/{z}/{x}/{y}.png";
const ESRI =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";

function MapTiles() {
  const [url, setUrl] = useState(OSM_DE);
  const osm = url === OSM_DE;
  return (
    <TileLayer
      key={url}
      attribution={
        osm
          ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          : "Tiles &copy; Esri"
      }
      url={url}
      eventHandlers={{
        tileerror: () => {
          if (osm) setUrl(ESRI);
        },
      }}
    />
  );
}

function silenceDefaultMarkerIcon() {
  const proto = L.Icon.Default.prototype as L.Icon.Default & { _getIconUrl?: unknown };
  delete proto._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: PIXEL,
    iconRetinaUrl: PIXEL,
    shadowUrl: PIXEL,
    iconSize: [1, 1],
    shadowSize: [1, 1],
  });
}

type Row = { listing: PropertyListing; grade: GradeResult };

function InvalidateSize({ tick }: { tick: string }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const run = () => map.invalidateSize({ animate: false });
    run();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => run()) : null;
    ro?.observe(el.parentElement ?? el);
    const timers = [50, 200, 500, 1000].map((ms) => window.setTimeout(run, ms));
    return () => {
      ro?.disconnect();
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [map, tick]);
  return null;
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(points, { padding: [36, 36], maxZoom: 13 });
  }, [map, points]);
  return null;
}

function FitRadius({ lat, lng, miles }: { lat: number; lng: number; miles: number }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(radiusBounds(lat, lng, miles), { padding: [28, 28], maxZoom: 12 });
  }, [map, lat, lng, miles]);
  return null;
}

function colorFor(grade: GradeResult) {
  if (grade.band === "miss" || grade.mustHaveFailed) return "#9a8f80";
  if (grade.band === "superb" || grade.band === "excellent") return "#2f5d50";
  if (grade.band === "good") return "#3d6e8c";
  return "#b4532a";
}

export function ResultsMap({
  rows,
  selectedId,
  onSelect,
  layoutTick = "default",
  here = null,
  lockToHere = false,
}: {
  rows: Row[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  layoutTick?: string;
  here?: { lat: number; lng: number } | null;
  lockToHere?: boolean;
}) {
  silenceDefaultMarkerIcon();
  const points = rows
    .filter((r) => r.listing.latitude != null && r.listing.longitude != null)
    .map((r) => [r.listing.latitude as number, r.listing.longitude as number] as [number, number]);
  const showHere = Boolean(here);
  const useRadius = Boolean(lockToHere && here);

  return (
    <MapContainer
      center={here ? [here.lat, here.lng] : (points[0] ?? [27.89, -82.25])}
      zoom={11}
      zoomControl={false}
      attributionControl
      className="h-full w-full max-w-full"
      scrollWheelZoom
    >
      <MapTiles />
      {useRadius && here ? <FitRadius lat={here.lat} lng={here.lng} miles={SEARCH_RADIUS_MILES} /> : null}
      {!useRadius && points.length ? <FitBounds points={points} /> : null}
      <InvalidateSize tick={`${layoutTick}:${here ? "here" : "nohere"}:${useRadius ? "r" : "p"}`} />
      {showHere && here ? (
        <Circle
          center={[here.lat, here.lng]}
          radius={milesToMeters(SEARCH_RADIUS_MILES)}
          pathOptions={{ color: "#2f5d50", weight: 1, fillColor: "#2f5d50", fillOpacity: 0.06 }}
        />
      ) : null}
      {rows.map((row) => {
        if (row.listing.latitude == null || row.listing.longitude == null) return null;
        const selected = row.listing.id === selectedId;
        const links = outboundListingLinks(row.listing);
        return (
          <CircleMarker
            key={row.listing.id}
            center={[row.listing.latitude, row.listing.longitude]}
            radius={selected ? 11 : 8}
            pathOptions={{
              color: colorFor(row.grade),
              fillColor: colorFor(row.grade),
              fillOpacity: selected ? 0.95 : 0.75,
              weight: selected ? 3 : 1,
            }}
            eventHandlers={{ click: () => onSelect(row.listing.id) }}
          >
            <Popup>
              <div className="min-w-[160px] text-sm">
                <p className="font-semibold">{row.listing.address}</p>
                <p>
                  {gradeCaption(row.grade).score} {gradeCaption(row.grade).word} · {row.listing.beds} bd ·{" "}
                  {row.listing.listPrice ? formatAskPrice(row.listing) : ""}
                </p>
                {row.grade.why ? <p className="mt-1 max-w-xs text-xs">{row.grade.why}</p> : null}
                <p className="mt-1 flex gap-2">
                  {links.map((l) => (
                    <a key={l.name} href={l.href} target="_blank" rel="noreferrer">
                      {l.name}
                    </a>
                  ))}
                </p>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
