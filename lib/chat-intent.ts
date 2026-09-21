export function looksLikeCriteria(text: string) {
  return (
    /\b(\d+\s*-?\s*bed|\d+\s*-?\s*bath|must-?have|budget|under\s*\$|condo|townhouse|single[- ]family|\bsfr\b)\b/i.test(
      text
    ) ||
    /\b(tampa|orlando|miami|clearwater|st\.?\s*pete|brandon|valrico|lithia|sarasota|lakeland|town\s*(?:n|and|&)\s*country)\b/i.test(
      text
    ) ||
    /\b(zip(?:\s*code)?\s*\d{5}|3[2-4]\d{3}|prep(?:aratory)?|high school)\b/i.test(text) ||
    /\b[A-Za-z][A-Za-z .]{1,40},\s*(FL|Florida|TX|CA|GA)\b/i.test(text)
  );
}

export function wantsRescore(text: string) {
  return /\b(re-?score|run scoring|score (the )?(list|homes|set)|grade (the )?(list|cache)|re-?grade)\b/i.test(
    text
  );
}
