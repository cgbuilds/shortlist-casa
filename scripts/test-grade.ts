import { tmpdir } from "os";
import { readFileSync } from "fs";
import { join } from "path";
import { defaultMatrix } from "../kb/catalog";
import { SEED_LISTINGS } from "../data/listings";
import { runMatrixChat } from "../lib/chat";
import { bandFor, grade, gradeCaption, explainGrade, takeTopListings, wordCount } from "../lib/grade";
import { applyTool, ensureMatrix } from "../lib/matrix-tools";
import { parseAddressFromInput } from "../lib/parse-address";
import { parseRedfinCsv } from "../lib/redfin-csv";
import { queryFromMatrix } from "../lib/rentcast";
import { inferVibe } from "../lib/osm-amenities";
import { rankListings, resultsHeadline, scoreStatusLabel } from "../lib/rank-listings";
import { canReusePull, decideLivePull, liveQueryKey, rememberLivePull, adviseLiveSearch, quotaLimits, getLiveQuota, resetLiveQuotaForTests, setLiveQuotaForTests, reserveRentcastCall, RENTCAST_HARD_CAP, filterListingsByQuery, grantCourtesySearch, isPoliteExtraSearchAsk } from "../lib/listing-cache";
import { outboundListingLinks } from "../lib/outbound-links";
import { starterMatrix } from "../lib/starter-profile";
import { wantsRescore } from "../lib/chat-intent";

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
  assert(matrix.intent === "buy", "default is buy");
  const sample = favorites.find((l) => l.address.includes("Eagle Bluff"))!;
  const g = grade(sample, matrix);
  assert(!g.mustHaveFailed, "unconfigured matrix should not fail must-haves");
  assert(g.band === "incomplete", "empty matrix is incomplete, not a fake pass");
  assert(g.incompleteReason, "incomplete explains why");
  assert(g.why && wordCount(g.why) > 15, "grade why is more than 15 words");
  assert(!/because the overall score is/i.test(g.why), "why is not circular about the score");
  assert(takeTopListings(Array.from({ length: 14 }, (_, i) => i)).length === 10, "list is capped at 10");

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
  assert(fail.why && wordCount(fail.why) > 15, "miss grade why is more than 15 words");
  assert(!/because the overall score is/i.test(fail.why), "miss why is not circular");

  const whyDims = [
    { id: "baths", label: "Baths", enabled: true, weight: 8, score: 100, unknown: false, mustHaveFailed: false, reason: "2.5 baths (min 2)" },
    { id: "walkable", label: "Walkable", enabled: true, weight: 8, score: 100, unknown: false, mustHaveFailed: false, reason: "Walkable (3 cafés, 8 shops nearby)" },
    { id: "school_area", label: "Area", enabled: true, weight: 8, score: 20, unknown: false, mustHaveFailed: false, reason: "HEATHER BAY CONDO TWNHMS is outside named neighborhoods" },
    { id: "property_type", label: "Type", enabled: true, weight: 10, score: 40, unknown: false, mustHaveFailed: false, reason: "townhouse (prefer condo)" },
  ];
  const whyOpts = { band: "good" as const, total: 74, mustHaveFailed: false, perDimension: whyDims };
  const whyLorraine = explainGrade(
    { ...sample, id: "lorraine", address: "429 Lorraine Leland St", city: "Dunedin", beds: 2, listPrice: 262500, facts: { ...sample.facts, propertyType: "townhouse" } },
    whyOpts
  );
  const whyLusara = explainGrade(
    { ...sample, id: "lusara", address: "553 Lusara Ct", city: "Dunedin", beds: 2, listPrice: 359000, facts: { ...sample.facts, propertyType: "townhouse" } },
    whyOpts
  );
  assert(whyLorraine !== whyLusara, "similar homes get different blurbs");
  assert(
    explainGrade(
      { ...sample, id: "lorraine", address: "429 Lorraine Leland St", city: "Dunedin", beds: 2, listPrice: 262500, facts: { ...sample.facts, propertyType: "townhouse" } },
      whyOpts
    ) === whyLorraine,
    "blurb is stable for the same listing"
  );

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
  assert(liveQ.market === "sale", "live search defaults to for-sale");
  const rentQ = queryFromMatrix(applyTool(liveMx, "set_budget", { intent: "rent" }).matrix);
  assert(rentQ.market === "rental", "rent uses the rental feed");
  assert(!canReusePull(liveQ, rentQ), "buy vs rent needs a new live pull");
  const rentalRow = { ...sample, id: "rental-condo", listPrice: 2400, status: "For Rent", market: "rental" as const };
  assert(
    filterListingsByQuery([sample, rentalRow], liveQ).every((l) => l.id !== "rental-condo"),
    "rent-priced condos drop from a buy search"
  );
  const zillowSale = outboundListingLinks(sample).find((l) => l.name === "Zillow")?.href ?? "";
  assert(zillowSale.includes("/for_sale/"), `Zillow buy link should be for_sale, got ${zillowSale}`);
  const zillowRent = outboundListingLinks(rentalRow).find((l) => l.name === "Zillow")?.href ?? "";
  assert(zillowRent.includes("/for_rent/"), "Zillow rent link should be for_rent");
  const valricoQ = queryFromMatrix(
    applyTool(liveMx, "set_budget", { searchArea: "Tampa, FL", locationAllowlist: ["Valrico"] }).matrix
  );
  assert(valricoQ.city === "Valrico", "named city is a tight search");
  assert(valricoQ.radius == null, "no metro radius when a city is named");
  const pinellasMx = applyTool(liveMx, "set_budget", {
    searchArea: "Tampa, FL",
    locationAllowlist: ["St. Pete", "Clearwater"],
  }).matrix;
  const pinellasQ = queryFromMatrix(pinellasMx);
  assert(pinellasQ.address?.includes("St. Petersburg"), `Pinellas live search should center St. Pete, got ${pinellasQ.address}`);
  assert(pinellasQ.radius === 14, "two named cities use a local radius, not Tampa 22mi");
  assert(!pinellasQ.city || pinellasQ.city !== "Tampa", "do not city-filter Tampa when St Pete is named");
  const stPeteHome = { ...sample, city: "Saint Petersburg", state: "FL" };
  const stPeteGrade = grade(stPeteHome, pinellasMx).perDimension.find((d) => d.id === "school_area");
  assert(!stPeteGrade?.mustHaveFailed, "Saint Petersburg matches St. Pete allowlist");
  const tampaOnly = grade({ ...sample, city: "Tampa", state: "FL" }, pinellasMx).perDimension.find((d) => d.id === "school_area");
  assert(tampaOnly?.score === 20, "Tampa city scores low against St Pete/Clearwater allowlist");
  assert(!tampaOnly?.mustHaveFailed, "location scoring is not a silent must-have cut");

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

  assert(isPoliteExtraSearchAsk("please can i get another search"), "please + another search");
  assert(isPoliteExtraSearchAsk("Could I please have one more live search?"), "please one more live search");
  assert(!isPoliteExtraSearchAsk("give me another search"), "no please, no bonus");
  assert(!isPoliteExtraSearchAsk("please confirm live pull"), "ordinary confirm is not a bonus ask");
  setLiveQuotaForTests({ userId: "polite-user", used: 3 });
  assert(getLiveQuota("polite-user").remaining === 0, "standard 3 are spent");
  setLiveQuotaForTests({ userId: "rude-user", used: 3 });
  const rude2 = await runMatrixChat(liveMx, [], "give me another search", { userId: "rude-user" });
  assert(!rude2.livePull, "demanding another search does not add quota");
  assert(getLiveQuota("rude-user").remaining === 0, "demanding ask stays at 0");
  const polite = await runMatrixChat(liveMx, [], "please can i get another search", { userId: "polite-user" });
  assert(polite.livePull, "polite ask runs a live search");
  assert(getLiveQuota("polite-user").remaining === 1, "one courtesy search is available");
  assert(grantCourtesySearch("polite-user"), "already-granted courtesy still has the leftover search");
  setLiveQuotaForTests({ userId: "polite-user", used: 4 });
  assert(getLiveQuota("polite-user").remaining === 0, "courtesy is spent after the extra pull");
  assert(!grantCourtesySearch("polite-user"), "no second courtesy after it is spent");
  const politeAgain = await runMatrixChat(liveMx, [], "please can i get another search", { userId: "polite-user" });
  assert(!politeAgain.livePull, "second polite ask does not add a fifth search");
  setLiveQuotaForTests({ globalUsed: RENTCAST_HARD_CAP, userId: "cap-polite", used: 3 });
  const politeCap = await runMatrixChat(liveMx, [], "please can i get another search", { userId: "cap-polite" });
  assert(!politeCap.livePull, "courtesy cannot exceed the 50-call account cap");
  assert(!/please|polite|courtesy|hidden|secret/i.test(polite.reply + politeAgain.reply), "reply does not explain the bonus");
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

  assert(bandFor(94, false) === "superb", "90+ is superb");
  assert(bandFor(82, false) === "excellent", "80s are excellent");
  assert(bandFor(70, false) === "good", "mid 60-79 is good");
  assert(bandFor(51, false) === "pass", "meets must-haves is pass");
  assert(bandFor(88, true) === "miss", "must-have fail is miss");
  assert(gradeCaption({ total: 82, band: "excellent", mustHaveFailed: false }).word === "excellent", "caption word");
  assert(gradeCaption({ total: 82, band: "excellent", mustHaveFailed: false }).score === "82", "caption shows score");

  const soft = await runMatrixChat(
    matrix,
    [],
    "walk to local shops and a great coffee shop. in a flood zone but I don't want sewage backup every time it rains"
  );
  assert(soft.matrix.dimensions.neighborhood_vibe.enabled, "vibe on");
  assert(soft.matrix.dimensions.local_amenities.prefs?.requireCoffee, "coffee required");
  assert(!soft.matrix.dimensions.local_amenities.mustHave, "coffee is scored unless they say must");
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

  const rentChat = await runMatrixChat(matrix, [], "I want to rent a condo");
  assert(rentChat.matrix.intent === "rent", "chat can switch to rent");

  const starter = starterMatrix();
  assert(starter.searchArea === "Tampa, FL", "starter area is Tampa");
  assert(starter.dimensions.beds.min === 3, "starter beds 3");
  assert(starter.dimensions.baths.min === 2, "starter baths 2");
  assert(starter.dimensions.property_type.prefs?.prefer === "sfr", "starter type is SFR");

  assert(resultsHeadline(10, 50) === "Showing the top 10 of 50 by score", "list header is top N of M by score");
  assert(resultsHeadline(8, 8) === "Showing 8 by score", "short list has no top-N clip");
  assert(resultsHeadline(0, 0) === "No homes yet", "empty list header");

  const ticks: { analyzed: number; processing: number; totalMatched: number }[] = [];
  const batch = await rankListings(favorites.slice(0, 7), matrix, (p) => {
    ticks.push({ analyzed: p.analyzed, processing: p.processing, totalMatched: p.totalMatched });
  });
  assert(batch.length === 7, "rankListings scores every home");
  assert(ticks[0]?.analyzed === 0, "progress starts at 0 scored");
  assert(ticks.at(-1)?.analyzed === 7 && ticks.at(-1)?.processing === 0, "progress ends when all are scored");
  assert(ticks.every((t) => t.totalMatched === 7), "header total stays the full list size while scoring");
  assert(scoreStatusLabel({ analyzed: 20, total: 23, processing: 3 }) === "20/23 scored, 3 processing…", "scoring status copy");
  assert(wantsRescore("score the list"), "score the list is a rescore ask");
  assert(wantsRescore("please rescore"), "rescore is a rescore ask");
  assert(!wantsRescore("pull live listings in Tampa"), "live pull is not a rescore ask");

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
