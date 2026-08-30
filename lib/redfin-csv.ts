import { readFileSync } from "fs";
import { join } from "path";
import type { PropertyListing, PropertyType } from "@/lib/types";
import { inferMarketFromCsv } from "@/lib/listing-market";
import { slugAddress } from "@/data/listings";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else if (c !== "\r") cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
  }
  return rows;
}

function num(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function mapPropertyType(raw: string): PropertyType {
  const t = raw.toLowerCase();
  if (t.includes("town")) return "townhouse";
  if (t.includes("condo") || t.includes("co-op") || t.includes("coop")) return "condo";
  if (t.includes("multi") || t.includes("2-4") || t.includes("duplex")) return "multi";
  if (t.includes("single")) return "sfr";
  return "other";
}

function inferSchoolArea(neighborhood: string, city: string): string | null {
  const hay = `${neighborhood} ${city}`.toLowerCase();
  if (hay.includes("bloomingdale")) return "Bloomingdale HS";
  if (hay.includes("fishhawk") || hay.includes("fish hawk")) return "FishHawk / Lithia";
  if (hay.includes("river hills")) return "River Hills";
  if (hay.includes("valrico")) return "Valrico";
  if (hay.includes("brandon")) return "Brandon";
  return neighborhood || city || null;
}

const HEADER_ALIASES: Record<string, string> = {
  "sale type": "saleType",
  "property type": "propertyType",
  address: "address",
  city: "city",
  "state or province": "state",
  "zip or postal code": "zip",
  price: "price",
  beds: "beds",
  baths: "baths",
  location: "neighborhood",
  "square feet": "sqft",
  "year built": "yearBuilt",
  "days on market": "dom",
  "$/square feet": "ppsqft",
  "hoa/month": "hoa",
  status: "status",
  source: "source",
  "mls#": "mls",
  latitude: "lat",
  longitude: "lng",
};

function normalizeHeader(h: string) {
  const lower = h.trim().toLowerCase();
  if (lower.startsWith("url")) return "url";
  return HEADER_ALIASES[lower] ?? lower;
}

export function parseRedfinCsv(text: string): PropertyListing[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  const listings: PropertyListing[] = [];
  for (const row of rows.slice(1)) {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = row[i] ?? "";
    });
    const address = rec.address?.trim();
    if (!address) continue;
    const city = rec.city?.trim() || "";
    const state = rec.state?.trim() || "FL";
    const zip = rec.zip?.trim() || "";
    const hoa = num(rec.hoa);
    const neighborhood = rec.neighborhood?.trim() || "";
    const propertyType = mapPropertyType(rec.propertyType || "");
    listings.push({
      id: slugAddress(address, city, state) || `rf-${listings.length}`,
      address,
      city,
      state,
      zip,
      beds: num(rec.beds),
      baths: num(rec.baths),
      sqft: num(rec.sqft),
      yearBuilt: num(rec.yearBuilt),
      listPrice: num(rec.price),
      daysOnMarket: num(rec.dom),
      latitude: num(rec.lat),
      longitude: num(rec.lng),
      status: rec.status || null,
      listingUrl: rec.url || null,
      hoaMonthly: hoa,
      neighborhood: neighborhood || null,
      mls: rec.mls || null,
      saleType: rec.saleType || null,
      pricePerSqft: num(rec.ppsqft),
      market: inferMarketFromCsv(rec.status, rec.saleType),
      facts: {
        propertyType,
        hoa: hoa != null ? hoa > 0 : null,
        schoolArea: inferSchoolArea(neighborhood, city),
      },
    });
  }
  return listings;
}

let bundled: PropertyListing[] | null = null;

export function loadBundledRedfinFavorites(): PropertyListing[] {
  if (bundled) return bundled;
  const path = join(process.cwd(), "data/redfin-favorites.csv");
  bundled = parseRedfinCsv(readFileSync(path, "utf8"));
  return bundled;
}

export function findRedfinListing(id: string): PropertyListing | undefined {
  return loadBundledRedfinFavorites().find((l) => l.id === id);
}
