// ==UserScript==
// @name         OC Role Display - NSBS Edition
// @namespace    com.neopolitan.OcRoleDisplay
// @version      1.0.2
// @description  Color Coding the positions. Number updates and more OCs by Neopolitan
// @author       NotIbbyz, Neopolitan
// @match        https://www.torn.com/factions.php?step=your*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @connect      tornprobability.com
// @grant        GM_info
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/tn5421/torn-userscripts/refs/heads/main/OC%20Role%20Display%20NSBS%20Edition.user.js
// @updateURL https://raw.githubusercontent.com/tn5421/torn-userscripts/refs/heads/main/OC%20Role%20Display%20NSBS%20Edition.user.js
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

    const defaultLevel6 = 70;
    const defaultLevel5 = 70;
    const defaultLevel4 = 70;
    const defaultLevel3 = 71;
    const defaultLevel2 = 71;
    const defaultLevel1 = 71;
    const defaultDecline = 700;

    const ocRoles = [
        {
            OCName: "Window of Opportunity",
            Positions: {
                "Engineer": 70,
                "Muscle #1": 74,
                "Muscle #2": 71,
                "Looter #1": 72,
                "Looter #2": 75 
                }
        },
        {
            OCName: "Blast From The Past",
            Positions: {
                "PICKLOCK #1": 70,
                "HACKER": 70,
                "ENGINEER": 73,
                "BOMBER": 70,
                "MUSCLE": 74,
                "PICKLOCK #2": 60
            }
        },
        {
            OCName: "Clinical Precision",
            Positions: {
                "ASSASSIN": 63,
                "CAT BURGLAR": 66,
                "CLEANER": 67,
                "IMITATOR": 70
            }
        },
        {
            OCName: "Break the Bank",
            Positions: {
                "ROBBER": 62,
                "MUSCLE #1": 62,
                "THIEF #1": 58,
                "MUSCLE #2": 60,
                "MUSCLE #3": 65,
                "THIEF #2": 64
            }
        },
        {
            OCName: "Stacking the Deck",
            Positions: {
                "HACKER": 63,
                "IMITATOR": 66,
                "CAT BURGLAR": 63,
                "DRIVER": 50
            }
        },
        { // These numbers are just placeholders, replace when more information is known
            OCName: "Lock Stock",
            Positions: {
                "Hacker": 66,
                "Assassin": 66,
                "Muscle #1": 66,
                "Muscle #2": 66,
                "Smuggler": 66
            }
        },
        {
            OCName: "Manifest Cruelty",
            Positions: {
                "Hacker": 58,
                "Interrogator": 60,
                "Reviver": 62,
                "Cat Burglar": 57
            }
        },
        {
            OCName: "Ace in the Hole",
            Positions: {
                "HACKER": 65,
                "DRIVER": 54,
                "MUSCLE #1": 62,
                "IMITATOR": 63,
                "MUSCLE #2": 64
            }
        },
        { // These numbers are just placeholders, replace when more information is known
            OCName: "Hostile Takeover",
            Positions: {
                "Cat Burglar": 61,
                "Engineer": 61,
                "Hacker": 61,
                "Kidnapper": 61,
                "Muscle": 61,
                "Negotiator": 61
            }
        },
        {
            OCName: "Gone Fission",
            Positions: {
                "Hijacker": 61,
                "Engineer": 57,
                "Pickpocket": 58,
                "Imitator": 61,
                "Bomber": 59
            }
        },
        {
            OCName: "Crane Reaction",
            Positions: {
                "Sniper": 58,
                "Lookout": 52,
                "Engineer": 50,
                "Bomber": 52,
                "Muscle #1": 51,
                "Muscle #2": 50
            }
        },
        {
            OCName: "Bidding War",
            Positions: `default_${defaultLevel6}`
        },
        {
            OCName: "Honey Trap",
            Positions: `default_${defaultLevel6}`
        },
        {
            OCName: "Sneaky Git Grab",
            Positions: `default_${defaultLevel6}`
        },
        {
            OCName: "Dish It Out",
            Positions: `default_${defaultLevel6}`
        },
        {
            OCName: "Leave No Trace",
            Positions: `default_${defaultLevel5}`
        },
        {
            OCName: "Guardian Ángels",
            Positions: `default_${defaultLevel5}`
        },
        {
            OCName: "Counter Offer",
            Positions: `default_${defaultLevel5}`
        },
        {
            OCName: "No Reserve",
            Positions: `default_${defaultLevel5}`
        },
        {
            OCName: "Stage Fright",
            Positions: `default_${defaultLevel4}`
        },
        {
            OCName: "Snow Blind",
            Positions: `default_${defaultLevel4}`
        },
        {
            OCName: "Plucking the Lotus Petal",
            Positions: `default_${defaultLevel4}`
        },
        {
            OCName: "Gaslight the Way",
            Positions: `default_${defaultLevel3}`
        },
        {
            OCName: "Smoke and Wing Mirrors",
            Positions: `default_${defaultLevel3}`
        },
        {
            OCName: "Market Forces",
            Positions: `default_${defaultLevel3}`
        },
        {
            OCName: "Best of the Lot",
            Positions: `default_${defaultLevel2}`
        },
        {
            OCName: "Cash Me if You Can",
            Positions: `default_${defaultLevel2}`
        },
        {
            OCName: "Thou Shalt Not Steal",
            Positions: `default_${defaultLevel2}`
        },
        {
            OCName: "Mob Mentality",
            Positions: `default_${defaultLevel1}`
        },
        {
            OCName: "Pet Project",
            Positions: `default_${defaultLevel1}`
        },
        {
            OCName: "First Aid and Abet",
            Positions: `default_${defaultLevel1}`
        }
    ];

    const roleMappings = {};

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
