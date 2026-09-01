import assert from "node:assert/strict";
import { starterMatrix } from "@/lib/starter-profile";
import { decodeShare, encodeShare, packShare, slimListing } from "@/lib/share";
import type { PropertyListing } from "@/lib/types";

const listing: PropertyListing = {
  id: "share-test-1",
  address: "28 Camelot Ridge Dr",
  city: "Brandon",
  state: "FL",
  zip: "33511",
  beds: 5,
  baths: 3,
  sqft: 3365,
  yearBuilt: 2001,
  listPrice: 799000,
  daysOnMarket: 15,
  latitude: 27.9,
  longitude: -82.3,
  status: "Active",
  listingUrl: "https://www.redfin.com/example",
  hoaMonthly: null,
  neighborhood: null,
  market: "sale",
  facts: { propertyType: "sfr", garage: true, inUnitLaundry: null },
};

async function main() {
  const matrix = starterMatrix();
  const token = await encodeShare(matrix, [listing]);
  assert.match(token, /^s1\./);
  const opened = await decodeShare(token);
  assert.ok(opened);
  assert.equal(opened.listings.length, 1);
  assert.equal(opened.listings[0].address, listing.address);
  assert.equal(opened.matrix.searchArea, matrix.searchArea);
  assert.equal(opened.listings[0].facts.inUnitLaundry, undefined);
  const packed = packShare(matrix, [listing]);
  assert.equal(packed.listings[0].id, slimListing(listing).id);
  assert.equal(await decodeShare("nope"), null);
  console.log("share encode/decode ok", token.length, "chars");
}

void main();
