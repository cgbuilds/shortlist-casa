import { defaultMatrix } from "../kb/catalog";
import { SEED_LISTINGS } from "../data/listings";
import { grade } from "../lib/grade";
import { parseAddressFromInput } from "../lib/parse-address";
import { applyTool, ensureMatrix } from "../lib/matrix-tools";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const matrix = defaultMatrix();
const blockHome = SEED_LISTINGS.find((l) => l.id === "3308-bloomingdale-ave")!;
const frameHome = SEED_LISTINGS.find((l) => l.id === "4903-jenni-lin-dr")!;

const strong = grade(blockHome, matrix);
const weak = grade(frameHome, matrix);

assert(strong.total != null && weak.total != null, "scores exist");
assert((strong.total as number) > (weak.total as number), `block Bloomingdale should beat small frame (${strong.total} vs ${weak.total})`);
assert(weak.perDimension.find((d) => d.id === "sqft")?.score != null, "sqft scored");

const must = ensureMatrix({
  ...matrix,
  dimensions: {
    ...matrix.dimensions,
    construction: { ...matrix.dimensions.construction, mustHave: true },
  },
});
const fail = grade(frameHome, must);
assert(fail.mustHaveFailed, "frame fails block must-have");
assert(fail.band === "pass", "must-have failure is pass band");

const penalize = grade(blockHome, { ...matrix, unknownPolicy: "penalize" });
assert(penalize.total != null, "penalize still scores");

const parsed = parseAddressFromInput("https://www.zillow.com/homedetails/5913-Flatwoods-Manor-Cir-Lithia-FL-33547/123_zpid/");
assert(parsed && parsed.toLowerCase().includes("flatwoods"), `parsed address: ${parsed}`);

const tool = applyTool(matrix, "set_dimension", { id: "not_real", enabled: true });
assert("error" in (tool.result as object), "unknown dimension rejected");

const budget = applyTool(matrix, "set_budget", { maxPrice: 400000, locationAllowlist: ["Bloomingdale HS", "Hacked"] });
assert(budget.matrix.budget.maxPrice === 400000, "budget set");
assert(
  budget.matrix.locationAllowlist.includes("Bloomingdale HS") &&
    !budget.matrix.locationAllowlist.includes("Hacked"),
  "allowlist constrained"
);

console.log("grade self-test ok", { strong: strong.total, weak: weak.total, parsed });
