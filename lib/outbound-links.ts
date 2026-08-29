export function outboundListingLinks(address: string, city: string, state: string, zip: string) {
  const q = encodeURIComponent(`${address}, ${city}, ${state} ${zip}`);
  return [
    { name: "Zillow", href: `https://www.zillow.com/homes/${q}_rb/` },
    { name: "Redfin", href: `https://www.redfin.com/stingray/do/location-search?location=${q}` },
    { name: "Realtor.com", href: `https://www.realtor.com/realestateandhomes-search?search_query=${q}` },
    {
      name: "Hillsborough Property Appraiser",
      href: `https://gis.hcpafl.org/propertysearch/#/nav/Search?search=${encodeURIComponent(address)}`,
    },
  ];
}
