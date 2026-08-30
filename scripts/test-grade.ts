import { tmpdir } from "os";
import { readFileSync } from "fs";
import { join } from "path";
import { defaultMatrix } from "../kb/catalog";
import { SEED_LISTINGS } from "../data/listings";
import { runMatrixChat } from "../lib/chat";
import { grade } from "../lib/grade";
import { applyTool, ensureMatrix } from "../lib/matrix-tools";
import { parseAddressFromInput } from "../lib/parse-address";
import { parseRedfinCsv } from "../lib/redfin-csv";
import { queryFromMatrix } from "../lib/rentcast";
import { inferVibe } from "../lib/osm-amenities";
import { canReusePull, decideLivePull, liveQueryKey, rememberLivePull, adviseLiveSearch, quotaLimits, getLiveQuota, resetLiveQuotaForTests, setLiveQuotaForTests, reserveRentcastCall, RENTCAST_HARD_CAP } from "../lib/listing-cache";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  process.env.RENTCAST_QUOTA_FILE = join(tmpdir(), `rentcast-quota-test-${Date.now()}.json`);
  process.env.RENTCAST_MONTHLY_LIMIT = "999";
  process.env.RENTCAST_USER_MONTHLY_LIMIT = "3";
  resetLiveQuotaForTests();
  assert(quotaLimits().globalLimit === RENTCAST_HARD_CAP, "account cap cannot exceed 50 even if env is higher");
  assert(getLiveQuota("fresh-quota-user").remaining === 3, "new user has 3 remaining");

  const csv = readFileSync(join(process.cwd(), "data/redfin-favorites.csv"), "utf8");
  const favorites = parseRedfinCsv(csv);
  assert(favorites.length >= 35, `expected 35+ favorites, got ${favorites.length}`);
  assert(favorites.some((l) => l.city === "Valrico"), "includes Valrico");
  assert(favorites.some((l) => l.listingUrl?.includes("redfin.com")), "has Redfin URLs");

  const matrix = defaultMatrix();
  assert(matrix.locationAllowlist.length === 0, "no hardcoded areas");
  assert(!matrix.searchArea, "search area empty until chat");
  const sample = favorites.find((l) => l.address.includes("Eagle Bluff"))!;
  const g = grade(sample, matrix);
  assert(!g.mustHaveFailed, "unconfigured matrix should not fail must-haves");

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

  const blocked = applyTool(matrix, "commit_matrix", {});
  assert("error" in (blocked.result as object), "commit blocked without baseline");

  const stripped = ensureMatrix({
    locationAllowlist: ["Valrico", "Brandon", "Bloomingdale HS", "River Hills"],
  });
  assert(stripped.locationAllowlist.length === 0, "legacy areas cleared");
  assert(!stripped.searchArea, "legacy search area cleared");

  const budget = applyTool(matrix, "set_budget", {
    maxPrice: 400000,
    locationAllowlist: ["Valrico", "Hacked Place"],
  });
  assert(budget.matrix.budget.maxPrice === 400000, "budget set");
  assert(budget.matrix.locationAllowlist.includes("Valrico"), "custom city allowed");

  const metro = applyTool(matrix, "set_budget", { searchArea: "Tampa, FL" });
  assert(metro.matrix.searchArea === "Tampa, FL", "metro search area");
  assert(metro.matrix.locationAllowlist.length === 0, "metro is not a neighborhood filter");
  const tampaHome = { ...sample, city: "Valrico", state: "FL" };
  const tampaGrade = grade(tampaHome, metro.matrix);
  const areaDim = tampaGrade.perDimension.find((d) => d.id === "school_area");
  assert(areaDim?.enabled, "area scoring on after search area");
  assert(!areaDim?.mustHaveFailed, "Valrico still in Tampa metro");

  let liveMx = applyTool(matrix, "set_budget", { searchArea: "Tampa, FL" }).matrix;
  liveMx = applyTool(liveMx, "set_dimension", { id: "beds", enabled: true, min: 3 }).matrix;
  liveMx = applyTool(liveMx, "set_dimension", { id: "baths", enabled: true, min: 2 }).matrix;
  liveMx = applyTool(liveMx, "set_dimension", { id: "property_type", enabled: true, prefs: { prefer: "sfr" } }).matrix;
  const liveQ = queryFromMatrix(liveMx);
  assert(liveQ.address === "Tampa, FL", "live search centers on metro");
  assert(liveQ.radius === 22, "metro uses a radius, not Tampa-city-only");
  assert(liveQ.minBeds === 3, "beds from baseline");
  assert(liveQ.propertyType === "Single Family", "maps sfr to RentCast type");
  const valricoQ = queryFromMatrix(
    applyTool(liveMx, "set_budget", { searchArea: "Tampa, FL", locationAllowlist: ["Valrico"] }).matrix
  );
  assert(valricoQ.city === "Valrico", "named city is a tight search");
  assert(valricoQ.radius == null, "no metro radius when a city is named");

  process.env.RENTCAST_USER_MONTHLY_LIMIT = "3";
  assert(quotaLimits().userLimit === 3, "beta default is 3 live searches");

  const wide = { address: "Tampa, FL", radius: 22, state: "FL", minBeds: 2, maxPrice: 600000, propertyType: "Single Family" };
  const tight = { ...wide, minBeds: 3, maxPrice: 400000 };
  assert(liveQueryKey(wide) !== liveQueryKey(tight), "query keys differ when floors change");
  assert(canReusePull(wide, tight), "tighter beds/price can reuse a wider pull");
  assert(!canReusePull(tight, wide), "wider beds/price needs a new pull");
  rememberLivePull("cache-user", wide, [sample]);
  const cachedHit = decideLivePull("cache-user", tight, false);
  assert(cachedHit.action === "cache", "fresh cache is reused on Search & grade");
  const forced = decideLivePull("cache-user", tight, true);
  assert(forced.action === "fetch", "confirmed extra pull ignores cache when quota remains");
  const widenNeed = decideLivePull("cache-user", { ...wide, address: "Orlando, FL" }, false);
  assert(widenNeed.action === "confirm", "widening area waits for the user to spend 1 of 3");

  const twoBed = { ...sample, id: "two-bed", beds: 2, listPrice: 350000 };
  const threeBed = { ...sample, id: "three-bed", beds: 3, listPrice: 350000 };
  rememberLivePull("cov-user", wide, [twoBed, threeBed]);
  const overlap = adviseLiveSearch("cov-user", tight);
  assert(overlap.recommendation === "regrade", "tighter search re-grades cache");
  assert(overlap.coveragePct === 50, `coverage should be 50, got ${overlap.coveragePct}`);
  const newArea = adviseLiveSearch("cache-user", { ...wide, address: "Orlando, FL" });
  assert(newArea.recommendation === "confirm-pull", "new area needs a confirmed pull");
  assert(newArea.advice.includes("cached"), "advice mentions cache overlap");

  const preview = applyTool(liveMx, "preview_live_search", {}, { userId: "chat-live-user" });
  assert((preview.result as { recommendation: string }).recommendation === "first-pull", "first pull advice");
  const confirmed = applyTool(liveMx, "run_live_search", { confirm: true }, { userId: "chat-live-user" });
  assert(confirmed.livePull, "explicit confirm spends a pull when there is no cache");

  setLiveQuotaForTests({ globalUsed: RENTCAST_HARD_CAP });
  assert(!reserveRentcastCall(), "51st RentCast HTTP call is refused");
  assert(getLiveQuota("fresh-quota-user").globalRemaining === 0, "no account remaining at 50");
  const atCap = decideLivePull("cache-user", tight, true);
  assert(atCap.action !== "fetch", "never fetch live listings after the 50-call hard cap");
  const capAdvice = adviseLiveSearch("no-cache-cap-user", wide);
  assert(capAdvice.recommendation === "quota", "chat treats the 50-call cap as quota");
  resetLiveQuotaForTests();
  rememberLivePull("cache-user", wide, [sample]);
  rememberLivePull("cov-user", wide, [twoBed, threeBed]);

  assert(inferVibe(2, 8) === "local_center", "shops + café = local center");
  assert(inferVibe(0, 1) === "sleepy", "few shops = sleepy");
  assert(inferVibe(12, 40) === "busy", "dense POIs = busy");

  const vibeMx = applyTool(matrix, "set_dimension", {
    id: "neighborhood_vibe",
    enabled: true,
    prefs: { prefer: "local_center" },
  }).matrix;
  const centerHome = {
    ...sample,
    facts: { ...sample.facts, cafeCount: 2, shopCount: 8, neighborhoodVibe: "local_center" as const },
  };
  const vibeScore = grade(centerHome, vibeMx).perDimension.find((d) => d.id === "neighborhood_vibe");
  assert(vibeScore?.score === 100, "local center matches");

  const coffeeMx = applyTool(matrix, "set_dimension", {
    id: "local_amenities",
    enabled: true,
    mustHave: true,
    prefs: { requireCoffee: true, requireShops: true },
  }).matrix;
  const noCafe = grade(
    { ...sample, facts: { ...sample.facts, cafeCount: 0, shopCount: 8 } },
    coffeeMx
  );
  assert(noCafe.perDimension.find((d) => d.id === "local_amenities")?.mustHaveFailed, "no café fails coffee must");

  const aeHome = { ...sample, facts: { ...sample.facts, floodZone: "AE", sfha: true } };
  const avoidAe = applyTool(matrix, "set_dimension", {
    id: "flood",
    enabled: true,
    mustHave: true,
    prefs: { acceptSfha: false },
  }).matrix;
  assert(grade(aeHome, avoidAe).perDimension.find((d) => d.id === "flood")?.mustHaveFailed, "AE fails avoid-SFHA");
  const acceptAe = applyTool(matrix, "set_dimension", {
    id: "flood",
    enabled: true,
    mustHave: false,
    prefs: { acceptSfha: true },
  }).matrix;
  assert(!grade(aeHome, acceptAe).perDimension.find((d) => d.id === "flood")?.mustHaveFailed, "AE allowed when accepted");
  const drainMx = applyTool(acceptAe, "set_dimension", { id: "flood_resilience", enabled: true, mustHave: true }).matrix;
  const ponded = grade(
    { ...sample, facts: { ...sample.facts, drainageQuality: "poor", streetFlooding: true } },
    drainMx
  );
  assert(ponded.mustHaveFailed, "sewage/ponding fails drainage must");

  const soft = await runMatrixChat(
    matrix,
    [],
    "walk to local shops and a great coffee shop. in a flood zone but I don't want sewage backup every time it rains"
  );
  assert(soft.matrix.dimensions.neighborhood_vibe.enabled, "vibe on");
  assert(soft.matrix.dimensions.local_amenities.prefs?.requireCoffee, "coffee required");
  assert(soft.matrix.dimensions.flood.prefs?.acceptSfha, "FEMA AE accepted");
  assert(soft.matrix.dimensions.flood_resilience.mustHave, "drainage must");

  const mom = await runMatrixChat(
    matrix,
    [],
    "Tampa, FL. townhouse w/ garage or 3 floors or less to avoid special assessments, preferably end unit, min bedroom 2+, 2 bath plus, in unit washer/dryer, long term, walkable, not highly susceptible to flooding. commit"
  );
  assert(mom.matrix.searchArea.toLowerCase().includes("tampa"), "search area from chat");
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
