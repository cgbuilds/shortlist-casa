"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { GradeResult, PropertyListing } from "@/lib/types";
import { outboundListingLinks } from "@/lib/outbound-links";

type Row = { listing: PropertyListing; grade: GradeResult };

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(points, { padding: [36, 36], maxZoom: 13 });
  }, [map, points]);
  return null;
}

function colorFor(grade: GradeResult) {
  if (grade.mustHaveFailed) return "#9a8f80";
  if ((grade.total ?? 0) >= 80) return "#2f5d50";
  if ((grade.total ?? 0) >= 65) return "#3d6e8c";
  return "#b4532a";
}

export function ResultsMap({
  rows,
  selectedId,
  onSelect,
}: {
  rows: Row[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
}) {
  const points = rows
    .filter((r) => r.listing.latitude != null && r.listing.longitude != null)
    .map((r) => [r.listing.latitude as number, r.listing.longitude as number] as [number, number]);

  return (
    <MapContainer
      center={points[0] ?? [27.89, -82.25]}
      zoom={11}
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {points.length ? <FitBounds points={points} /> : null}
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
                  {row.grade.mustHaveFailed ? "pass" : row.grade.total} · {row.listing.beds} bd ·{" "}
                  {row.listing.listPrice ? `$${row.listing.listPrice.toLocaleString()}` : ""}
                </p>
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
