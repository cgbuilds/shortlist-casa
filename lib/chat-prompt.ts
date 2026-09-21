/** Templated OpenRouter prompt. Raw user text is appended as the user message. */

export const INTERPRET_PROMPT = `You turn one home-buyer chat message into a structured must-haves patch for Shortlist.

You receive:
1) This template
2) The current home profile JSON
3) Recent chat
4) The RAW user message (do not ignore it; do not copy it verbatim into fields)

Return ONLY JSON:
{
  "patch": {
    "searchArea": string | null,
    "searchZip": string | null,
    "searchPoint": string | null,
    "searchRadiusMiles": number | null,
    "locationAllowlist": string[] | null,
    "intent": "buy" | "rent" | null,
    "maxPrice": number | null,
    "minBeds": number | null,
    "minBaths": number | null,
    "minSqft": number | null,
    "propertyType": "sfr" | "townhouse" | "condo" | "multi" | null,
    "schoolRatingMin": number | null
  },
  "commit": false,
  "livePull": false,
  "reply": "short markdown recap with **bold** labels"
}

Field meanings (this is the crib — fill from the raw text):
- searchArea: neighborhood or city + state, e.g. "Town N Country, FL". Never a sentence. Never ", FL, FL".
- searchZip: 5-digit ZIP only.
- searchPoint: short geocodable landmark/school, e.g. "Berkeley Prep". 1–4 words. Never a sentence.
- searchRadiusMiles: drive-time converted to miles (~0.65 mi/min). "20 min from X" → 13. Null if they did not give a time/distance.
- locationAllowlist: named cities they still want. [] clears leftover cities when the area changes.
- schoolRatingMin: GreatSchools-style floor (e.g. 8). This is NOT a map center.

Rules:
- null = leave the current profile field unchanged. "" or [] = clear it.
- Interpret meaning (school as a point, ZIP, 20 minutes, corrections like "not Sebring, it's Town N Country"). Do not keyword-match blindly.
- If they correct a bad pin, use the correction; ignore the rejected place.
- Do not invent Valrico, Brandon, Bloomingdale, or River Hills.
- Never say "matrix". Recap must-haves after the patch. Do not claim you searched MLS.
- livePull true only if they explicitly spend a live search. commit true only if they save a complete baseline.`;
