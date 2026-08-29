import { readFileSync } from "fs";
import { join } from "path";
import { defaultMatrix } from "../kb/catalog";
import { SEED_LISTINGS } from "../data/listings";
import { runMatrixChat } from "../lib/chat";
import { grade } from "../lib/grade";
import { applyTool, ensureMatrix } from "../lib/matrix-tools";
import { parseAddressFromInput } from "../lib/parse-address";
import { parseRedfinCsv } from "../lib/redfin-csv";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const csv = readFileSync(join(process.cwd(), "data/redfin-favorites.csv"), "utf8");
  const favorites = parseRedfinCsv(csv);
  assert(favorites.length >= 35, `expected 35+ favorites, got ${favorites.length}`);
  assert(favorites.some((l) => l.city === "Valrico"), "includes Valrico");
  assert(favorites.some((l) => l.listingUrl?.includes("redfin.com")), "has Redfin URLs");

  const matrix = defaultMatrix();
  const sample = favorites.find((l) => l.address.includes("Eagle Bluff"))!;
  const g = grade(sample, matrix);
  assert(g.total != null, "favorites grade");
  assert(!g.mustHaveFailed, "2+ bed/bath SFR should not fail mom defaults");

  const constructionOn = ensureMatrix({
    ...matrix,
    dimensions: {
      ...matrix.dimensions,
      construction: { enabled: true, weight: 14, mustHave: true, prefs: { prefer: "block" } },
    },
  });
  const frameHome = SEED_LISTINGS.find((l) => l.id === "4903-jenni-lin-dr")!;
  const fail = grade(frameHome, constructionOn);
  assert(fail.mustHaveFailed, "frame fails block must-have");

  const parsed = parseAddressFromInput(
    "https://www.zillow.com/homedetails/5913-Flatwoods-Manor-Cir-Lithia-FL-33547/123_zpid/"
  );
  assert(parsed && parsed.toLowerCase().includes("flatwoods"), `parsed address: ${parsed}`);

  const tool = applyTool(matrix, "set_dimension", { id: "not_real", enabled: true });
  assert("error" in (tool.result as object), "unknown dimension rejected");

  const budget = applyTool(matrix, "set_budget", {
    maxPrice: 400000,
    locationAllowlist: ["Valrico", "Hacked Place"],
  });
  assert(budget.matrix.budget.maxPrice === 400000, "budget set");
  assert(budget.matrix.locationAllowlist.includes("Valrico"), "custom city allowed");

  const mom = await runMatrixChat(
    matrix,
    [],
    "townhouse w/ garage or 3 floors or less to avoid special assessments, preferably end unit, min bedroom 2+, 2 bath plus, in unit washer/dryer, long term, walkable, not highly susceptible to flooding. commit"
  );
  assert(mom.matrix.dimensions.stories.max === 3, "stories max 3");
  assert(mom.matrix.dimensions.laundry.mustHave, "laundry must");
  assert(mom.matrix.dimensions.flood.enabled, "flood on");
  assert(mom.commit, "committed");

  console.log("grade self-test ok", {
    favorites: favorites.length,
    sample: g.total,
    parsed,
    mom: mom.reply.slice(0, 180),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
