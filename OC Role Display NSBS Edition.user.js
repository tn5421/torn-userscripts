// ==UserScript==
// @name         OC Role Display - NSBS Edition
// @namespace    com.neopolitan.OcRoleDisplay
// @version      1.2.0
// @description  Displays OC role contribution weights and shows if you would be a good fit in a particular OC
// @author       Ibbyz [229585], Neopolitan [276835]
// @match        https://www.torn.com/factions.php?step=your*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @connect      tornprobability.com
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/tn5421/torn-userscripts/refs/heads/main/OC%20Role%20Display%20NSBS%20Edition.user.js
// @updateURL    https://raw.githubusercontent.com/tn5421/torn-userscripts/refs/heads/main/OC%20Role%20Display%20NSBS%20Edition.user.js
// ==/UserScript==

(function() {
    'use strict';

    const API_URL = "https://tornprobability.com:3000/api/GetRoleWeights";
    const CACHE_KEY = "oc_role_display_weights_v1";
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
    const API_TIMEOUT_MS = 5000;
    const API_RETRY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
    const ROOT_CHECK_DELAY_MS = 250;

    let weightsCache = null;
    let memoryCacheOnly = false;
    let weightsFetchInFlight = false;
    let retryWeightsAt = 0;
    let weightsTimer = null;

    let crimesObserver = null;
    let observedCrimesRoot = null;
    let rootTimer = null;
    let panelFrame = null;
    const pendingPanels = new Set();

    const style = document.createElement('style');
    style.textContent = `
    @keyframes oc-nsbs-pulse {
        0%, 100% { box-shadow: 0 0 8px red; }
        50% { box-shadow: 0 0 18px red; }
    }

    .oc-nsbs-below { background-color: #ff000061 !important; }
    .oc-nsbs-eligible { background-color: #21a61c61 !important; }
    .oc-nsbs-low-occupied { outline: 4px solid red; outline-offset: 0; }
    .oc-nsbs-active .oc-nsbs-low-occupied { animation: oc-nsbs-pulse 1s infinite; }

    /* Match Torn's disabled Join look in light and dark mode without changing its native button state. */
    button.torn-btn[data-oc-nsbs-blocked]:enabled {
        cursor: not-allowed !important;
        opacity: 1 !important;
        background: linear-gradient(to bottom, #e5e5e5, #ccc) !important;
        color: #888 !important;
        border-color: #bbb !important;
        box-shadow: none !important;
        text-shadow: none !important;
    }

    body.dark-mode button.torn-btn[data-oc-nsbs-blocked]:enabled {
        background: linear-gradient(to bottom, #000, #313131) !important;
        color: #555 !important;
        border-color: transparent !important;
    }

    button.torn-btn[data-oc-nsbs-blocked]:enabled span {
        color: inherit !important;
        text-shadow: none !important;
    }

    .oc-has-contrib {
        position: relative !important;
        padding-bottom: 22px !important;
        overflow: visible !important;
    }

    .oc-contrib-linewrap {
        position: absolute !important;
        left: 8px !important;
        right: 8px !important;
        bottom: 2px !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        pointer-events: none !important;
        z-index: 1 !important;
    }

    .oc-contrib-linewrap::before,
    .oc-contrib-linewrap::after {
        content: "";
        flex: 1;
        height: 1px;
        background: rgba(0,156,255,0.95);
    }

    .oc-contrib-linetext {
        font-weight: 900;
        font-size: 12px;
        color: rgba(0,136,235,0.95);
        line-height: 1;
        padding: 0 2px;
    }
    `;

    // Fallback snapshot from AllenOne GetRoleWeights, 2026-11-24.
    // Live/cached values take priority for each crime/role when available.
    const roleContributions = {
        "MobMentality": {"Looter1": 33.96650646, "Looter2": 26.48850715, "Looter3": 18.36444021, "Looter4": 21.18054618},
        "PetProject": {"Kidnapper": 30.92676727, "Muscle": 32.62884615, "Picklock": 36.44438658},
        "FirstAidAndAbet": {"Picklock": 26.040303247907904, "Decoy": 30.73072727408889, "Pickpocket": 43.228969478003215},
        "CashMeIfYouCan": {"Thief1": 54.18134868, "Thief2": 28.04221236, "Lookout": 17.77643896},
        "BestOfTheLot": {"Picklock": 20.73368395, "CarThief": 19.5328795, "Muscle": 43.67657367, "Imitator": 16.05686289},
        "MarketForces": {"Enforcer": 29.4020952, "Negotiator": 27.22899702, "Lookout": 16.36647471, "Arsonist": 4.456390991, "Muscle": 22.54604208},
        "SmokeAndWingMirrors": {"CarThief": 50.89511253, "Imitator": 27.10752487, "Hustler1": 9.000400474, "Hustler2": 12.99696212},
        "GaslightTheWay": {"Imitator1": 9.394999578, "Imitator2": 27.46467248, "Imitator3": 41.32194207, "Looter1": 9.394999578, "Looter2": -0.0003562738035, "Looter3": 12.42374256},
        "StageFright": {"Enforcer": 15.67090339, "Muscle1": 20.01365691, "Muscle2": 2.659259022, "Muscle3": 9.165081208, "Lookout": 6.188888612, "Sniper": 46.30221086},
        "SnowBlind": {"Hustler": 48.40533937, "Imitator": 34.56895649, "Muscle1": 8.512932288, "Muscle2": 8.512771845},
        "PluckingTheLotusPetal": {"Robber1": 14.027682053942709, "Hustler": 14.394494084394903, "Robber2": 23.680942608167083, "Muscle": 47.89688125349531},
        "LeaveNoTrace": {"Techie": 29.01099583, "Negotiator": 34.1307307, "Imitator": 36.85827347},
        "NoReserve": {"CarThief": 30.50667524, "Techie": 38.37053402, "Engineer": 31.12279075},
        "CounterOffer": {"Robber": 35.94505104, "Looter": 6.998750427, "Hacker": 12.1275068, "Picklock": 16.5353262, "Engineer": 28.39336554},
        "GuardianAngels": {"Enforcer": 27.404376861170505, "Hustler": 42.10252351813381, "Engineer": 30.49309962016114},
        "HoneyTrap": {"Enforcer": 26.98428598, "Muscle1": 30.86556191, "Muscle2": 42.15015211},
        "BiddingWar": {"Robber1": 7.100963041, "Driver": 12.5356157, "Robber2": 22.87302433, "Robber3": 31.67051915, "Bomber1": 7.846987259, "Bomber2": 17.97289051},
        "SneakyGitGrab": {"Imitator": 17.539756110007634, "Pickpocket": 50.831934101247086, "Hacker": 14.481791981545502, "Techie": 17.146517807199775},
        "BlastFromThePast": {"Picklock1": 10.84876785, "Hacker": 12.05662038, "Engineer": 24.0155975, "Bomber": 15.61710346, "Muscle": 34.58815764, "Picklock2": 2.873753178},
        "BreakTheBank": {"Robber": 12.69693448, "Muscle1": 13.51973049, "Muscle2": 10.10353513, "Thief1": 2.930695727, "Muscle3": 31.65263066, "Thief2": 29.09647352},
        "StackingTheDeck": {"CatBurglar": 23.43294188, "Driver": 2.956670602, "Hacker": 25.43825688, "Imitator": 48.17213064},
        "ClinicalPrecision": {"Imitator": 43.31533431, "CatBurglar": 18.93905648, "Assassin": 16.0581518, "Cleaner": 21.68745741},
        "ManifestCruelty": {"Hacker": 16.32001273063874, "Interrogator": 23.492099324887565, "Reviver": 46.27406770738405, "CatBurglar": 13.913820237089643},
        "LockStock": {"Assassin": 40.26601835937421, "Smuggler": 17.442378565297464, "Hacker": 18.407618259403492, "Muscle1": 11.941992407962427, "Muscle2": 11.941992407962427},
        "AceInTheHole": {"Imitator": 21.07540412, "Muscle1": 18.29831955, "Muscle2": 24.65084339, "Hacker": 28.3434151, "Driver": 7.632017841},
        "GoneFission": {"Hijacker": 24.93974876222353, "Engineer": 15.565232594311826, "Pickpocket": 16.53377808965346, "Imitator": 24.93974876222354, "Bomber": 18.021491791587643},
        "HostileTakeover": {"Hacker": 11.154471089082223, "Engineer": 15.240409558114203, "CatBurglar": 16.003004887681396, "Kidnapper": 12.980809844427426, "Negotiator": 23.952564641966315, "Muscle": 20.668739978728432},
        "ClearedforTakeoff": {"Imitator": 24.939007667714826, "Techie": 11.316435057348194, "Pickpocket": 12.032038349844655, "Lookout": 8.372798960106097, "Assassin": 18.15580375759352, "Interrogator": 25.183916207392716},
        "ShipHappens": {"Engineer": 13.3450564176806, "Interrogator": 31.268710977282005, "Hustler": 19.686770299703376, "Spy": 25.419779346520315, "Assassin": 10.2796829588137},
        "CraneReaction": {"Sniper": 40.73886856841122, "Lookout": 16.623960934255475, "Engineer": 8.286087919744741, "Bomber": 15.8901690506963, "Muscle1": 10.683294142974866, "Muscle2": 7.777619383917385},
        "WindowOfOpportunity": {"Engineer": 14.55335487209706, "Looter1": 19.544697437213543, "Looter2": 25.802321762790502, "Muscle1": 23.086816638821606, "Muscle2": 17.012809289077286},
        "ThouShaltNotSteal": {"Thief": 12.396646686195815, "Pickpocket": 37.856826197979196, "Picklock": 49.74652711582499},
        "DisorderlyConduct": {"Vandal": 24.80912925856699, "Arsonist": 27.744021103582305, "Muscle": 17.464115251029245, "Looter": 29.982734386821452},
        "DishItOut": {"Assassin": 37.3380808914086, "Muscle": 25.243817634035594, "Saboteur1": 14.639223669899579, "Saboteur2": 8.911747057590532, "Engineer": 13.867130747065687}
    };

    const defaultLevel = 70;

    const ocRoles = [
        {
            OCName: "Mob Mentality", // Level 1
            Positions: { // 76.04% success rate
                "Looter #1": 68,
                "Looter #2": 68,
                "Looter #3": 68,
                "Looter #4": 68
            }
        },
        {
            OCName: "Thou Shalt Not Steal", // Level 2
            Positions: { // 75.33% success rate
                "Picklock": 71,
                "Pickpocket": 71,
                "Thief": 65
            }
        },
        {
            OCName: "Cash Me if You Can", // Level 2
            Positions: { // 75.15% success rate
                "Thief #1": 70,
                "Lookout": 68,
                "Thief #2": 68
            }
        },
        {
            OCName: "Smoke and Wing Mirrors", // Level 3
            Positions: { // 75.19% success rate
                "Car Thief": 72,
                "Imitator": 71,
                "Hustler #2": 66,
                "Hustler #1": 64
            }
        },
        {
            OCName: "Gaslight the Way", // Level 3
            Positions: { // 75.13% success rate
                "Imitator #3": 72,
                "Imitator #2": 71,
                "Looter #3": 68,
                "Imitator #1": 64,
                "Looter #1": 66,
                "Looter #2": 30
            }
        },
        {
            OCName: "Market Forces", // Level 3
            Positions: { // 75.00% success rate
                "Enforcer": 71,
                "Negotiator": 70,
                "Muscle": 69,
                "Lookout": 65,
                "Arsonist": 55
            }
        },
        {
            OCName: "Stage Fright", // Level 4
            Positions: { // 75.16% success rate
                "Sniper": 75,
                "Muscle #1": 72,
                "Enforcer": 72,
                "Muscle #3": 62,
                "Lookout": 60,
                "Muscle #2": 50
            }
        },
        {
            OCName: "Snow Blind", // Level 4
            Positions: { // 75.05% success rate
                "Hustler": 71,
                "Imitator": 71,
                "Muscle #1": 64,
                "Muscle #2": 64
            }
        },
        {
            OCName: "Plucking the Lotus Petal", // Level 4
            Positions: { // 75.36% success rate
                "Muscle": 73,
                "Robber #2": 71,
                "Hustler": 65,
                "Robber #1": 65
            }
        },
        {
            OCName: "Honey Trap", // Level 5 (Formerly Level 6)
            Positions: { // 75.15% success rate
                "Muscle #2": 72,
                "Muscle #1": 69,
                "Enforcer": 67
            }
        },
        {
            OCName: "Guardian Angels", // Level 5 (accent-insensitive matching covers "Guardian Ángels" too)
            Positions: { // 75.44% success rate
                "Hustler": 70,
                "Engineer": 68,
                "Enforcer": 67
            }
        },
        {
            OCName: "Counter Offer", // Level 5
            Positions: { // 75.07% success rate
                "Robber": 72,
                "Engineer": 70,
                "Picklock": 68,
                "Hacker": 64,
                "Looter": 60
            }
        },
        {
            OCName: "No Reserve", // Level 5 -> Bidding War
            Positions: { // 83.24% success rate, 60.22% chain success rate
                "Techie": 75,
                "Engineer": 75,
                "Car Thief": 75
            }
        },
        {
            OCName: "Leave No Trace", // Level 6
            Positions: { // 75.19% success rate
                "Imitator": 70,
                "Negotiator": 70,
                "Techie": 64
            }
        },
        {
            OCName: "Bidding War", // Level 6
            Positions: { // 72.35% success rate, 60.22% chain success rate
                // (No Reserve success rate) x (Bidding War success rate) = overall success rate
                "Robber #3": 69,
                "Robber #2": 69,
                "Bomber #2": 69,
                "Driver": 65,
                "Bomber #1": 65,
                "Robber #1": 65
            }
        },
        {
            OCName: "Sneaky Git Grab", // Level 6
            Positions: { // 75.06% success rate
                "Pickpocket": 73,
                "Imitator": 69,
                "Techie": 68,
                "Hacker": 67
            }
        },
        {
            OCName: "Dish It Out", // Level 6
            Positions: { // 75.21% success rate
                "Assassin": 72,
                "Muscle": 71,
                "Saboteur #1": 68,
                "Engineer": 68,
                "Saboteur #2": 64
            }
        },
        {
            OCName: "Window of Opportunity", // Level 7
            Positions: { // 77.89% success rate
                "Looter #2": 72,
                "Muscle #1": 72,
                "Looter #1": 72,
                "Muscle #2": 71,
                "Engineer": 71
            }
        },
        {
            OCName: "Blast From The Past", // Level 7
            Positions: { // 75.02% success rate
                "Muscle": 74,
                "Engineer": 73,
                "Bomber": 70,
                "Picklock #1": 70,
                "Hacker": 70,
                "Picklock #2": 63
            }
        },
        {
            OCName: "Cleared for Takeoff", // Level 7
            Positions: { // 75.42% success rate
                "Interrogator": 70,
                "Imitator": 70,
                "Assassin": 70,
                "Pickpocket": 68,
                "Techie": 68,
                "Lookout": 68
            }
        },
        {
            OCName: "Clinical Precision", // Level 8
            Positions: { // 75.11% success rate
                "Imitator": 71,
                "Cleaner": 71,
                "Cat Burglar": 71,
                "Assassin": 66
            }
        },
        {
            OCName: "Ship Happens", // Level 8
            Positions: { // ~72-73% estimated success rate
                "Interrogator": 68,
                "Spy": 68,
                "Hustler": 68,
                "Engineer": 65,
                "Assassin": 64
            }
        },
        {
            OCName: "Break the Bank", // Level 8
            Positions: { // 70.43% success rate
                "Muscle #3": 67,
                "Thief #2": 66,
                "Muscle #1": 65,
                "Robber": 65,
                "Muscle #2": 63,
                "Thief #1": 60
            }
        },
        {
            OCName: "Stacking the Deck", // Level 8 -> Ace in the Hole
            Positions: { // 82.70% success rate, xx.xx% chain success rate
                "Imitator": 76,
                "Hacker": 74,
                "Cat Burglar": 73,
                "Driver": 64
            }
        },
        { // These numbers are just placeholders, replace when more information is known
            OCName: "Lock Stock", // Level 8 -> Hostile Takeover
            Positions: { // 80.02% success rate, xx.xx% chain success rate
                "Assassin": 72,
                "Smuggler": 73,
                "Hacker": 74,
                "Muscle #1": 74,
                "Muscle #2": 74
            }
        },
        {
            OCName: "Manifest Cruelty", // Level 8 -> Gone Fission -> Crane Reaction
            Positions: { // 84.48% success rate, 50.09% chain success rate
                "Reviver": 76,
                "Interrogator": 75,
                "Hacker": 75,
                "Cat Burglar": 75
            }
        },
        {
            OCName: "Ace in the Hole", // Level 9
            Positions: { // 63.64% success rate, 50.12% chain success rate
                // (Stacking the Deck success rate) x (Ace in the Hole success rate) = overall success rate
                "Hacker": 64,
                "Muscle #2": 65, // not positioned correctly on crimeshub
                "Imitator": 63, // not positioned correctly on crimeshub
                "Muscle #1": 65,
                "Driver": 54
            }
        },
        { // These numbers are just placeholders, replace when more information is known
            OCName: "Hostile Takeover", // Level 9
            Positions: { // 65.54% success rate, 50.14% chain success rate
                "Negotiator": 66,
                "Engineer": 64,
                "Cat Burglar": 64,
                "Muscle": 66,
                "Kidnapper": 64,
                "Hacker": 66
            }
        },
        {
            OCName: "Gone Fission", // Level 9 -> Crane Reaction
            Positions: { // 78.55% success rate, 66.36% cumulative success rate, 50.09% chain success rate
                // (Manifest Cruelty success rate) x (Gone Fission success rate) = cumulative success rate
                "Hijacker": 73,
                "Imitator": 73,
                "Bomber": 72,
                "Pickpocket": 72,
                "Engineer": 72
            }
        },
        {
            OCName: "Crane Reaction", // Level 10
            Positions: { // 75.49% success rate, 50.09% chain success rate
                // (Manifest Cruelty success rate) x
                // (Gone Fission success rate) x
                // (Crane Reaction success rate) = overall success rate
                "Sniper": 72,
                "Lookout": 71,
                "Bomber": 71,
                "Muscle #1": 71,
                "Muscle #2": 71,
                "Engineer": 71
            }
        },
        // These low level OCs do not have enough information to
        // define role-specific requirements. Keeping requirements
        // generic until Crimehub publishes information on them
        {
            OCName: "Best of the Lot", // Level 2
            Positions: `default_${defaultLevel}`
        },
        {
            OCName: "Pet Project", // Level 1
            Positions: `default_${defaultLevel}`
        },
        {
            OCName: "First Aid and Abet", // Level 1
            Positions: `default_${defaultLevel}`
        }
    ];

    function classStartsWith(prefix) {
        return `[class^="${prefix}"], [class*=" ${prefix}"]`;
    }

    const SELECTORS = {
        wrapper: classStartsWith("wrapper___"),
        panelTitle: classStartsWith("panelTitle___"),
        slotHeader: classStartsWith("slotHeader___"),
        roleTitle: classStartsWith("title___"),
        successChance: classStartsWith("successChance___"),
        joinButton: "button.torn-btn.joinButton, button.torn-btn[class^='joinButton___'], button.torn-btn[class*=' joinButton___']"
    };

    const SLOT_TEXT_FIELDS = [SELECTORS.roleTitle, SELECTORS.successChance, SELECTORS.panelTitle, ".honor-text"].join(", ");

    function isCrimesHash() {
        const tabParam = /(?:^|[#&?/])tab=([^&#/?]*)/i;
        const match = tabParam.exec(window.location.hash) || tabParam.exec(window.location.search);
        return match?.[1].toLowerCase() === "crimes";
    }

    function isPageActive() {
        return document.visibilityState === "visible" && document.hasFocus() && isCrimesHash();
    }

    function getCrimesRoot() {
        return document.getElementById("faction-crimes-root") || document.getElementById("factionCrimes-root");
    }

    function stripAccents(value) {
        return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function normalizeKey(value) {
        return stripAccents(value)
            .split("\n")[0]
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    }

    function compactKey(value) {
        return stripAccents(value)
            .split("\n")[0]
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/gi, "");
    }

    function isValidWeightsObject(obj) {
        return Boolean(obj && typeof obj === "object" && !Array.isArray(obj));
    }

    function isValidRoleWeight(value) {
        return Number.isFinite(value) && value >= -1 && value <= 100;
    }

    function isValidWeightsPayload(data) {
        if (!isValidWeightsObject(data)) return false;
        let validCount = 0;
        for (const [crime, roles] of Object.entries(roleContributions)) {
            const crimeKey = compactKey(crime);
            for (const role of Object.keys(roles)) {
                if (getRoleWeight(data, crimeKey, compactKey(role)) !== undefined && ++validCount >= 3) {
                    return true;
                }
            }
        }
        return false;
    }

    function getRoleWeight(weights, ocKey, roleKey) {
        if (!isValidWeightsObject(weights)) return undefined;
        const ocEntry = Object.entries(weights).find(([key]) => compactKey(key) === ocKey);
        if (!ocEntry || !isValidWeightsObject(ocEntry[1])) return undefined;
        const value = Object.entries(ocEntry[1]).find(([key]) => compactKey(key) === roleKey)?.[1];
        return isValidRoleWeight(value) ? value : undefined;
    }

    function loadCachedWeights() {
        try {
            const entry = JSON.parse(window.localStorage.getItem(CACHE_KEY));
            if (entry && Number.isFinite(entry.timestamp) && entry.timestamp > 0 &&
                entry.timestamp <= Date.now() && isValidWeightsPayload(entry.data)) return entry;
        } catch {
            // The embedded snapshot also works when storage is unavailable.
        }
        return null;
    }

    function scheduleWeightsCheck(at) {
        clearTimeout(weightsTimer);
        if (isPageActive() && observedCrimesRoot?.isConnected) {
            weightsTimer = setTimeout(syncLifecycle, Math.max(0, at - Date.now()));
        }
    }

    function ensureRoleWeightsLoaded() {
        if (weightsFetchInFlight) return;
        const stored = loadCachedWeights();
        if (stored && (!weightsCache || stored.timestamp >= weightsCache.timestamp)) {
            weightsCache = stored;
            memoryCacheOnly = false;
        }
        // An explicit cache deletion takes effect on the next active check.
        const freshEntry = memoryCacheOnly ? weightsCache : stored;
        const nextCheck = Math.max(retryWeightsAt, freshEntry ? freshEntry.timestamp + CACHE_TTL_MS : 0);
        if (nextCheck > Date.now()) {
            scheduleWeightsCheck(nextCheck);
            return;
        }
        if (typeof GM_xmlhttpRequest !== "function") return;

        function failed(reason) {
            weightsFetchInFlight = false;
            retryWeightsAt = Date.now() + API_RETRY_COOLDOWN_MS;
            scheduleWeightsCheck(retryWeightsAt);
            console.warn("[OC Role Display] Using cached or embedded weights", reason);
        }

        function loaded(response) {
            if (response.status < 200 || response.status >= 300) {
                failed("HTTP " + response.status);
                return;
            }
            let data;
            try {
                data = JSON.parse(response.responseText);
                if (!isValidWeightsPayload(data)) throw new Error("Unrecognized role weights");
            } catch (error) {
                failed(error);
                return;
            }
            weightsFetchInFlight = false;
            retryWeightsAt = 0;
            weightsCache = { timestamp: Date.now(), data };
            try {
                window.localStorage.setItem(CACHE_KEY, JSON.stringify(weightsCache));
                memoryCacheOnly = false;
            } catch {
                memoryCacheOnly = true;
            }
            scheduleWeightsCheck(weightsCache.timestamp + CACHE_TTL_MS);
            if (isPageActive() && observedCrimesRoot?.isConnected) processAllScenarios(observedCrimesRoot);
        }

        weightsFetchInFlight = true;
        try {
            GM_xmlhttpRequest({
                method: "GET", url: API_URL, anonymous: true, timeout: API_TIMEOUT_MS,
                onload: loaded, onerror: failed, ontimeout: () => failed("Timed out"),
                onabort: () => failed("Request aborted")
            });
        } catch (error) {
            failed(error);
        }
    }

    // Stop at the individual crime card even if Torn wraps several cards together.
    function scenarioFor(node, root) {
        let wrapper = node.closest(SELECTORS.wrapper);
        while (wrapper && root.contains(wrapper)) {
            const titles = wrapper.querySelectorAll(SELECTORS.panelTitle);
            if (titles.length > 1) return null;
            if (titles.length === 1 && wrapper.querySelector(SELECTORS.slotHeader)) return wrapper;
            wrapper = wrapper.parentElement?.closest(SELECTORS.wrapper);
        }
        return null;
    }

    function getRoleSlots(panel) {
        const slots = new Set();
        for (const header of panel.querySelectorAll(SELECTORS.slotHeader)) {
            let current = header.closest(SELECTORS.wrapper);
            let slot = null;
            while (current && current !== panel && !current.querySelector(SELECTORS.panelTitle)) {
                if (current.querySelectorAll(SELECTORS.slotHeader).length !== 1) break;
                slot = current;
                if (slot.querySelector(SELECTORS.roleTitle) && slot.querySelector(SELECTORS.successChance)) break;
                current = current.parentElement?.closest(SELECTORS.wrapper);
            }
            if (slot) slots.add(slot);
        }
        return Array.from(slots);
    }

    function requiredChanceFor(crimeName, roleName) {
        const crime = ocRoles.find(entry => normalizeKey(entry.OCName) === normalizeKey(crimeName));
        if (!crime) return null;
        if (typeof crime.Positions === "string") {
            return parseInt(crime.Positions.split("_")[1], 10);
        }
        const role = Object.entries(crime.Positions).find(([name]) => normalizeKey(name) === normalizeKey(roleName));
        return role?.[1] ?? null;
    }

    function readSlotEligibility(slot, crimeName) {
        const rawRole = slot.querySelector(SELECTORS.roleTitle)?.innerText.trim();
        const chanceEl = slot.querySelector(SELECTORS.successChance);
        if (!rawRole || !chanceEl) return null;

        const successChance = parseInt(chanceEl.textContent.trim(), 10) || 0;
        const required = requiredChanceFor(crimeName, rawRole);
        const occupied = Array.from(slot.querySelectorAll(".honor-text")).some(name => name.textContent.trim());
        return { rawRole, successChance, required, occupied };
    }

    function updateJoinBlock(button, eligibility) {
        const blocked = Boolean(
            eligibility && !eligibility.occupied && eligibility.required !== null &&
            eligibility.successChance < eligibility.required
        );
        button?.toggleAttribute("data-oc-nsbs-blocked", blocked);
        return blocked;
    }

    // Native button activation (including Enter and Space) dispatches a click.
    // Check the current slot even when React has reused or just replaced its button.
    function guardJoinClick(event) {
        if (document.visibilityState !== "visible" || !isCrimesHash()) return;
        const targetEl = event.target instanceof Element ? event.target : event.target?.parentElement;
        const button = targetEl?.closest?.(SELECTORS.joinButton);
        if (!button) return;
        const root = getCrimesRoot();
        if (!root?.contains(button)) return;

        // Let the first click focus Torn if necessary. Only read game data once focused.
        let block = !document.hasFocus();
        if (!block) {
            const panel = scenarioFor(button, root);
            if (!panel) return;
            const slot = getRoleSlots(panel).find(entry => entry.contains(button));
            const crimeName = panel.querySelector(SELECTORS.panelTitle).innerText;
            block = updateJoinBlock(button, slot && readSlotEligibility(slot, crimeName));
        }
        if (block) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }

    function processScenario(panel) {
        if (!panel || !panel.isConnected) return;

        panel.classList.add("role-processed");
        const crimeName = panel.querySelector(SELECTORS.panelTitle)?.innerText || "";
        const crimeKey = compactKey(crimeName);

        for (const slot of getRoleSlots(panel)) {
            const eligibility = readSlotEligibility(slot, crimeName);
            const blocked = updateJoinBlock(slot.querySelector(SELECTORS.joinButton), eligibility);
            const rated = eligibility && eligibility.required !== null;
            slot.classList.toggle("oc-nsbs-below", blocked);
            slot.classList.toggle("oc-nsbs-eligible", Boolean(rated && !eligibility.occupied && !blocked));
            slot.classList.toggle("oc-nsbs-low-occupied",
                Boolean(rated && eligibility.occupied && eligibility.successChance < eligibility.required));

            const roleKey = compactKey(eligibility?.rawRole);
            const weight = getRoleWeight(weightsCache?.data, crimeKey, roleKey)
                ?? getRoleWeight(roleContributions, crimeKey, roleKey);
            let line = slot.querySelector(":scope > .oc-contrib-linewrap");
            slot.classList.toggle("oc-has-contrib", weight !== undefined);
            if (weight === undefined) {
                line?.remove();
                continue;
            }
            if (!line) {
                line = document.createElement("div");
                line.className = "oc-contrib-linewrap";
                slot.appendChild(line);
            }
            let text = line.querySelector(".oc-contrib-linetext");
            if (!text) {
                text = document.createElement("span");
                text.className = "oc-contrib-linetext";
                line.appendChild(text);
            }
            const label = String(Math.round(weight * 100) / 100) + "%";
            if (text.textContent !== label) text.textContent = label;
        }
    }

    function processAllScenarios(root) {
        const panels = new Set();
        for (const title of root.querySelectorAll(SELECTORS.panelTitle)) {
            const panel = scenarioFor(title, root);
            if (panel) panels.add(panel);
        }
        panels.forEach(processScenario);
    }

    function queuePanelChanges(records, root) {
        if (!isPageActive() || !root.isConnected) {
            syncLifecycle();
            return;
        }
        const addPanel = node => {
            const panel = scenarioFor(node, root);
            if (panel) pendingPanels.add(panel);
        };
        for (const record of records) {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            if (!target || !root.contains(target) || target.closest(".oc-contrib-linewrap")) continue;
            const elements = [...record.addedNodes, ...record.removedNodes].filter(node => node.nodeType === 1);
            if (!elements.length) {
                // Ignore ticking countdowns. React can update a chance or role as a text node.
                if (target.closest(SLOT_TEXT_FIELDS)) addPanel(target);
                continue;
            }
            if (!record.removedNodes.length && elements.every(node => node.classList.contains("oc-contrib-linewrap"))) continue;
            for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches(SELECTORS.panelTitle)) addPanel(node);
                node.querySelectorAll(SELECTORS.panelTitle).forEach(addPanel);
            }
            addPanel(target);
        }
        if (pendingPanels.size && panelFrame === null) {
            panelFrame = window.requestAnimationFrame(() => {
                panelFrame = null;
                if (isPageActive() && root.isConnected) pendingPanels.forEach(processScenario);
                pendingPanels.clear();
            });
        }
    }

    function stopWatching() {
        clearTimeout(weightsTimer);
        clearTimeout(rootTimer);
        rootTimer = null;
        if (panelFrame !== null) window.cancelAnimationFrame(panelFrame);
        panelFrame = null;
        pendingPanels.clear();
        crimesObserver?.disconnect();
        crimesObserver = null;
        observedCrimesRoot?.classList.remove("oc-nsbs-active");
        observedCrimesRoot = null;
    }

    function syncLifecycle() {
        if (!isPageActive()) {
            stopWatching();
            return;
        }

        const root = getCrimesRoot();
        if (!root) {
            if (observedCrimesRoot) stopWatching();
            // Only check the two mount IDs. Never observe the whole page for crime data.
            if (rootTimer === null) {
                rootTimer = setTimeout(() => {
                    rootTimer = null;
                    syncLifecycle();
                }, ROOT_CHECK_DELAY_MS);
            }
            return;
        }
        if (root !== observedCrimesRoot) {
            stopWatching();
            if (!style.isConnected) document.head.appendChild(style);
            observedCrimesRoot = root;
            root.classList.add("oc-nsbs-active");
            crimesObserver = new MutationObserver(records => queuePanelChanges(records, root));
            crimesObserver.observe(root, { childList: true, characterData: true, subtree: true });
            // Direct child changes on the ancestors signal when Torn replaces the root.
            for (let parent = root.parentElement; parent; parent = parent.parentElement) {
                crimesObserver.observe(parent, { childList: true });
            }
        }
        ensureRoleWeightsLoaded();
        processAllScenarios(root);
    }

    document.addEventListener("visibilitychange", syncLifecycle);
    window.addEventListener("click", guardJoinClick, true);
    window.addEventListener("focus", syncLifecycle);
    window.addEventListener("blur", stopWatching);
    window.addEventListener("hashchange", syncLifecycle);
    window.addEventListener("popstate", syncLifecycle);
    window.addEventListener("load", syncLifecycle);

    // Initialize immediately if the crimes tab is currently active and focused.
    syncLifecycle();
})();
