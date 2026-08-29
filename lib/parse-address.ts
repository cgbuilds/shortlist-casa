const STREET_STOP = /\b(apt|unit|#|suite)\b/i;

export function parseAddressFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const chunks = decodeURIComponent(url.pathname)
      .replace(/\.(html|htm)$/i, "")
      .split("/")
      .filter(Boolean)
      .map((c) => c.replace(/_/g, " "));
    const candidate = [...chunks]
      .reverse()
      .find((c) => c.length > 10 && /\d/.test(c) && /[a-z]/i.test(c) && !/zpid/i.test(c));
    if (candidate) return cleanAddress(candidate.replace(/-/g, " "));
  } catch {
    // not a URL
  }

  if (/\d/.test(trimmed) && /[a-z]/i.test(trimmed) && !/^https?:/i.test(trimmed)) {
    return cleanAddress(trimmed);
  }
  return null;
}

function cleanAddress(raw: string): string {
  return raw
    .replace(/[_+]/g, " ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((part, i) => i === 0 || !STREET_STOP.test(part))
    .join(", ")
    .replace(/\s+/g, " ")
    .trim();
}
