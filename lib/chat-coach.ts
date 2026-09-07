import { baselineStatus } from "@/kb/catalog";
import type { ChatMessage, UserMatrix } from "@/lib/types";

export const EXAMPLE_CRITERIA = "Tampa, FL · 3 bed · 2 bath · single-family under $450k";

export const WELCOME_MESSAGE = `Tell me what you’re looking for — area, beds, baths, home type, and budget.

Example: **${EXAMPLE_CRITERIA}**

I’ll nudge you on extras as you type (pool, garage, walkability). When that’s enough, I’ll run a search.`;

type DraftBits = {
  area: boolean;
  beds: boolean;
  baths: boolean;
  type: boolean;
  budget: boolean;
  pool: boolean;
  garage: boolean;
  walkable: boolean;
};

function haystack(text: string, matrix?: UserMatrix) {
  const places = matrix?.locationAllowlist.join(" ") ?? "";
  return `${matrix?.searchArea ?? ""} ${places} ${text}`.toLowerCase();
}

function mentioned(source: string, re: RegExp) {
  return re.test(source);
}

export function draftBits(text: string, matrix?: UserMatrix): DraftBits {
  const t = haystack(text, matrix);
  const raw = text.toLowerCase();
  const beds = matrix?.dimensions.beds;
  const baths = matrix?.dimensions.baths;
  const ptype = matrix?.dimensions.property_type;
  const prefer = ptype?.prefs?.prefer ? String(ptype.prefs.prefer) : "";
  return {
    area:
      Boolean(matrix?.searchArea?.trim()) ||
      (matrix?.locationAllowlist.length ?? 0) > 0 ||
      mentioned(
        raw,
        /\b(tampa|orlando|miami|clearwater|st\.?\s*pete|brandon|valrico|lithia|sarasota|lakeland)\b/i
      ) ||
      mentioned(raw, /\b[A-Za-z][A-Za-z .]{1,40},\s*(FL|Florida|TX|CA|GA|NC|SC|AL|TN)\b/i),
    beds: Boolean(beds?.enabled && beds.min != null) || mentioned(raw, /\d+\s*-?\s*bed/),
    baths: Boolean(baths?.enabled && baths.min != null) || mentioned(raw, /\d+\s*-?\s*bath/),
    type:
      Boolean(ptype?.enabled && prefer) ||
      mentioned(raw, /\b(condo|townhouse|townhome|single[- ]family|\bsfr\b|house)\b/i),
    budget: Boolean(matrix?.budget.maxPrice) || mentioned(raw, /\$|under\s+\d|budget|max price|k\b/),
    pool: mentioned(t, /\bpool\b/),
    garage: Boolean(matrix?.dimensions.garage?.enabled) || mentioned(t, /\bgarage\b/),
    walkable:
      Boolean(matrix?.dimensions.walkable?.enabled) ||
      mentioned(t, /\b(walkable|walk to|coffee|shops? nearby)\b/),
  };
}

export function hasSearchableDump(text: string) {
  const bits = draftBits(text);
  return bits.area && bits.beds && bits.type;
}

export function wantsToSearchNow(text: string) {
  return /\b(search( now)?|find (me )?homes|run (a )?(live )?search|go ahead|show (me )?(the )?homes|that's enough|thats enough|that's it|thats it|i'?m done|im done|ready to search|looks good|commit)\b/i.test(
    text
  );
}

export function shouldAutoSearch(matrix: UserMatrix, userText: string, liveSearchesUsed = 0) {
  if (!baselineStatus(matrix).complete) return false;
  if (wantsToSearchNow(userText)) return true;
  if (liveSearchesUsed > 0) return false;
  return hasSearchableDump(userText);
}

export function remainingAfterSearchNote(remainingAfter?: number) {
  if (remainingAfter == null) return "";
  if (remainingAfter <= 0) {
    return "That was your last live search this month. Tighten must-haves and rescore the list instead of pulling again.";
  }
  if (remainingAfter === 1) {
    return "You only have one live search left. You should probably alter something more critical — budget, beds, or area — to get more refined results next time.";
  }
  if (remainingAfter === 2) {
    return "You only have two live searches left. You should probably alter something more critical — budget, beds, or area — to get more refined results.";
  }
  return `You have ${remainingAfter} live searches left. Change something more critical before the next pull if you want a more refined batch.`;
}

export function searchSpendGuidance(remainingBefore: number) {
  return remainingAfterSearchNote(Math.max(0, remainingBefore - 1));
}

const COMPOSER_HINTS: Array<{ id: keyof DraftBits | "ready"; hint: string; when: (bits: DraftBits) => boolean }> = [
  { id: "area", hint: `Start with a city. Example: ${EXAMPLE_CRITERIA}`, when: (b) => !b.area },
  { id: "beds", hint: "How many bedrooms do you need?", when: (b) => !b.beds },
  { id: "baths", hint: "How many bathrooms?", when: (b) => !b.baths },
  { id: "type", hint: "House, townhouse, or condo?", when: (b) => !b.type },
  { id: "budget", hint: "What’s your max price? Example: under $450k.", when: (b) => !b.budget },
  {
    id: "pool",
    hint: "Want a pool, or are you okay without one?",
    when: (b) => !b.pool,
  },
  { id: "garage", hint: "Do you need a garage, or is that optional?", when: (b) => !b.garage },
  {
    id: "walkable",
    hint: "Does walkability matter — shops and coffee nearby — or not really?",
    when: (b) => !b.walkable,
  },
  {
    id: "ready",
    hint: "Looks like enough to search. Send this, or say “search”.",
    when: () => true,
  },
];

export function composerHint(draft: string, matrix: UserMatrix, opts?: { draftOnlyBaseline?: boolean }) {
  if (!draft.trim()) {
    return `Example: ${EXAMPLE_CRITERIA}`;
  }
  const fromDraft = draftBits(draft);
  const fromBoth = draftBits(draft, matrix);
  const bits = opts?.draftOnlyBaseline
    ? { ...fromBoth, area: fromDraft.area, beds: fromDraft.beds, baths: fromDraft.baths, type: fromDraft.type, budget: fromDraft.budget }
    : fromBoth;
  return COMPOSER_HINTS.find((h) => h.when(bits))?.hint ?? "";
}

function alreadyAsked(history: ChatMessage[], needle: RegExp) {
  return history.some((m) => m.role === "assistant" && needle.test(m.content));
}

export function nextCoachQuestion(matrix: UserMatrix, userText: string, history: ChatMessage[] = []) {
  const bits = draftBits(userText, matrix);
  const missing = baselineStatus(matrix)
    .gaps.filter((g) => !g.done)
    .map((g) => g.label);
  if (missing.length) {
    return `Still need ${missing.join(", ")}. Example: ${EXAMPLE_CRITERIA}`;
  }
  if (!bits.pool && !alreadyAsked(history, /\bpool\b/i)) {
    return "Want a pool, or are you okay with no pool?";
  }
  if (!bits.garage && !alreadyAsked(history, /\bgarage\b/i)) {
    return "Do you need a garage, or does that not matter?";
  }
  if (!bits.walkable && !alreadyAsked(history, /walkab|coffee|shops/i)) {
    return "Does walkability matter, or not really?";
  }
  if (!wantsToSearchNow(userText) && !hasSearchableDump(userText)) {
    return "Say search when you’re ready, or add anything else that would change the list.";
  }
  return "";
}

export function poolPreference(text: string): "must" | "prefer" | "optional" | null {
  const t = text.toLowerCase();
  if (!/\bpool\b/.test(t)) return null;
  if (/\b(no pool|without (a )?pool|ok(ay)? (with )?no pool|doesn'?t matter|don't care|dont care|pool (is )?optional)\b/.test(t)) {
    return "optional";
  }
  if (/\b(must( have)?( a)? pool|need( a)? pool|pool is a must|dealbreaker)\b/.test(t)) return "must";
  return "prefer";
}
