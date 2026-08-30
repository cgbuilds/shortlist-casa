import { CATALOG, CATALOG_VERSION, defaultMatrix, catalogById, isLegacyAllowlist, baselineStatus } from "@/kb/catalog";
import { adviseLiveSearch } from "@/lib/listing-cache";
import { queryFromMatrix } from "@/lib/rentcast";
import type { DimensionKnobs, ListingIntent, ManualRubric, UnknownPolicy, UserMatrix } from "@/lib/types";

const ALLOWED_KNOB_KEYS = new Set([
  "enabled",
  "weight",
  "label",
  "mustHave",
  "invert",
  "min",
  "max",
  "prefs",
]);

export function cloneMatrix(matrix: UserMatrix): UserMatrix {
  return structuredClone(matrix);
}

export function ensureMatrix(input?: Partial<UserMatrix> | null): UserMatrix {
  const base = defaultMatrix();
  if (!input) return base;
  const legacy = isLegacyAllowlist(input.locationAllowlist);
  return {
    ...base,
    ...input,
    catalogVersion: CATALOG_VERSION,
    searchArea: legacy ? "" : (input.searchArea ?? base.searchArea),
    intent: input.intent === "rent" ? "rent" : "buy",
    budget: { ...base.budget, ...input.budget },
    dimensions: { ...base.dimensions, ...input.dimensions },
    locationAllowlist: legacy ? [] : (input.locationAllowlist ?? base.locationAllowlist),
    manualRubrics: input.manualRubrics ?? base.manualRubrics,
    unknownPolicy: input.unknownPolicy ?? base.unknownPolicy,
  };
}

export function setDimension(
  matrix: UserMatrix,
  id: string,
  patch: Partial<DimensionKnobs>
): UserMatrix | { error: string } {
  const dim = catalogById(id);
  if (!dim) return { error: `Dimension '${id}' is not in the knowledge-base catalog.` };
  const current = matrix.dimensions[id] ?? dim.defaultKnobs;
  const next: DimensionKnobs = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED_KNOB_KEYS.has(key)) continue;
    if (key !== "prefs" && !dim.allowedKnobs.includes(key) && key !== "enabled" && key !== "weight") {
      continue;
    }
    (next as Record<string, unknown>)[key] = value;
  }
  if (typeof next.weight === "number") next.weight = Math.max(0, Math.min(40, next.weight));
  return {
    ...matrix,
    dimensions: { ...matrix.dimensions, [id]: next },
  };
}

export function setBudget(
  matrix: UserMatrix,
  patch: UserMatrix["budget"] & {
    unknownPolicy?: UnknownPolicy;
    locationAllowlist?: string[];
    searchArea?: string;
    intent?: ListingIntent;
  }
): UserMatrix {
  const { unknownPolicy, locationAllowlist: allowIn, searchArea, intent, ...budgetPatch } = patch;
  const locationAllowlist = allowIn
    ? allowIn.map((a) => a.trim()).filter((a) => a.length >= 2 && a.length <= 48)
    : matrix.locationAllowlist;
  const next: UserMatrix = {
    ...matrix,
    unknownPolicy: unknownPolicy ?? matrix.unknownPolicy,
    searchArea: searchArea != null ? searchArea.trim() : matrix.searchArea,
    intent: intent === "rent" || intent === "buy" ? intent : matrix.intent,
    budget: { ...matrix.budget, ...budgetPatch },
    locationAllowlist,
  };
  if (!next.searchArea && next.locationAllowlist.length) {
    next.searchArea = next.locationAllowlist.join(", ");
  }
  if (next.searchArea || next.locationAllowlist.length) {
    const loc = setDimension(next, "school_area", { enabled: true, mustHave: false });
    if (!("error" in loc)) return loc;
  }
  return next;
}

export function addManualRubric(matrix: UserMatrix, label: string, weight = 5): UserMatrix {
  const rubric: ManualRubric = {
    id: `manual_${crypto.randomUUID().slice(0, 8)}`,
    label: label.slice(0, 80),
    weight: Math.max(1, Math.min(20, weight)),
  };
  return { ...matrix, manualRubrics: [...matrix.manualRubrics, rubric] };
}

export function previewMatrix(matrix: UserMatrix) {
  return {
    catalogVersion: matrix.catalogVersion,
    unknownPolicy: matrix.unknownPolicy,
    searchArea: matrix.searchArea,
    intent: matrix.intent,
    baseline: baselineStatus(matrix),
    budget: matrix.budget,
    locationAllowlist: matrix.locationAllowlist,
    dimensions: CATALOG.map((d) => ({
      id: d.id,
      cluster: d.cluster,
      ...matrix.dimensions[d.id],
      defaultLabel: d.defaultLabel,
    })),
    manualRubrics: matrix.manualRubrics,
  };
}

export const CHAT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_catalog",
      description: "List allowed rating dimensions from the knowledge base. Call when starting or when the user asks what can be scored.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_dimension",
      description: "Enable/disable a catalog dimension and set allowed knobs (weight, min, max, mustHave, invert, label, prefs).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          enabled: { type: "boolean" },
          weight: { type: "number" },
          label: { type: "string" },
          mustHave: { type: "boolean" },
          invert: { type: "boolean" },
          min: { type: "number" },
          max: { type: "number" },
          prefs: { type: "object", additionalProperties: true },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_budget",
      description: "Set search area, buy vs rent, neighborhood allowlist, and money caps. Default is buy (for-sale listings). Named cities go in locationAllowlist and become the live-search center (St. Petersburg + Clearwater, not Tampa). Use searchArea for the primary city/metro only when they asked for that place.",
      parameters: {
        type: "object",
        properties: {
          searchArea: { type: "string", description: "Metro / general area, e.g. Tampa, FL" },
          intent: { type: "string", enum: ["buy", "rent"], description: "buy = for-sale listings (default). rent = long-term rentals. Switching needs a new live pull." },
          maxPrice: { type: "number" },
          maxPitia: { type: "number" },
          minMonthlySlack: { type: "number" },
          downPaymentPct: { type: "number" },
          ratePct: { type: "number" },
          taxRatePct: { type: "number" },
          insuranceMonthly: { type: "number" },
          unknownPolicy: { type: "string", enum: ["skip", "penalize"] },
          locationAllowlist: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_manual_rubric",
      description: "Add a qualitative category the user scores after viewing photos. Cannot invent computed scores.",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string" },
          weight: { type: "number" },
        },
        required: ["label"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "preview_matrix",
      description: "Show the current must-haves / home profile draft.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "commit_matrix",
      description: "Save the user's must-haves (home profile) after they confirm. In replies call this their must-haves, never a matrix.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "preview_live_search",
      description:
        "Advise on the beta live-search quota (3 per user). Call when they ask to search, re-search, or how many pulls are left. Explains overlap with the cache and workarounds so they may not need to spend a pull. Does not spend a search.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_live_search",
      description:
        "Spend one of the three live searches only after the user confirms. Set confirm true when they say confirm live pull / use one of the remaining searches. If confirm is false, only return advice.",
      parameters: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            description: "True only after the user explicitly agrees to spend 1 live search.",
          },
        },
        additionalProperties: false,
      },
    },
  },
];

export function applyTool(
  matrix: UserMatrix,
  name: string,
  args: Record<string, unknown>,
  ctx?: { userId?: string }
): { matrix: UserMatrix; result: unknown; commit?: boolean; livePull?: boolean; liveSearch?: boolean } {
  switch (name) {
    case "list_catalog":
      return {
        matrix,
        result: CATALOG.map((d) => ({
          id: d.id,
          cluster: d.cluster,
          label: d.defaultLabel,
          description: d.description,
          allowedKnobs: d.allowedKnobs,
          enrichable: d.enrichable,
        })),
      };
    case "set_dimension": {
      const { id, ...patch } = args as { id: string } & Partial<DimensionKnobs>;
      const next = setDimension(matrix, id, patch);
      if ("error" in next) return { matrix, result: next };
      return { matrix: next, result: { ok: true, dimension: next.dimensions[id] } };
    }
    case "set_budget": {
      const next = setBudget(
        matrix,
        args as UserMatrix["budget"] & {
          locationAllowlist?: string[];
          searchArea?: string;
          unknownPolicy?: UnknownPolicy;
          intent?: ListingIntent;
        }
      );
      return {
        matrix: next,
        result: {
          ok: true,
          searchArea: next.searchArea,
          intent: next.intent,
          locationAllowlist: next.locationAllowlist,
          budget: next.budget,
        },
      };
    }
    case "add_manual_rubric": {
      const next = addManualRubric(matrix, String(args.label ?? "Manual"), Number(args.weight ?? 5));
      return { matrix: next, result: { ok: true, manualRubrics: next.manualRubrics } };
    }
    case "preview_matrix":
      return { matrix, result: previewMatrix(matrix) };
    case "commit_matrix": {
      const baseline = baselineStatus(matrix);
      if (!baseline.complete) {
        return {
          matrix,
          result: {
            error: "Finish baseline must-haves first (area, beds, baths, property type).",
            missing: baseline.gaps.filter((g) => !g.done),
          },
        };
      }
      return { matrix, result: { ok: true, committed: true }, commit: true };
    }
    case "preview_live_search":
    case "run_live_search": {
      if (!ctx?.userId) {
        return { matrix, result: { error: "Live search advice needs a signed-in user." } };
      }
      const advice = adviseLiveSearch(ctx.userId, queryFromMatrix(matrix));
      const confirm = Boolean(args.confirm);
      if (name === "preview_live_search" || !confirm) {
        return { matrix, result: advice };
      }
      if (advice.recommendation === "quota") {
        return { matrix, result: advice };
      }
      if (advice.recommendation === "regrade") {
        return { matrix, result: { ...advice, spent: false }, liveSearch: true };
      }
      return { matrix, result: { ...advice, spent: true }, livePull: true };
    }
    default:
      return { matrix, result: { error: `Unknown tool ${name}` } };
  }
}
