// ==UserScript==
// @name         OC Role Display - NSBS Edition
// @namespace    com.neopolitan.OcRoleDisplay
// @version      1.1.7
// @description  Displays OC role contribution weights and shows if you would be a good fit in a particular OC
// @author       Ibbyz [229585], Neopolitan [276835]
// @match        https://www.torn.com/factions.php?step=your*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @connect      tornprobability.com
// @grant        GM_xmlhttpRequest
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/tn5421/torn-userscripts/refs/heads/main/OC%20Role%20Display%20NSBS%20Edition.user.js
// @updateURL    https://raw.githubusercontent.com/tn5421/torn-userscripts/refs/heads/main/OC%20Role%20Display%20NSBS%20Edition.user.js
// ==/UserScript==

(async function() {
    'use strict';

    const style = document.createElement('style');
    style.innerHTML = `
    @keyframes pulseRed {
        0% { box-shadow: 0 0 8px red; }
        50% { box-shadow: 0 0 18px red; }
        100% { box-shadow: 0 0 8px red; }
    }

    .pulse-border-red {
        animation: pulseRed 1s infinite;
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
    document.head.appendChild(style);

    const API_URL = "https://tornprobability.com:3000/api/GetRoleWeights";
    let roleWeightsAPI = null;

    function classStartsWith(prefix) {
        return `[class^="${prefix}"], [class*=" ${prefix}"]`;
    }

    const SELECTORS = {
        wrapper: classStartsWith("wrapper___"),
        panelTitle: classStartsWith("panelTitle___"),
        slotHeader: classStartsWith("slotHeader___"),
        roleTitle: classStartsWith("title___"),
        successChance: classStartsWith("successChance___")
    };

    function normalizeKey(value) {
        return String(value || "")
            .split("\n")[0]
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    }

    function compactKey(value) {
        return String(value || "")
            .split("\n")[0]
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\u00C0-\u017F]/gi, "");
    }

    function getScenarioPanelFromTitle(titleEl) {
        let current = titleEl.closest(SELECTORS.wrapper);
        let best = current;

        while (current) {
            if (
                current.matches?.(SELECTORS.wrapper) &&
                current.contains(titleEl) &&
                current.querySelector(SELECTORS.successChance)
            ) {
                best = current;
            }

            current = current.parentElement?.closest?.(SELECTORS.wrapper);
        }

        return best;
    }

    function getRoleSlots(panel) {
        const slots = [];

        panel.querySelectorAll(SELECTORS.slotHeader).forEach(header => {
            let current = header.closest(SELECTORS.wrapper);

            while (current && current !== panel) {
                const hasHeader = current.querySelector(SELECTORS.slotHeader);
                const hasRole = current.querySelector(SELECTORS.roleTitle);
                const hasChance = current.querySelector(SELECTORS.successChance);
                const hasPanelTitle = current.querySelector(SELECTORS.panelTitle);

                if (hasHeader && hasRole && hasChance && !hasPanelTitle) {
                    slots.push(current);
                    break;
                }

                current = current.parentElement?.closest?.(SELECTORS.wrapper);
            }
        });

        return Array.from(new Set(slots));
    }

    function processAllScenarios() {
        const panels = new Set();

        document.querySelectorAll(SELECTORS.panelTitle).forEach(title => {
            const panel = getScenarioPanelFromTitle(title);
            if (panel) {
                panels.add(panel);
            }
        });

        panels.forEach(processScenario);
    }

    const defaultLevel = 70;
    const defaultDecline = 700;

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
            OCName: "Guardian Ángels", // Level 5
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
            Positions: { // hopefully 75% success rate
                "Assassin": 75,
                "Imitator": 75,
                "Interrogator": 75,
                "Lookout": 75,
                "Pickpocket": 75,
                "Techie": 75
            }
        },

        {
            OCName: "Clinical Precision", // Level 8
            Positions: { // 70.29% success rate
                "Imitator": 69,
                "Cleaner": 67,
                "Cat Burglar": 67,
                "Assassin": 65
            }
        },
        {
            OCName: "Break the Bank", // Level 8
            Positions: { // 68.36% success rate
                "Muscle #3": 66,
                "Thief #2": 65,
                "Muscle #1": 63,
                "Robber": 63,
                "Muscle #2": 62,
                "Thief #1": 60
            }
        },
        {
            OCName: "Stacking the Deck", // Level 8 -> Ace in the Hole
            Positions: { // 78.75% success rate, 50.12% chain success rate
                "Imitator": 72,
                "Hacker": 72,
                "Cat Burglar": 72,
                "Driver": 60
            }
        },
        { // These numbers are just placeholders, replace when more information is known
            OCName: "Lock Stock", // Level 8 -> Hostile Takeover
            Positions: { // 65% success rate (guess)
                "Assassin": 68,
                "Smuggler": 70,
                "Hacker": 71,
                "Muscle #1": 70,
                "Muscle #2": 70
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
            Positions: { // 62% success rate (guess)
                "Negotiator": 65,
                "Engineer": 65,
                "Cat Burglar": 64,
                "Muscle": 63,
                "Kidnapper": 63,
                "Hacker": 63
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
            OCName: "Best of the Lot", //level 2
            Positions: `default_${defaultLevel}`
        },
        {
            OCName: "Pet Project", // level 1
            Positions: `default_${defaultLevel}`
        },
        {
            OCName: "First Aid and Abet", // level 1
            Positions: `default_${defaultLevel}`
        }
    ];

    function processScenario(panel) {
        if (!panel.classList.contains('role-processed')) {
            panel.classList.add('role-processed');
        }

        const ocName =
              panel.querySelector(SELECTORS.panelTitle)?.innerText.trim() || "Unknown";

        const cleanOCName = ocName.split("\n")[0].trim();

        const slots = getRoleSlots(panel);

        slots.forEach(slot => {
            // Reset previous visual state before recalculating.
            // This prevents bad layout after joining/leaving/changing slots.
            slot.classList.remove("oc-has-contrib", "pulse-border-red");
            slot.style.backgroundColor = "";
            slot.style.outline = "";
            slot.style.outlineOffset = "";

            const oldContribLine = slot.querySelector(":scope > .oc-contrib-linewrap");
            if (oldContribLine) {
                oldContribLine.remove();
            }

            const roleElem =
                  slot.querySelector(SELECTORS.roleTitle);

            const chanceElem =
                  slot.querySelector(SELECTORS.successChance);

            if (!roleElem || !chanceElem) return;

            const rawRole = roleElem.innerText.trim();
            const successChance = parseInt(chanceElem.textContent.trim(), 10) || 0;
            const joinBtn = slot.querySelector("button[class^='torn-btn joinButton'], button[class*=' torn-btn joinButton']");

            // From allenone API
            if (roleWeightsAPI) {
                const ocKeyCompact = compactKey(cleanOCName);
                const roleKeyCompact = compactKey(rawRole);

                const ocEntry = Object.entries(roleWeightsAPI || {}).find(([k]) =>
                                                                          String(k).toLowerCase() === ocKeyCompact
                                                                         );

                const pctRaw = ocEntry
                ? Object.entries(ocEntry[1] || {}).find(([k]) =>
                                                        String(k).toLowerCase() === roleKeyCompact
                                                       )?.[1]
                : undefined;

                const pct = (typeof pctRaw === "number") ? Math.round(pctRaw) : undefined;

                if (typeof pct === "number") {
                    slot.classList.add("oc-has-contrib");

                    const wrap = document.createElement("div");
                    wrap.className = "oc-contrib-linewrap";

                    const text = document.createElement("span");
                    text.className = "oc-contrib-linetext";
                    text.textContent = `${pct}%`;

                    wrap.appendChild(text);
                    slot.appendChild(wrap);
                }
            }

            const ocData = ocRoles.find(o =>
                                        normalizeKey(o.OCName) === normalizeKey(cleanOCName)
                                       );

            let required = null;

            if (ocData) {
                if (
                    typeof ocData.Positions === 'string' &&
                    ocData.Positions.startsWith('default_')
                ) {
                    required = parseInt(ocData.Positions.split('_')[1], 10);
                } else if (typeof ocData.Positions === 'object') {
                    const roleEntry = Object.entries(ocData.Positions)
                    .find(([roleName]) =>
                          normalizeKey(roleName) === normalizeKey(rawRole)
                         );

                    if (roleEntry) {
                        required = roleEntry[1];
                    }
                }
            }

            if (required === null) return;

            const honorTexts = slot.querySelectorAll('.honor-text');
            const userName = honorTexts.length > 1
            ? honorTexts[1].textContent.trim()
            : null;

            if (!userName) {
                slot.style.backgroundColor = successChance < required
                    ? '#ff000061'
                : '#21a61c61';

                if (joinBtn && successChance < required) {
                    joinBtn.setAttribute('disabled', '');
                }
            } else if (successChance < required) {
                slot.classList.add('pulse-border-red');
                slot.style.outline = '4px solid red';
                slot.style.outlineOffset = '0px';
            }
        });
    }

    const observer = new MutationObserver(mutations => {
        const panels = new Set();

        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;

                if (node.matches?.(SELECTORS.panelTitle)) {
                    const panel = getScenarioPanelFromTitle(node);
                    if (panel) {
                        panels.add(panel);
                    }
                }

                node.querySelectorAll?.(SELECTORS.panelTitle).forEach(title => {
                    const panel = getScenarioPanelFromTitle(title);
                    if (panel) {
                        panels.add(panel);
                    }
                });

                if (node.matches?.(SELECTORS.successChance)) {
                    let current = node.closest(SELECTORS.wrapper);

                    while (current) {
                        const title = current.querySelector?.(SELECTORS.panelTitle);
                        if (title) {
                            const panel = getScenarioPanelFromTitle(title);
                            if (panel) {
                                panels.add(panel);
                            }
                            break;
                        }

                        current = current.parentElement?.closest?.(SELECTORS.wrapper);
                    }
                }

                node.querySelectorAll?.(SELECTORS.successChance).forEach(chance => {
                    let current = chance.closest(SELECTORS.wrapper);

                    while (current) {
                        const title = current.querySelector?.(SELECTORS.panelTitle);
                        if (title) {
                            const panel = getScenarioPanelFromTitle(title);
                            if (panel) {
                                panels.add(panel);
                            }
                            break;
                        }

                        current = current.parentElement?.closest?.(SELECTORS.wrapper);
                    }
                });
            });
        });

        panels.forEach(processScenario);
    });

    const targetNode = document.querySelector('#factionCrimes-root') || document.body;
    observer.observe(targetNode, { childList: true, subtree: true });

    window.addEventListener('load', () => {
        processAllScenarios();
    });

    GM_xmlhttpRequest({
        method: "GET",
        url: API_URL,
        onload: (res) => {
            try {
                roleWeightsAPI = JSON.parse(res.responseText);
                console.log("[OC Role Display] Role Weights API loaded");

                processAllScenarios();

            } catch (e) {
                console.warn("[OC Role Display] Failed parsing API JSON ", e);
            }
        },
        onerror: (err) => {
            console.warn("[OC Role Display] API request failed", err);
        }
    });

})();
