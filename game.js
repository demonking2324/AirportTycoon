(() => {
  const AIRPORTS = window.AIRPORTS;
  const MAX_LEVEL = 10;
  const CONTRACT_COST = 80;
  const CONTRACT_UPGRADE_COST = [
    0, 0, 500, 1500, 4500, 12000, 30000, 75000, 180000, 450000, 1000000,
  ];
  const TAKEOFF_PAYOUT = [
    0, 80, 200, 450, 1000, 2200, 4800, 10000, 20000, 40000, 85000,
  ];

  const START_COINS = 500;
  const START_CONTRACTS = 2;

  const state = {
    coins: START_COINS,
    contracts: START_CONTRACTS,
    arrivalLevel: 1,
    airportIndex: 0,
    unlockedMax: 0,
    saves: {},
    logbook: {},
    cells: [],
    reserved: [],
    selected: null,
    dragFrom: null,
    landingBusy: false,
    takeoffBusy: false,
  };

  // A landing and a takeoff can run at once, unless the airport shares one runway.
  function anyBusy() {
    return state.landingBusy || state.takeoffBusy;
  }

  function runwaysShared(airport = currentAirport()) {
    return !airport || airport.landingRunway === airport.takeoffRunway;
  }

  function landingLocked() {
    return state.landingBusy || (runwaysShared() && state.takeoffBusy);
  }

  function takeoffLocked() {
    return state.takeoffBusy || (runwaysShared() && state.landingBusy);
  }

  const coinsEl = document.getElementById("coins");
  const contractsEl = document.getElementById("contracts");
  const arrivalLevelEl = document.getElementById("arrival-level");
  const airportTitleEl = document.getElementById("airport-title");
  const switcherEl = document.getElementById("airport-switcher");
  const apronEl = document.getElementById("apron");
  const hintEl = document.getElementById("hint");
  const landBtn = document.getElementById("land-btn");
  const buyBtn = document.getElementById("buy-btn");
  const upgradeBtn = document.getElementById("upgrade-btn");
  const launchBtn = document.getElementById("launch-btn");
  const toastEl = document.getElementById("toast");
  const logbookBtn = document.getElementById("logbook-btn");
  const gamePage = document.getElementById("game-page");
  const logbookPage = document.getElementById("logbook-page");
  const logbookBody = document.getElementById("logbook-body");
  const logbookBackBtn = document.getElementById("logbook-back-btn");
  const potdBtn = document.getElementById("potd-btn");
  const potdDetail = document.getElementById("potd-detail");
  const potdPanel = document.getElementById("potd-panel");

  const POTD_KEY = "at-potd-v1";
  let globalAirlinePool = null;

  const FLAG_COUNTRY = {
    AT: "Austria",
    DE: "Germany",
    CH: "Switzerland",
    HU: "Hungary",
    NL: "Netherlands",
    GB: "United Kingdom",
    IE: "Ireland",
    FR: "France",
    AE: "United Arab Emirates",
    QA: "Qatar",
    TR: "Turkey",
    JP: "Japan",
    KR: "South Korea",
    US: "United States",
    AU: "Australia",
    NZ: "New Zealand",
    SG: "Singapore",
    MY: "Malaysia",
    ID: "Indonesia",
  };

  let gridEl = null;
  let flightLayer = null;
  let toastTimer = null;

  function currentAirport() {
    return AIRPORTS[state.airportIndex];
  }

  function slotCount(airport = currentAirport()) {
    return airport.cols * airport.rows;
  }

  function isActiveSlot(index, airport = currentAirport()) {
    if (!airport.mask) return true;
    return airport.mask[index] !== false;
  }

  function resetApronState() {
    const n = slotCount();
    state.cells = Array(n).fill(null);
    state.reserved = Array(n).fill(false);
    state.selected = null;
    state.dragFrom = null;
  }

  function cloneCells(cells) {
    return cells.map((entry) => {
      if (!entry) return null;
      if (typeof entry !== "object") return makePlane(entry);
      return {
        level: entry.level,
        airline: entry.airline
          ? { id: entry.airline.id, name: entry.airline.name, flag: entry.airline.flag }
          : null,
      };
    });
  }

  function defaultSaveFor(airportIndex) {
    const airport = AIRPORTS[airportIndex];
    const n = airport.cols * airport.rows;
    return {
      coins: START_COINS,
      contracts: START_CONTRACTS,
      arrivalLevel: 1,
      cells: Array(n).fill(null),
      reserved: Array(n).fill(false),
    };
  }

  function saveCurrentAirport() {
    state.saves[state.airportIndex] = {
      coins: state.coins,
      contracts: state.contracts,
      arrivalLevel: state.arrivalLevel,
      cells: cloneCells(state.cells),
      reserved: [...state.reserved],
    };
  }

  function loadAirportProgress(index) {
    if (!state.saves[index]) {
      state.saves[index] = defaultSaveFor(index);
    }

    const save = state.saves[index];
    const airport = AIRPORTS[index];
    const n = airport.cols * airport.rows;

    state.airportIndex = index;
    state.coins = save.coins;
    state.contracts = save.contracts;
    state.arrivalLevel = save.arrivalLevel;
    state.cells =
      save.cells && save.cells.length === n
        ? cloneCells(save.cells)
        : Array(n).fill(null);
    state.reserved =
      save.reserved && save.reserved.length === n
        ? [...save.reserved]
        : Array(n).fill(false);
    state.selected = null;
    state.dragFrom = null;
  }

  function applyTheme(airport) {
    const t = airport.theme;
    const root = document.documentElement;
    root.style.setProperty("--sky-top", t.skyTop);
    root.style.setProperty("--sky-mid", t.skyMid);
    root.style.setProperty("--sky-bot", t.skyBot);
    root.style.setProperty("--accent", t.accent);
    root.style.setProperty("--tarmac", t.tarmac);
    root.style.setProperty("--apron-deep", t.apronDeep);
    document.body.style.background = t.skyBot;
  }

  function runwayMarkup(rw) {
    const roleClass =
      rw.role === "landing"
        ? "runway-landing"
        : rw.role === "takeoff"
          ? "runway-takeoff"
          : "runway-shared";
    const badgeClass =
      rw.role === "landing"
        ? "badge-land"
        : rw.role === "takeoff"
          ? "badge-depart"
          : "badge-shared";
    const vertical = rw.vertical ? " vertical" : "";
    return `
      <section class="runway ${roleClass}" data-runway="${rw.id}" aria-label="${rw.badge}">
        <div class="runway-surface${vertical}">
          <span class="runway-num runway-num-start">${rw.start}</span>
          <div class="runway-centerline"></div>
          <div class="runway-threshold runway-threshold-start"></div>
          <div class="runway-threshold runway-threshold-end"></div>
          <span class="runway-num runway-num-end">${rw.end}</span>
        </div>
        <div class="runway-badge ${badgeClass}">${rw.badge}</div>
      </section>
    `;
  }

  function buildApron() {
    const airport = currentAirport();
    applyTheme(airport);
    apronEl.className = `apron layout-${airport.layout}`;
    airportTitleEl.textContent = `${airport.fullName} · ${airport.code} · ${airport.country}`;

    const terminal = `
      <div class="terminal">
        <div class="apron-stands">
          <div class="side-taxi side-taxi-l" aria-hidden="true"></div>
          <div class="grid" id="grid" aria-label="Airport parking grid"></div>
          <div class="side-taxi side-taxi-r" aria-hidden="true"></div>
        </div>
      </div>
    `;

    let html = "";
    if (airport.layout === "single") {
      html = `${terminal}${runwayMarkup(airport.runways[0])}`;
    } else if (airport.layout === "side") {
      html = `${runwayMarkup(airport.runways[0])}${terminal}`;
    } else if (airport.layout === "cross") {
      html = `${runwayMarkup(airport.runways[0])}${terminal}${runwayMarkup(airport.runways[1])}`;
    } else {
      html = `${runwayMarkup(airport.runways[0])}${terminal}${runwayMarkup(airport.runways[1])}`;
    }

    html += `<div class="flight-layer" id="flight-layer" aria-hidden="true"></div>`;
    apronEl.innerHTML = html;
    gridEl = document.getElementById("grid");
    flightLayer = document.getElementById("flight-layer");
    gridEl.style.gridTemplateColumns = `repeat(${airport.cols}, 1fr)`;
    gridEl.style.gridTemplateRows = `repeat(${airport.rows}, 1fr)`;
  }

  function renderAirportSwitcher() {
    switcherEl.innerHTML = "";
    AIRPORTS.forEach((airport, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "airport-chip";
      if (index === state.airportIndex) btn.classList.add("active");
      const unlocked = index <= state.unlockedMax;
      btn.disabled = !unlocked || anyBusy();
      btn.textContent = unlocked ? `${airport.code}` : "???";
      btn.title = unlocked
        ? index < state.unlockedMax
          ? `${airport.fullName} · completed — click to return`
          : `${airport.fullName}, ${airport.country}`
        : "Launch a Level 10 Jumbo to unlock";
      if (index < state.unlockedMax) btn.classList.add("completed");
      if (unlocked) {
        btn.addEventListener("click", () => switchAirport(index));
      }
      switcherEl.appendChild(btn);
    });
  }

  function switchAirport(index) {
    if (anyBusy() || index > state.unlockedMax || index === state.airportIndex) {
      return;
    }
    saveCurrentAirport();
    const firstVisit = !state.saves[index];
    loadAirportProgress(index);
    buildApron();
    renderAirportSwitcher();
    render();
    const airport = currentAirport();
    showToast(
      firstVisit
        ? `${airport.name} · fresh airport progress`
        : `Returned to ${airport.name}`
    );
  }

  function runwayBand(id) {
    const el = document.querySelector(`.runway[data-runway="${id}"] .runway-surface`);
    const apronRect = apronEl.getBoundingClientRect();
    if (!el) {
      return { x: 50, y: 90, left: 10, right: 90, top: 84, bottom: 96, vertical: false };
    }
    const rect = el.getBoundingClientRect();
    const vertical = el.classList.contains("vertical");
    return {
      x: ((rect.left + rect.width / 2 - apronRect.left) / apronRect.width) * 100,
      y: ((rect.top + rect.height / 2 - apronRect.top) / apronRect.height) * 100,
      left: ((rect.left - apronRect.left) / apronRect.width) * 100,
      right: ((rect.right - apronRect.left) / apronRect.width) * 100,
      top: ((rect.top - apronRect.top) / apronRect.height) * 100,
      bottom: ((rect.bottom - apronRect.top) / apronRect.height) * 100,
      vertical,
    };
  }

  function pointOnApron(xPercent, yPercent) {
    return { x: xPercent, y: yPercent };
  }

  function landingPath() {
    const airport = currentAirport();
    const band = runwayBand(airport.landingRunway);
    if (band.vertical) {
      return {
        approach: pointOnApron(band.x, -18),
        touchdown: pointOnApron(band.x, 18),
        rollout: pointOnApron(band.x, 78),
        exit: pointOnApron(band.right + 3, 78),
        heading: 180,
      };
    }
    const towardGridY =
      airport.layout === "single" ? band.top - 3 : band.bottom + 2;
    return {
      approach: pointOnApron(-18, band.y - 1),
      touchdown: pointOnApron(16, band.y),
      rollout: pointOnApron(78, band.y),
      exit: pointOnApron(78, towardGridY),
      heading: 90,
    };
  }

  function takeoffPath() {
    const airport = currentAirport();
    const band = runwayBand(airport.takeoffRunway);
    if (band.vertical) {
      return {
        hold: pointOnApron(band.left - 3, 78),
        lineup: pointOnApron(band.x, 78),
        rotate: pointOnApron(band.x, 22),
        climb: pointOnApron(band.x - 8, -18),
        heading: 0,
      };
    }
    const fromGridY =
      airport.layout === "single" ? band.top - 3 : band.top - 2;
    return {
      hold: pointOnApron(18, fromGridY),
      lineup: pointOnApron(18, band.y),
      rotate: pointOnApron(72, band.y),
      climb: pointOnApron(118, band.y - 10),
      heading: 90,
    };
  }

  function emptySlots() {
    return state.cells
      .map((v, i) => (v === null && !state.reserved[i] && isActiveSlot(i) ? i : -1))
      .filter((i) => i >= 0);
  }

  function buildGlobalAirlinePool() {
    if (globalAirlinePool) return globalAirlinePool;
    const byId = new Map();
    AIRPORTS.forEach((airport) => {
      (airport.airlines || []).forEach((airline) => {
        if (!byId.has(airline.id)) {
          byId.set(airline.id, {
            id: airline.id,
            name: airline.name,
            flag: airline.flag,
          });
        }
      });
    });
    globalAirlinePool = Array.from(byId.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
    return globalAirlinePool;
  }

  function utcDateKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function getPlaneOfTheDay(dateKey = utcDateKey()) {
    const pool = buildGlobalAirlinePool();
    const rng = mulberry32(hashSeed(`AT-POTD-${dateKey}`));
    const level = 1 + Math.floor(rng() * MAX_LEVEL);
    const airline = pool[Math.floor(rng() * pool.length)];
    return {
      dateKey,
      level,
      airline: { id: airline.id, name: airline.name, flag: airline.flag },
    };
  }

  function potdLandedToday() {
    try {
      return localStorage.getItem(POTD_KEY) === utcDateKey();
    } catch (err) {
      return false;
    }
  }

  function markPotdLanded() {
    try {
      localStorage.setItem(POTD_KEY, utcDateKey());
    } catch (err) {
      // ignore
    }
  }

  function updatePotdPanel() {
    if (!potdDetail || !potdBtn) return;
    const potd = getPlaneOfTheDay();
    const form = PLANE_FORMS[potd.level];
    const landed = potdLandedToday();
    const hasSpace = emptySlots().length > 0;

    potdDetail.innerHTML = landed
      ? `Today's visitor was <strong>${potd.airline.name}</strong> · L${potd.level} ${form.name}. Come back tomorrow for a new one.`
      : `Everyone gets the same visitor today: <strong>${potd.airline.name}</strong> · L${potd.level} ${form.name}. Free landing — once per day.`;

    if (potdPanel) potdPanel.classList.toggle("used", landed);

    if (landed) {
      potdBtn.disabled = true;
      potdBtn.textContent = "Landed today";
    } else if (landingLocked()) {
      potdBtn.disabled = true;
      potdBtn.textContent = "Land Plane of the Day";
    } else if (!hasSpace) {
      potdBtn.disabled = true;
      potdBtn.textContent = "No parking spots";
    } else {
      potdBtn.disabled = false;
      potdBtn.textContent = "Land Plane of the Day";
    }
  }

  function wipeStoredProgress() {
    state.logbook = {};
    try {
      const doomed = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.toLowerCase().includes("airport")) doomed.push(key);
      }
      doomed.forEach((key) => localStorage.removeItem(key));
      localStorage.removeItem("airport-tycoon-logbook-v1");
      localStorage.removeItem("airport-tycoon-save-v1");
    } catch (err) {
      // ignore
    }
  }

  function loadLogbook() {
    wipeStoredProgress();
  }

  function isAirlineLogged(airportId, airlineId) {
    return Boolean(state.logbook[airportId] && state.logbook[airportId][airlineId]);
  }

  function recordLogbookSighting(airportId, airline, level = null) {
    if (!airportId || !airline || !airline.id || airline.id === "xx") return false;
    // Prop (L1) and Trainer (L2) don't count for the Logbook
    if (level != null) {
      const lvl = Number(level) || 0;
      if (lvl > 0 && lvl <= 2) return false;
    }
    if (!state.logbook[airportId]) state.logbook[airportId] = {};
    if (state.logbook[airportId][airline.id]) return false;
    state.logbook[airportId][airline.id] = true;
    return true;
  }

  function mysteryFlagMarkup() {
    return `<span class="logbook-flag-unknown" aria-hidden="true">???</span>`;
  }

  function renderLogbook() {
    if (!logbookBody) return;

    // Catch parked Twin Prop+ planes so the book stays in sync
    const current = currentAirport();
    state.cells.forEach((entry) => {
      const airline = planeAirline(entry);
      if (airline) recordLogbookSighting(current.id, airline, planeLevel(entry));
    });

    const sections = AIRPORTS.map((airport, index) => {
      const airportOpen = index <= state.unlockedMax;
      const airlines = airport.airlines || [];
      const seenCount = airlines.filter((a) =>
        isAirlineLogged(airport.id, a.id)
      ).length;
      const title = airportOpen
        ? `${airport.name} · ${airport.code}`
        : "??? · ???";
      const meta = airportOpen
        ? `${seenCount} / ${airlines.length} spotted`
        : "Airport locked";

      const rows = airlines
        .map((airline) => {
          const known = airportOpen && isAirlineLogged(airport.id, airline.id);
          if (!known) {
            return `
              <div class="logbook-entry unknown">
                <div class="logbook-flag">${mysteryFlagMarkup()}</div>
                <div class="logbook-entry-text">
                  <p class="logbook-entry-name">???</p>
                  <p class="logbook-entry-country">Country Flag · ???</p>
                </div>
              </div>`;
          }
          const country = FLAG_COUNTRY[airline.flag] || airline.flag || "???";
          const flag = flagSvg(airline.flag) || mysteryFlagMarkup();
          return `
            <div class="logbook-entry known">
              <div class="logbook-flag">${flag}</div>
              <div class="logbook-entry-text">
                <p class="logbook-entry-name">${airline.name}</p>
                <p class="logbook-entry-country">${country}</p>
              </div>
            </div>`;
        })
        .join("");

      return `
        <section class="logbook-airport${airportOpen ? "" : " locked"}">
          <div class="logbook-airport-head">
            <h3 class="logbook-airport-name">${title}</h3>
            <p class="logbook-airport-meta">${meta}</p>
          </div>
          <div class="logbook-airlines">${rows || '<p class="logbook-empty">No airlines listed</p>'}</div>
        </section>`;
    }).join("");

    logbookBody.innerHTML = sections || "<p class=\"logbook-empty\">No airports found.</p>";
  }

  function showLogbookPage() {
    if (logbookBody) logbookBody.innerHTML = "";
    renderLogbook();
    if (gamePage) gamePage.hidden = true;
    if (logbookPage) logbookPage.hidden = false;
    document.body.classList.add("on-logbook");
    window.scrollTo(0, 0);
  }

  function showGamePage() {
    if (logbookPage) logbookPage.hidden = true;
    if (gamePage) gamePage.hidden = false;
    document.body.classList.remove("on-logbook");
  }

  function openLogbook() {
    showLogbookPage();
    if (location.hash !== "#logbook") {
      history.pushState({ page: "logbook" }, "", "#logbook");
    }
  }

  function closeLogbook() {
    showGamePage();
    if (location.hash === "#logbook") {
      history.pushState(
        { page: "game" },
        "",
        `${location.pathname}${location.search}`
      );
    }
  }

  function syncPageFromHash() {
    if (location.hash === "#logbook") showLogbookPage();
    else showGamePage();
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2000);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function animateElement(el, keyframes, options) {
    return new Promise((resolve) => {
      const animation = el.animate(keyframes, {
        fill: "forwards",
        ...options,
      });
      animation.onfinish = () => resolve();
      animation.oncancel = () => resolve();
    });
  }

  function cellCenterPercent(index) {
    const cell = gridEl.querySelector(`.cell[data-index="${index}"]`);
    if (!cell) return { x: 50, y: 50 };
    const apronRect = apronEl.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    return {
      x: ((cellRect.left + cellRect.width / 2 - apronRect.left) / apronRect.width) * 100,
      y: ((cellRect.top + cellRect.height / 2 - apronRect.top) / apronRect.height) * 100,
    };
  }

  function planeSizePercent() {
    const apronRect = apronEl.getBoundingClientRect();
    const sample = gridEl.querySelector(".cell:not(.inactive)");
    if (!sample) return 16;
    const cellRect = sample.getBoundingClientRect();
    const byWidth = (cellRect.width * 0.92) / apronRect.width;
    const byHeight = (cellRect.height * 0.92 * 0.8) / apronRect.width;
    return Math.max(Math.min(byWidth, byHeight) * 100, 11);
  }

  function setRunwayActive(id, active) {
    document.querySelectorAll(".runway").forEach((el) => {
      el.classList.toggle("active", active && el.dataset.runway === id);
    });
  }

  const PLANE_FORMS = [
    null,
    { name: "Prop", kind: "prop-tiny" },
    { name: "Trainer", kind: "prop-big" },
    { name: "Twin Prop", kind: "twin-prop" },
    { name: "Turboprop", kind: "turboprop" },
    { name: "Regional", kind: "regional" },
    { name: "Narrow Jet", kind: "narrow" },
    { name: "Airliner", kind: "airliner" },
    { name: "Widebody", kind: "widebody" },
    { name: "Heavy", kind: "heavy" },
    { name: "Jumbo", kind: "jumbo" },
  ];

  function pickAirline(airport = currentAirport(), level = 1) {
    const lvl = Number(level) || 1;
    const pool = (airport.airlines || []).filter((item) => {
      const min = Number(item.minLevel ?? 1);
      const max = Number(item.maxLevel ?? MAX_LEVEL);
      return lvl >= min && lvl <= max;
    });
    // Never fall back to every airline — that put jet-only carriers on props.
    if (!pool.length) {
      return {
        id: "xx",
        name: "Charter",
        flag: airport.code === "LHR" ? "GB" : "AT",
      };
    }
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of pool) {
      roll -= item.weight;
      if (roll <= 0) {
        return { id: item.id, name: item.name, flag: item.flag };
      }
    }
    return { id: pool[0].id, name: pool[0].name, flag: pool[0].flag };
  }

  function airlineFitsLevel(airline, level, airport = currentAirport()) {
    if (!airline) return false;
    const lvl = Number(level) || 1;
    const def = (airport.airlines || []).find((item) => item.id === airline.id);
    if (!def) return false;
    const min = Number(def.minLevel ?? 1);
    const max = Number(def.maxLevel ?? MAX_LEVEL);
    return lvl >= min && lvl <= max;
  }

  function planeLevel(entry) {
    return entry && typeof entry === "object" ? entry.level : entry;
  }

  function planeAirline(entry) {
    return entry && typeof entry === "object" ? entry.airline : null;
  }

  function makePlane(level, airline = null) {
    const lvl = Number(level) || 1;
    const carrier = airlineFitsLevel(airline, lvl)
      ? airline
      : pickAirline(currentAirport(), lvl);
    return {
      level: lvl,
      airline: carrier,
    };
  }

  function sanitizeEntry(entry) {
    if (entry == null) return null;
    if (typeof entry !== "object") return makePlane(entry);
    return makePlane(entry.level, entry.airline);
  }

  function flagSvg(code) {
    if (!code) return "";
    const flags = {
      AT: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="2" fill="#ed2939"/><rect y="2" width="9" height="2" fill="#fff"/><rect y="4" width="9" height="2" fill="#ed2939"/></svg>`,
      DE: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="2" fill="#000"/><rect y="2" width="9" height="2" fill="#d00"/><rect y="4" width="9" height="2" fill="#ffce00"/></svg>`,
      CH: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#d52b1e"/><rect x="3.7" y="1.2" width="1.6" height="3.6" fill="#fff"/><rect x="2.7" y="2.2" width="3.6" height="1.6" fill="#fff"/></svg>`,
      HU: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="2" fill="#ce2939"/><rect y="2" width="9" height="2" fill="#fff"/><rect y="4" width="9" height="2" fill="#477050"/></svg>`,
      NL: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="2" fill="#ae1c28"/><rect y="2" width="9" height="2" fill="#fff"/><rect y="4" width="9" height="2" fill="#21468b"/></svg>`,
      GB: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#012169"/><path stroke="#fff" stroke-width="1.1" d="M0 0 L9 6 M9 0 L0 6"/><path stroke="#c8102e" stroke-width="0.55" d="M0 0 L9 6 M9 0 L0 6"/><path stroke="#fff" stroke-width="1.8" d="M4.5 0 V6 M0 3 H9"/><path stroke="#c8102e" stroke-width="1" d="M4.5 0 V6 M0 3 H9"/></svg>`,
      IE: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="3" height="6" fill="#169b62"/><rect x="3" width="3" height="6" fill="#fff"/><rect x="6" width="3" height="6" fill="#ff883e"/></svg>`,
      FR: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="3" height="6" fill="#0055a4"/><rect x="3" width="3" height="6" fill="#fff"/><rect x="6" width="3" height="6" fill="#ef4135"/></svg>`,
      AE: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="2" fill="#00732f"/><rect y="2" width="9" height="2" fill="#fff"/><rect y="4" width="9" height="2" fill="#000"/><rect width="2.4" height="6" fill="#ff0000"/></svg>`,
      QA: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#8d1b3d"/><path fill="#fff" d="M0 0 H3.2 L2.4 0.75 L3.2 1.5 L2.4 2.25 L3.2 3 L2.4 3.75 L3.2 4.5 L2.4 5.25 L3.2 6 H0 Z"/></svg>`,
      TR: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#e30a17"/><circle cx="3.3" cy="3" r="1.5" fill="#fff"/><circle cx="3.7" cy="3" r="1.2" fill="#e30a17"/><path fill="#fff" d="M5.3 3 L6.5 3.4 L5.5 2.35 L5.5 3.65 L6.5 2.6 Z"/></svg>`,
      JP: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#fff"/><circle cx="4.5" cy="3" r="1.55" fill="#bc002d"/></svg>`,
      KR: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#fff"/><circle cx="4.5" cy="3" r="1.4" fill="#cd2e3a"/><path fill="#0047a0" d="M4.5 3 a1.4 1.4 0 0 1 0 0.01 a1.4 1.4 0 0 0 -1.4 0 a1.4 1.4 0 0 1 1.4 -0.01"/></svg>`,
      US: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#fff"/><rect width="9" height="0.46" fill="#b22234"/><rect y="0.92" width="9" height="0.46" fill="#b22234"/><rect y="1.84" width="9" height="0.46" fill="#b22234"/><rect y="2.76" width="9" height="0.46" fill="#b22234"/><rect y="3.68" width="9" height="0.46" fill="#b22234"/><rect y="4.6" width="9" height="0.46" fill="#b22234"/><rect y="5.52" width="9" height="0.46" fill="#b22234"/><rect width="3.6" height="3.2" fill="#3c3b6e"/></svg>`,
      AU: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#00008b"/><rect width="4" height="3" fill="#012169"/><path stroke="#fff" stroke-width="0.5" d="M0 0 L4 3 M4 0 L0 3"/><path stroke="#c8102e" stroke-width="0.25" d="M0 0 L4 3 M4 0 L0 3"/><path stroke="#fff" stroke-width="0.8" d="M2 0 V3 M0 1.5 H4"/><path stroke="#c8102e" stroke-width="0.4" d="M2 0 V3 M0 1.5 H4"/><circle cx="6.6" cy="3.2" r="0.55" fill="#fff"/></svg>`,
      NZ: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#00247d"/><rect width="4" height="3" fill="#012169"/><path stroke="#fff" stroke-width="0.5" d="M0 0 L4 3 M4 0 L0 3"/><path stroke="#c8102e" stroke-width="0.25" d="M0 0 L4 3 M4 0 L0 3"/><path stroke="#fff" stroke-width="0.8" d="M2 0 V3 M0 1.5 H4"/><path stroke="#c8102e" stroke-width="0.4" d="M2 0 V3 M0 1.5 H4"/><g fill="#c8102e" stroke="#fff" stroke-width="0.12"><circle cx="6.2" cy="1.6" r="0.28"/><circle cx="7.2" cy="2.4" r="0.22"/><circle cx="6.5" cy="3.5" r="0.25"/><circle cx="7.4" cy="4.2" r="0.18"/></g></svg>`,
      SG: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="3" fill="#ed2939"/><rect y="3" width="9" height="3" fill="#fff"/><circle cx="2.2" cy="1.5" r="0.85" fill="#fff"/><circle cx="2.55" cy="1.5" r="0.7" fill="#ed2939"/><g fill="#fff"><circle cx="3.7" cy="0.85" r="0.18"/><circle cx="4.15" cy="1.15" r="0.18"/><circle cx="4.15" cy="1.85" r="0.18"/><circle cx="3.7" cy="2.15" r="0.18"/><circle cx="3.35" cy="1.5" r="0.18"/></g></svg>`,
      MY: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#fff"/><rect width="9" height="0.43" fill="#cc0001"/><rect y="0.86" width="9" height="0.43" fill="#cc0001"/><rect y="1.72" width="9" height="0.43" fill="#cc0001"/><rect y="2.58" width="9" height="0.43" fill="#cc0001"/><rect y="3.44" width="9" height="0.43" fill="#cc0001"/><rect y="4.3" width="9" height="0.43" fill="#cc0001"/><rect y="5.16" width="9" height="0.43" fill="#cc0001"/><rect width="4.2" height="3" fill="#010066"/><circle cx="2.3" cy="1.5" r="0.75" fill="#fc0"/><circle cx="2.55" cy="1.5" r="0.6" fill="#010066"/></svg>`,
      ID: `<svg class="plane-flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="3" fill="#ff0000"/><rect y="3" width="9" height="3" fill="#fff"/></svg>`,
    };
    return flags[code] || "";
  }

  function planeSvg(level) {
    const form = PLANE_FORMS[level] || PLANE_FORMS[1];
    const kind = form.kind;

    // Shared helpers drawn differently by evolution stage.
    if (kind === "prop-tiny") {
      return `
        <svg class="plane-art" data-kind="${kind}" viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <ellipse class="wing" cx="40" cy="52" rx="28" ry="5.5"/>
          <rect class="fuse" x="36.5" y="28" width="7" height="42" rx="3.5"/>
          <path class="nose" d="M36.5 30 Q40 20 43.5 30 Z"/>
          <rect class="cockpit" x="37.5" y="32" width="5" height="7" rx="1.5"/>
          <path class="tail" d="M28 74 L40 62 L52 74 Z"/>
          <g class="prop spinning" style="transform-origin: 40px 23px">
            <line x1="40" y1="22" x2="26" y2="30"/>
            <line x1="40" y1="22" x2="54" y2="30"/>
            <circle cx="40" cy="23" r="2.4"/>
          </g>
        </svg>`;
    }

    if (kind === "prop-big") {
      return `
        <svg class="plane-art" data-kind="${kind}" viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <ellipse class="wing" cx="40" cy="54" rx="34" ry="7"/>
          <ellipse class="wing-edge" cx="40" cy="52.5" rx="30" ry="3"/>
          <rect class="fuse" x="35.5" y="24" width="9" height="48" rx="4.5"/>
          <path class="nose" d="M35.5 27 Q40 16 44.5 27 Z"/>
          <rect class="cockpit" x="37" y="30" width="6" height="8" rx="2"/>
          <path class="tail" d="M24 78 L40 62 L56 78 Z"/>
          <rect class="fuse-tail" x="37" y="70" width="6" height="10" rx="2"/>
          <g class="prop spinning" style="transform-origin: 40px 19px">
            <line x1="40" y1="18" x2="22" y2="28"/>
            <line x1="40" y1="18" x2="58" y2="28"/>
            <line x1="40" y1="18" x2="40" y2="8"/>
            <circle cx="40" cy="19" r="2.8"/>
          </g>
        </svg>`;
    }

    if (kind === "twin-prop") {
      return `
        <svg class="plane-art" data-kind="${kind}" viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <ellipse class="wing" cx="40" cy="55" rx="36" ry="7.5"/>
          <rect class="fuse" x="35" y="22" width="10" height="52" rx="5"/>
          <path class="nose" d="M35 26 Q40 15 45 26 Z"/>
          <rect class="cockpit" x="36.5" y="28" width="7" height="9" rx="2"/>
          <rect class="eng" x="10" y="50" width="8" height="11" rx="2"/>
          <rect class="eng" x="62" y="50" width="8" height="11" rx="2"/>
          <g class="prop">
            <g class="spinning" style="transform-origin: 14px 49px">
              <line x1="14" y1="48" x2="6" y2="56"/><line x1="14" y1="48" x2="22" y2="56"/>
              <circle cx="14" cy="49" r="1.8"/>
            </g>
            <g class="spinning" style="transform-origin: 66px 49px">
              <line x1="66" y1="48" x2="58" y2="56"/><line x1="66" y1="48" x2="74" y2="56"/>
              <circle cx="66" cy="49" r="1.8"/>
            </g>
          </g>
          <path class="tail" d="M24 80 L40 64 L56 80 Z"/>
        </svg>`;
    }

    if (kind === "turboprop") {
      return `
        <svg class="plane-art" data-kind="${kind}" viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <ellipse class="wing" cx="40" cy="56" rx="38" ry="8"/>
          <ellipse class="wing-edge" cx="40" cy="54" rx="34" ry="3.5"/>
          <rect class="fuse" x="34" y="18" width="12" height="58" rx="6"/>
          <path class="nose" d="M34 24 Q40 12 46 24 Z"/>
          <rect class="cockpit" x="36" y="26" width="8" height="10" rx="2"/>
          <rect class="eng" x="8" y="51" width="10" height="14" rx="3"/>
          <rect class="eng" x="62" y="51" width="10" height="14" rx="3"/>
          <g class="prop">
            <g class="spinning" style="transform-origin: 13px 49px">
              <line x1="13" y1="48" x2="4" y2="58"/><line x1="13" y1="48" x2="22" y2="58"/>
              <circle cx="13" cy="49" r="2.2"/>
            </g>
            <g class="spinning" style="transform-origin: 67px 49px">
              <line x1="67" y1="48" x2="58" y2="58"/><line x1="67" y1="48" x2="76" y2="58"/>
              <circle cx="67" cy="49" r="2.2"/>
            </g>
          </g>
          <path class="tail" d="M22 82 L40 66 L58 82 Z"/>
          <rect class="fuse-tail" x="36.5" y="74" width="7" height="10" rx="2"/>
        </svg>`;
    }

    if (kind === "regional") {
      // Rear-mounted twin jet — first passenger jet stage
      return `
        <svg class="plane-art" data-kind="${kind}" viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <ellipse class="wing" cx="40" cy="58" rx="34" ry="7"/>
          <rect class="fuse" x="33.5" y="14" width="13" height="64" rx="6.5"/>
          <path class="nose" d="M33.5 20 Q40 8 46.5 20 Z"/>
          <rect class="cockpit" x="35.5" y="22" width="9" height="11" rx="2.5"/>
          <g class="windows">${windowStrip(36, 36, 8, 5, 4)}</g>
          <rect class="eng rear" x="27" y="66" width="8" height="14" rx="3"/>
          <rect class="eng rear" x="45" y="66" width="8" height="14" rx="3"/>
          <path class="tail" d="M22 86 L40 70 L58 86 Z"/>
          <path class="fin" d="M38 72 L40 58 L42 72 Z"/>
        </svg>`;
    }

    if (kind === "narrow") {
      return `
        <svg class="plane-art" data-kind="${kind}" viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <ellipse class="wing" cx="40" cy="56" rx="38" ry="8.5"/>
          <ellipse class="wing-edge" cx="40" cy="54" rx="34" ry="3.5"/>
          <rect class="fuse" x="33" y="12" width="14" height="68" rx="7"/>
          <path class="nose" d="M33 18 Q40 6 47 18 Z"/>
          <rect class="cockpit" x="35" y="20" width="10" height="12" rx="2.5"/>
          <g class="windows">${windowStrip(35.5, 35, 9, 6, 4)}</g>
          <rect class="eng" x="8" y="52" width="10" height="16" rx="4"/>
          <rect class="eng" x="62" y="52" width="10" height="16" rx="4"/>
          <ellipse class="intake" cx="13" cy="52" rx="4" ry="2.2"/>
          <ellipse class="intake" cx="67" cy="52" rx="4" ry="2.2"/>
          <path class="tail" d="M20 88 L40 70 L60 88 Z"/>
          <path class="fin" d="M38 74 L40 58 L42 74 Z"/>
        </svg>`;
    }

    if (kind === "airliner") {
      return `
        <svg class="plane-art" data-kind="${kind}" viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <ellipse class="wing" cx="40" cy="55" rx="40" ry="9"/>
          <ellipse class="wing-edge" cx="40" cy="53" rx="36" ry="4"/>
          <rect class="fuse" x="32" y="10" width="16" height="72" rx="8"/>
          <path class="nose" d="M32 16 Q40 4 48 16 Z"/>
          <rect class="cockpit" x="34.5" y="18" width="11" height="12" rx="2.5"/>
          <g class="windows">${windowStrip(34.5, 34, 11, 7, 3.8)}</g>
          <rect class="eng" x="6" y="50" width="11" height="18" rx="4"/>
          <rect class="eng" x="63" y="50" width="11" height="18" rx="4"/>
          <ellipse class="intake" cx="11.5" cy="50" rx="4.5" ry="2.4"/>
          <ellipse class="intake" cx="68.5" cy="50" rx="4.5" ry="2.4"/>
          <path class="tail" d="M18 90 L40 70 L62 90 Z"/>
          <path class="fin" d="M37.5 76 L40 56 L42.5 76 Z"/>
          <rect class="door" x="38.5" y="48" width="3" height="6" rx="0.8"/>
        </svg>`;
    }

    if (kind === "widebody") {
      return `
        <svg class="plane-art" data-kind="${kind}" viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <ellipse class="wing" cx="40" cy="54" rx="42" ry="10"/>
          <ellipse class="wing-edge" cx="40" cy="52" rx="38" ry="4.5"/>
          <rect class="fuse" x="30" y="8" width="20" height="76" rx="10"/>
          <path class="nose" d="M30 15 Q40 2 50 15 Z"/>
          <rect class="cockpit" x="33" y="16" width="14" height="13" rx="3"/>
          <g class="windows">${windowStrip(33, 33, 14, 8, 3.5)}</g>
          <rect class="eng" x="4" y="48" width="12" height="20" rx="5"/>
          <rect class="eng" x="64" y="48" width="12" height="20" rx="5"/>
          <ellipse class="intake" cx="10" cy="48" rx="5" ry="2.6"/>
          <ellipse class="intake" cx="70" cy="48" rx="5" ry="2.6"/>
          <path class="tail" d="M16 92 L40 70 L64 92 Z"/>
          <path class="fin" d="M37 78 L40 54 L43 78 Z"/>
        </svg>`;
    }

    if (kind === "heavy") {
      return `
        <svg class="plane-art" data-kind="${kind}" viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <ellipse class="wing" cx="40" cy="54" rx="44" ry="11"/>
          <ellipse class="wing-edge" cx="40" cy="51.5" rx="40" ry="4.5"/>
          <rect class="fuse" x="29" y="6" width="22" height="80" rx="11"/>
          <path class="nose" d="M29 14 Q40 0 51 14 Z"/>
          <rect class="cockpit" x="32" y="15" width="16" height="14" rx="3"/>
          <g class="windows">${windowStrip(32, 32, 16, 9, 3.2)}</g>
          <rect class="eng" x="2" y="46" width="11" height="18" rx="4"/>
          <rect class="eng" x="14" y="50" width="9" height="15" rx="3.5"/>
          <rect class="eng" x="57" y="50" width="9" height="15" rx="3.5"/>
          <rect class="eng" x="67" y="46" width="11" height="18" rx="4"/>
          <path class="tail" d="M14 94 L40 70 L66 94 Z"/>
          <path class="fin" d="M36.5 80 L40 52 L43.5 80 Z"/>
        </svg>`;
    }

    // Jumbo — double-deck hint + 4 engines
    return `
      <svg class="plane-art" data-kind="${kind}" viewBox="0 0 80 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <ellipse class="wing" cx="40" cy="55" rx="46" ry="12"/>
        <ellipse class="wing-edge" cx="40" cy="52" rx="42" ry="5"/>
        <rect class="fuse" x="27" y="5" width="26" height="82" rx="12"/>
        <rect class="deck" x="30" y="18" width="20" height="22" rx="6"/>
        <path class="nose" d="M27 14 Q40 -2 53 14 Z"/>
        <rect class="cockpit" x="31" y="14" width="18" height="12" rx="3"/>
        <g class="windows">${windowStrip(31, 40, 18, 10, 3)}</g>
        <rect class="eng" x="1" y="46" width="12" height="20" rx="5"/>
        <rect class="eng" x="14" y="51" width="10" height="16" rx="4"/>
        <rect class="eng" x="56" y="51" width="10" height="16" rx="4"/>
        <rect class="eng" x="67" y="46" width="12" height="20" rx="5"/>
        <ellipse class="intake" cx="7" cy="46" rx="5" ry="2.5"/>
        <ellipse class="intake" cx="73" cy="46" rx="5" ry="2.5"/>
        <path class="tail" d="M12 96 L40 70 L68 96 Z"/>
        <path class="fin" d="M36 82 L40 50 L44 82 Z"/>
      </svg>`;
  }

  function windowStrip(x, y, width, count, gap) {
    let html = "";
    const w = 1.6;
    const start = x + 1.5;
    for (let i = 0; i < count; i += 1) {
      html += `<rect class="window" x="${start + i * gap}" y="${y}" width="${w}" height="3.2" rx="0.6"/>`;
    }
    return html;
  }

  function planeMarkup(level, airline = null) {
    const form = PLANE_FORMS[level] || PLANE_FORMS[1];
    const showFlag = level >= 3 && airline;
    const flag = showFlag ? flagSvg(airline.flag) : "";
    const flagTitle = showFlag ? ` title="${airline.name}"` : "";
    return `
      ${planeSvg(level)}
      ${flag ? `<span class="plane-flag-wrap"${flagTitle}>${flag}</span>` : ""}
      ${showFlag ? `<span class="plane-airline">${airline.name}</span>` : ""}
      <span class="plane-form">${form.name}</span>
      <span class="plane-level">L${level}</span>
    `;
  }

  function createFlightPlane(level, airline = null) {
    const plane = document.createElement("div");
    const size = Math.max(planeSizePercent(), 12);
    plane.className = `flight-plane lvl-${level}`;
    plane.style.width = `${size}%`;
    plane.style.height = "auto";
    plane.innerHTML = planeMarkup(level, airline);
    flightLayer.appendChild(plane);
    return plane;
  }

  function placeFlightPlane(plane, pos, rotate = 0, scale = 1) {
    plane.style.left = `${pos.x}%`;
    plane.style.top = `${pos.y}%`;
    plane.style.transform = `translate(-50%, -50%) rotate(${rotate}deg) scale(${scale})`;
  }

  function headingBetween(from, to) {
    const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    return angle + 90;
  }

  async function flyTo(plane, from, to, {
    duration = 700,
    easing = "ease-in-out",
    startScale = 1,
    endScale = 1,
    startRotate = null,
    endRotate = null,
    airborne = false,
    startOpacity = 1,
    endOpacity = 1,
  } = {}) {
    const startRot = startRotate ?? headingBetween(from, to);
    const endRot = endRotate ?? startRot;
    placeFlightPlane(plane, from, startRot, startScale);
    plane.classList.toggle("airborne", airborne);

    await animateElement(
      plane,
      [
        {
          left: `${from.x}%`,
          top: `${from.y}%`,
          transform: `translate(-50%, -50%) rotate(${startRot}deg) scale(${startScale})`,
          opacity: startOpacity,
        },
        {
          left: `${to.x}%`,
          top: `${to.y}%`,
          transform: `translate(-50%, -50%) rotate(${endRot}deg) scale(${endScale})`,
          opacity: endOpacity,
        },
      ],
      { duration, easing }
    );

    placeFlightPlane(plane, to, endRot, endScale);
    plane.style.opacity = String(endOpacity);
  }

  function updateHud() {
    coinsEl.textContent = state.coins;
    contractsEl.textContent = state.contracts;
    arrivalLevelEl.textContent = `L${state.arrivalLevel}`;

    const canLand =
      !landingLocked() && state.contracts > 0 && emptySlots().length > 0;
    const canLaunch =
      !takeoffLocked() &&
      state.selected !== null &&
      state.cells[state.selected] !== null;
    const nextArrival = state.arrivalLevel + 1;
    const maxed = state.arrivalLevel >= MAX_LEVEL;
    const upgradeCost = maxed ? 0 : CONTRACT_UPGRADE_COST[nextArrival];

    landBtn.disabled = !canLand;
    launchBtn.disabled = !canLaunch;
    buyBtn.disabled = anyBusy() || state.coins < CONTRACT_COST;
    buyBtn.textContent = `Buy Contract · ${CONTRACT_COST}`;

    upgradeBtn.disabled =
      anyBusy() || maxed || state.coins < upgradeCost;
    upgradeBtn.classList.toggle("owned", maxed);
    if (maxed) {
      upgradeBtn.textContent = "Arrivals Maxed · L10";
    } else {
      upgradeBtn.textContent = `Contract Upgrade · L${nextArrival} · ${upgradeCost.toLocaleString("en-US")}`;
    }

    if (anyBusy()) {
      hintEl.textContent = "Aircraft moving on the field…";
    } else if (state.contracts <= 0 && emptySlots().length === 0) {
      hintEl.textContent = "Buy a contract or launch a plane for coins.";
    } else if (state.contracts <= 0) {
      hintEl.textContent = "Out of contracts — buy another, or merge & launch.";
    } else if (emptySlots().length === 0) {
      hintEl.textContent = "Grid full — merge planes or launch one.";
    } else if (state.arrivalLevel === 1) {
      hintEl.textContent =
        "Start at Vienna. Land planes to fill your Logbook · launch an L10 Jumbo to unlock the next airport.";
    } else if (!maxed) {
      const form = PLANE_FORMS[state.arrivalLevel];
      hintEl.textContent = `Arrivals at L${state.arrivalLevel} (${form.name}). Launch a L10 Jumbo to unlock new airports.`;
    } else {
      hintEl.textContent =
        "Arrivals maxed — contracts land as Level 10 Jumbos.";
    }

    updatePotdPanel();
  }

  async function animateLandingToSlot(slot, level, airline, arriving) {
    const pad = cellCenterPercent(slot);
    const path = landingPath();
    const airport = currentAirport();

    setRunwayActive(airport.landingRunway, true);

    const plane = createFlightPlane(level, airline);
    placeFlightPlane(plane, path.approach, path.heading, 0.55);
    plane.style.opacity = "0";

    await flyTo(plane, path.approach, path.touchdown, {
      duration: 1000,
      easing: "cubic-bezier(0.25, 0.8, 0.25, 1)",
      startScale: 0.55,
      endScale: 1,
      startRotate: path.heading,
      endRotate: path.heading,
      airborne: true,
      startOpacity: 0,
      endOpacity: 1,
    });

    plane.classList.remove("airborne");
    await sleep(80);

    await flyTo(plane, path.touchdown, path.rollout, {
      duration: 900,
      easing: "ease-out",
      startRotate: path.heading,
      endRotate: path.heading,
    });

    showToast("Taxiing to stand…");
    const exitHeading = headingBetween(path.rollout, path.exit);
    await flyTo(plane, path.rollout, path.exit, {
      duration: 280,
      easing: "ease-in-out",
      startRotate: path.heading,
      endRotate: exitHeading,
    });

    const taxiHeading = headingBetween(path.exit, pad);
    await flyTo(plane, path.exit, pad, {
      duration: 700,
      easing: "ease-in-out",
      startRotate: taxiHeading,
      endRotate: taxiHeading,
    });

    await sleep(60);
    plane.remove();
    setRunwayActive(airport.landingRunway, false);

    state.reserved[slot] = false;
    state.cells[slot] = arriving;
    if (state.selected === null) state.selected = slot;
  }

  function render() {
    if (!gridEl) return;
    gridEl.innerHTML = "";
    const total = slotCount();

    for (let i = 0; i < total; i += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.index = String(i);

      if (!isActiveSlot(i)) {
        cell.classList.add("inactive");
        gridEl.appendChild(cell);
        continue;
      }

      if (state.reserved[i]) cell.classList.add("reserved");
      cell.addEventListener("dragover", onDragOver);
      cell.addEventListener("dragleave", onDragLeave);
      cell.addEventListener("drop", onDrop);
      cell.addEventListener("click", () => onCellClick(i));

      const entry = sanitizeEntry(state.cells[i]);
      state.cells[i] = entry;
      if (entry !== null) {
        const level = planeLevel(entry);
        const airline = planeAirline(entry);
        const plane = document.createElement("button");
        plane.type = "button";
        plane.className = `plane lvl-${level}`;
        plane.draggable = !anyBusy();
        plane.dataset.index = String(i);
        const airlineLabel = airline ? `, ${airline.name}` : "";
        plane.setAttribute("aria-label", `Level ${level} plane${airlineLabel}`);
        if (state.selected === i) plane.classList.add("selected");

        plane.innerHTML = planeMarkup(level, airline);

        // Selecting is always allowed (e.g. to launch while another plane lands);
        // dragging to move/merge stays locked while anything is on the move.
        plane.addEventListener("click", (e) => {
          e.stopPropagation();
          onPlaneClick(i);
        });
        if (!anyBusy()) {
          plane.addEventListener("dragstart", onDragStart);
          plane.addEventListener("dragend", onDragEnd);
        }

        cell.appendChild(plane);
      }

      gridEl.appendChild(cell);
    }

    renderAirportSwitcher();
    updateHud();
  }

  async function landContract() {
    if (landingLocked()) return;
    if (state.contracts <= 0) {
      showToast("No contracts left");
      return;
    }

    const free = emptySlots();
    if (free.length === 0) {
      showToast("No empty parking spots");
      return;
    }

    const slot = free[Math.floor(Math.random() * free.length)];

    state.landingBusy = true;
    state.contracts -= 1;
    state.reserved[slot] = true;
    render();

    const airport = currentAirport();

    const arrivalLevel = state.arrivalLevel;
    const form = PLANE_FORMS[arrivalLevel];
    const airline = pickAirline(airport, arrivalLevel);
    const arriving = makePlane(arrivalLevel, airline);
    const spotted = recordLogbookSighting(
      airport.id,
      planeAirline(arriving) || airline,
      arrivalLevel
    );

    showToast(
      spotted
        ? `On final · new Logbook entry · ${airline.name}`
        : `On final · ${airline.name} ${form.name}`
    );

    await animateLandingToSlot(slot, arrivalLevel, airline, arriving);

    state.landingBusy = false;
    showToast(`Parked · ${airline.name} L${arrivalLevel}`);
    render();
  }

  async function landPlaneOfTheDay() {
    if (landingLocked()) return;
    if (potdLandedToday()) {
      showToast("You already landed today's Plane of the Day");
      return;
    }

    const free = emptySlots();
    if (free.length === 0) {
      showToast("No empty parking spots");
      return;
    }

    const potd = getPlaneOfTheDay();
    const slot = free[Math.floor(Math.random() * free.length)];
    const form = PLANE_FORMS[potd.level];
    const airline = potd.airline;
    const arriving = makePlane(potd.level, airline);

    state.landingBusy = true;
    state.reserved[slot] = true;
    render();

    const spotted = recordLogbookSighting(
      currentAirport().id,
      planeAirline(arriving) || airline,
      potd.level
    );

    showToast(
      spotted
        ? `Plane of the Day · ${airline.name} · new Logbook entry`
        : `Plane of the Day · ${airline.name} ${form.name}`
    );

    await animateLandingToSlot(slot, potd.level, airline, arriving);

    markPotdLanded();
    state.landingBusy = false;
    showToast(`Plane of the Day parked · ${airline.name} L${potd.level}`);
    render();
  }

  async function launchPlane() {
    if (takeoffLocked()) return;
    if (state.selected === null) {
      showToast("Select a plane to launch");
      return;
    }

    const index = state.selected;
    const entry = state.cells[index];
    if (!entry) return;
    const level = planeLevel(entry);
    const airline = planeAirline(entry);

    const payout = TAKEOFF_PAYOUT[level];
    const pad = cellCenterPercent(index);
    const path = takeoffPath();
    const airport = currentAirport();

    state.takeoffBusy = true;
    state.cells[index] = null;
    state.selected = null;
    render();
    showToast("Taxiing to runway…");
    setRunwayActive(airport.takeoffRunway, true);

    const plane = createFlightPlane(level, airline);
    const toHold = headingBetween(pad, path.hold);
    placeFlightPlane(plane, pad, toHold, 1);

    await flyTo(plane, pad, path.hold, {
      duration: 650,
      easing: "ease-in-out",
      startRotate: toHold,
      endRotate: path.heading,
    });

    await flyTo(plane, path.hold, path.lineup, {
      duration: 320,
      easing: "ease-in-out",
      startRotate: path.heading,
      endRotate: path.heading,
    });

    await sleep(100);
    showToast("Rolling…");

    // Accelerate down the takeoff runway
    await flyTo(plane, path.lineup, path.rotate, {
      duration: 850,
      easing: "cubic-bezier(0.4, 0, 0.7, 1)",
      startScale: 1,
      endScale: 1,
      startRotate: path.heading,
      endRotate: path.heading,
    });

    showToast("Airborne…");
    plane.classList.add("airborne");

    await flyTo(plane, path.rotate, path.climb, {
      duration: 900,
      easing: "cubic-bezier(0.35, 0.05, 0.55, 1)",
      startScale: 1,
      endScale: 0.4,
      startRotate: path.heading,
      endRotate: path.heading - 8,
      airborne: true,
      startOpacity: 1,
      endOpacity: 0,
    });

    plane.remove();
    setRunwayActive(airport.takeoffRunway, false);

    state.coins += payout;
    state.takeoffBusy = false;

    let unlockMsg = "";
    if (level >= MAX_LEVEL && state.unlockedMax < AIRPORTS.length - 1) {
      saveCurrentAirport();
      state.unlockedMax += 1;
      const unlocked = AIRPORTS[state.unlockedMax];
      unlockMsg = ` · Unlocked ${unlocked.name}! Starts with fresh progress.`;
    }

    showToast(`Launched · +${payout} coins${unlockMsg}`);
    render();
  }

  function buyContract() {
    if (anyBusy()) return;
    if (state.coins < CONTRACT_COST) {
      showToast("Not enough coins");
      return;
    }
    state.coins -= CONTRACT_COST;
    state.contracts += 1;
    showToast("Contract purchased");
    render();
  }

  function buyContractUpgrade() {
    if (anyBusy()) return;
    if (state.arrivalLevel >= MAX_LEVEL) {
      showToast("Arrivals already maxed");
      return;
    }

    const nextArrival = state.arrivalLevel + 1;
    const cost = CONTRACT_UPGRADE_COST[nextArrival];
    if (state.coins < cost) {
      showToast("Not enough coins");
      return;
    }

    state.coins -= cost;
    state.arrivalLevel = nextArrival;
    const form = PLANE_FORMS[nextArrival];
    showToast(`Upgrade bought — arrivals land as ${form.name} L${nextArrival}`);
    render();
  }

  function tryMerge(from, to) {
    if (anyBusy()) return false;
    if (from === to) return false;
    const a = state.cells[from];
    const b = state.cells[to];
    if (a === null || b === null) return false;
    const levelA = planeLevel(a);
    const levelB = planeLevel(b);
    if (levelA !== levelB) {
      showToast("Planes must be the same level");
      return false;
    }
    if (levelA >= MAX_LEVEL) {
      showToast("Max level reached");
      return false;
    }

    const keepAirline =
      Math.random() < 0.5 ? planeAirline(a) : planeAirline(b);
    const nextLevel = levelA + 1;
    state.cells[from] = null;
    state.cells[to] = makePlane(nextLevel, keepAirline);
    state.selected = to;
    const evolved = PLANE_FORMS[nextLevel];
    const carrier = keepAirline ? keepAirline.name : evolved.name;
    showToast(`Evolved into ${carrier} ${evolved.name} · L${nextLevel}`);
    render();

    const plane = gridEl.querySelector(`.plane[data-index="${to}"]`);
    if (plane) {
      plane.classList.add("merged", "evolving");
      const art = plane.querySelector(".plane-art");
      if (art) art.classList.add("evolve-flash");
    }
    return true;
  }

  function tryMove(from, to) {
    if (anyBusy()) return false;
    if (from === to) return false;
    if (state.cells[to] !== null) return tryMerge(from, to);
    state.cells[to] = state.cells[from];
    state.cells[from] = null;
    state.selected = to;
    render();
    return true;
  }

  function onPlaneClick(index) {
    // Merging requires an idle field, but selecting (e.g. to launch while
    // another plane is landing) is always allowed.
    if (!anyBusy() && state.selected !== null && state.selected !== index) {
      const from = state.selected;
      const a = state.cells[from];
      const b = state.cells[index];
      if (a !== null && b !== null && planeLevel(a) === planeLevel(b)) {
        tryMerge(from, index);
        return;
      }
    }
    state.selected = state.selected === index ? null : index;
    render();
  }

  function onCellClick(index) {
    if (anyBusy() || !isActiveSlot(index)) return;
    if (state.cells[index] !== null) return;
    if (state.selected === null) return;
    tryMove(state.selected, index);
  }

  function onDragStart(e) {
    if (anyBusy()) {
      e.preventDefault();
      return;
    }
    const index = Number(e.currentTarget.dataset.index);
    state.dragFrom = index;
    state.selected = index;
    e.currentTarget.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    render();
  }

  function onDragEnd(e) {
    e.currentTarget.classList.remove("dragging");
    state.dragFrom = null;
    clearDropHints();
  }

  function onDragOver(e) {
    if (anyBusy()) return;
    e.preventDefault();
    const cell = e.currentTarget;
    const to = Number(cell.dataset.index);
    const from = state.dragFrom;
    if (from === null || from === to) return;

    clearDropHints();
    const target = state.cells[to];
    const source = state.cells[from];
    const targetLevel = planeLevel(target);
    const sourceLevel = planeLevel(source);

    if (target === null) {
      cell.classList.add("drop-target");
    } else if (targetLevel === sourceLevel && sourceLevel < MAX_LEVEL) {
      cell.classList.add("merge-ok");
    }
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove("drop-target", "merge-ok");
  }

  function onDrop(e) {
    if (anyBusy()) return;
    e.preventDefault();
    clearDropHints();
    const to = Number(e.currentTarget.dataset.index);
    const from = Number(e.dataTransfer.getData("text/plain"));
    if (Number.isNaN(from)) return;
    tryMove(from, to);
    state.dragFrom = null;
  }

  function clearDropHints() {
    gridEl.querySelectorAll(".cell").forEach((cell) => {
      cell.classList.remove("drop-target", "merge-ok");
    });
  }

  landBtn.addEventListener("click", landContract);
  buyBtn.addEventListener("click", buyContract);
  upgradeBtn.addEventListener("click", buyContractUpgrade);
  launchBtn.addEventListener("click", launchPlane);
  if (potdBtn) potdBtn.addEventListener("click", landPlaneOfTheDay);

  if (logbookBtn) logbookBtn.addEventListener("click", openLogbook);
  if (logbookBackBtn) logbookBackBtn.addEventListener("click", closeLogbook);
  window.addEventListener("popstate", syncPageFromHash);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && logbookPage && !logbookPage.hidden) {
      closeLogbook();
    }
  });

  loadLogbook();
  syncPageFromHash();
  loadAirportProgress(0);
  buildApron();
  renderAirportSwitcher();
  render();

  // Back-forward cache can restore an old in-memory game — force a real reload
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) window.location.reload();
  });
})();
