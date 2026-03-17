// =============================================================
// Country Match — script.js
// =============================================================

// === DIFFICULTY ===
// Five population-based tiers (0 = most recognisable, 4 = micro-states).
// Tier 4 only appears in Hard and Expert.
const DIFFICULTY_PATTERNS = {
  easy:   [0, 0, 1, 1, 1],
  medium: [0, 1, 1, 2, 3],
  hard:   [1, 2, 2, 3, 4],
  expert: [2, 3, 3, 4, 4],
};

// Population bucket boundaries (lower bound inclusive, upper bound exclusive)
const POP_TIERS = [
  { min: 50_000_000 },  // 0 — well-known large nations
  { min: 10_000_000 },  // 1 — mid-sized, recognisable
  { min:  1_000_000 },  // 2 — smaller nations
  { min:    100_000 },  // 3 — obscure
  { min:      5_000 },  // 4 — micro-states & tiny islands (Hard/Expert only)
];

// Column order — Country is leftmost as requested
const CARD_TYPES  = ['country', 'flag', 'capital', 'population', 'shape'];
const COL_HEADERS = ['Country', 'Flag', 'Capital', 'Population', 'Shape'];
const MATCH_COLORS = ['matched-0', 'matched-1', 'matched-2', 'matched-3', 'matched-4'];

// === DATA FETCHING ===
// Both fetches start immediately on page load so they're ready by the time
// the player chooses a difficulty.

let allCountriesPromise = fetchAllCountries();
let worldDataPromise    = loadWorldData();

// Fetch every country once; filter and bucket by population for the session.
async function fetchAllCountries() {
  const url = 'https://restcountries.com/v3.1/all?fields=name,capital,population,flags,cca3,ccn3';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`REST Countries API error ${res.status}`);
  const all = await res.json();

  // Keep only entries that have everything the game needs
  const valid = all.filter(c =>
    c.name?.common &&
    c.flags?.png &&
    Array.isArray(c.capital) && c.capital.length > 0 &&
    c.population >= 5_000,
  );

  return bucketByPopulation(valid);
}

function bucketByPopulation(countries) {
  const buckets = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  for (const c of countries) {
    const p = c.population;
    if      (p >= 50_000_000) buckets[0].push(c);
    else if (p >= 10_000_000) buckets[1].push(c);
    else if (p >=  1_000_000) buckets[2].push(c);
    else if (p >=    100_000) buckets[3].push(c);
    else                      buckets[4].push(c); // >= 5 000 already filtered above
  }
  return buckets;
}

function pickCountries(buckets, difficulty) {
  const pattern = DIFFICULTY_PATTERNS[difficulty] ?? DIFFICULTY_PATTERNS.medium;
  const used = new Set();
  const result = [];
  for (const tier of pattern) {
    const pool = (buckets[tier] ?? []).filter(c => !used.has(c.cca3));
    if (pool.length === 0) {
      console.warn(`Tier ${tier} exhausted — skipping`);
      continue;
    }
    const chosen = pickRandom(pool);
    used.add(chosen.cca3);
    result.push(chosen);
  }
  return result;
}

// === WORLD ATLAS (50m topojson for country shapes) ===
let worldFeatures = null;

async function loadWorldData() {
  if (typeof topojson === 'undefined') {
    console.warn('topojson-client not available — shape cards will show placeholder');
    return;
  }
  try {
    const topo = await fetch(
      'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
    ).then(r => r.json());
    const fc = topojson.feature(topo, topo.objects.countries);
    worldFeatures = {};
    fc.features.forEach(f => { worldFeatures[f.id] = f; }); // f.id = numeric ISO
  } catch (e) {
    console.warn('World atlas load failed — shapes will show placeholder', e);
  }
}

// Rough polygon area via shoelace (geographic coords, good enough for relative comparison)
function geoArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

// Render an inline SVG silhouette from a GeoJSON feature.
// For MultiPolygon countries (archipelagos) tiny island fragments are filtered
// out so the rendering stays clean.
function makeShapeSvg(feature) {
  if (!feature?.geometry) return '<span class="shape-missing">?</span>';

  const geom = feature.geometry;

  // Normalise to an array of polygon-rings arrays
  let polygons;
  if (geom.type === 'Polygon') {
    polygons = [geom.coordinates];
  } else if (geom.type === 'MultiPolygon') {
    polygons = geom.coordinates;
  } else {
    return '<span class="shape-missing">?</span>';
  }

  // Filter tiny fragments: keep only polygons with >= 2 % of the largest polygon's area.
  // This cleans up archipelagos without removing meaningful islands.
  if (polygons.length > 1) {
    const ranked = polygons.map(p => ({ p, a: geoArea(p[0]) }));
    const maxArea = Math.max(...ranked.map(x => x.a));
    const threshold = maxArea * 0.02;
    const kept = ranked.filter(x => x.a >= threshold).map(x => x.p);
    polygons = kept.length > 0 ? kept : [polygons[0]];
  }

  // Bounding box of the kept polygons
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  if (!isFinite(minLon) || maxLon <= minLon) return '<span class="shape-missing">?</span>';

  const W = 100, H = 100, PAD = 10;
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat || lonSpan;
  const scale   = Math.min((W - 2 * PAD) / lonSpan, (H - 2 * PAD) / latSpan);
  const dx      = (W - lonSpan * scale) / 2;
  const dy      = (H - latSpan * scale) / 2;

  function pt([lon, lat]) {
    return `${((lon - minLon) * scale + dx).toFixed(1)},${(H - ((lat - minLat) * scale + dy)).toFixed(1)}`;
  }

  function ringToD(ring) {
    return ring.length >= 3 ? 'M' + ring.map(pt).join('L') + 'Z' : '';
  }

  const d = polygons.flatMap(poly => poly.map(ringToD)).filter(Boolean).join(' ');
  if (!d) return '<span class="shape-missing">?</span>';

  return `<svg viewBox="0 0 ${W} ${H}" class="shape-svg"><path d="${d}" class="shape-path" fill-rule="evenodd"/></svg>`;
}

// === GAME STATE ===
let state = createInitialState();

function createInitialState() {
  return {
    countries: [],
    cards: [],
    selectedCountry: null,
    selectedSecondary: [],
    matched: {},
    mistakes: 0,
    startTime: null,
    done: false,
    colorIdx: 0,
    busy: false,
  };
}

// === DOM REFS ===
const $loading        = document.getElementById('loading-screen');
const $loadingMsg     = document.getElementById('loading-message');
const $retryBtn       = document.getElementById('retry-btn');
const $diffPicker     = document.getElementById('difficulty-picker');
const $game           = document.getElementById('game-screen');
const $grid           = document.getElementById('card-grid');
const $dots           = document.getElementById('progress-dots');
const $statMatched    = document.getElementById('stat-matched');
const $statMistakes   = document.getElementById('stat-mistakes');
const $results        = document.getElementById('results-screen');
const $resultTime     = document.getElementById('result-time');
const $resultMistakes = document.getElementById('result-mistakes');
const $playAgain      = document.getElementById('play-again-btn');

document.querySelectorAll('.btn--diff').forEach(btn => {
  btn.addEventListener('click', () => startGame(btn.dataset.difficulty));
});
$retryBtn.addEventListener('click', resetToStart);
$playAgain.addEventListener('click', resetToStart);

// === UTILITIES ===

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatPopulation(pop) {
  if (pop >= 1e9) return (pop / 1e9).toFixed(1) + 'B';
  if (pop >= 1e6) return (pop / 1e6).toFixed(1) + 'M';
  if (pop >= 1e3) return Math.round(pop / 1e3) + 'K';
  return String(pop);
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function showScreen(id) {
  [$loading, $game, $results].forEach(el => { el.hidden = el.id !== id; });
}

function getCardEl(id) {
  return $grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
}

function resetToStart() {
  $diffPicker.hidden = false;
  $loadingMsg.hidden = true;
  $retryBtn.hidden = true;
  showScreen('loading-screen');
}

// === CARD BUILDING ===
// Cards sit in a 5-column grid (one column per type).
// Each column is shuffled independently so the correct row varies per column.

function buildCards(countries) {
  const cards = [];
  CARD_TYPES.forEach((type, colIdx) => {
    const rowOrder = shuffle([...Array(countries.length).keys()]);
    rowOrder.forEach((countryIdx, rowIdx) => {
      const country = countries[countryIdx];
      cards.push({
        id: `${country.cca3}-${type}`,
        type,
        countryIdx,
        cca3: country.cca3,
        gridCol: colIdx + 1,
        gridRow: rowIdx + 2, // row 1 = column headers
      });
    });
  });
  return cards;
}

// === RENDER ===

function renderGame() {
  $dots.innerHTML = '';
  state.countries.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'progress-dot';
    dot.dataset.idx = i;
    $dots.appendChild(dot);
  });

  $grid.innerHTML = '';

  COL_HEADERS.forEach((label, i) => {
    const h = document.createElement('div');
    h.className = 'col-header';
    h.textContent = label;
    h.style.gridColumn = String(i + 1);
    h.style.gridRow = '1';
    $grid.appendChild(h);
  });

  state.cards.forEach(card => $grid.appendChild(createCardEl(card)));
  updateStats();
}

function createCardEl(card) {
  const country = state.countries[card.countryIdx];
  const el = document.createElement('div');
  el.className = `card card--${card.type}`;
  el.dataset.id = card.id;
  el.style.gridColumn = String(card.gridCol);
  el.style.gridRow    = String(card.gridRow);
  el.innerHTML = `<div class="card-content">${cardInnerHTML(card, country)}</div>`;
  el.addEventListener('click', () => handleCardClick(card.id));
  return el;
}

function cardInnerHTML(card, country) {
  switch (card.type) {
    case 'country':
      return `<span>${country.name.common}</span>`;
    case 'flag':
      return `<img src="${country.flags.png}" alt="Flag of ${country.name.common}" loading="lazy" />`;
    case 'capital':
      return `<span>${country.capital?.[0] ?? '—'}</span>`;
    case 'population':
      return `<span>${formatPopulation(country.population)}</span>`;
    case 'shape': {
      const numericId = parseInt(country.ccn3 || '0', 10);
      return makeShapeSvg(worldFeatures?.[numericId]);
    }
  }
}

function updateStats() {
  const n = Object.keys(state.matched).length;
  $statMatched.textContent  = `Matched: ${n} / 5`;
  $statMistakes.textContent = `Mistakes: ${state.mistakes}`;
}

// === INTERACTION ===

function handleCardClick(cardId) {
  if (state.done || state.busy) return;
  const card = state.cards.find(c => c.id === cardId);
  if (!card || state.matched[card.cca3]) return;

  if (card.type === 'country') {
    handleCountryClick(cardId);
  } else {
    handleSecondaryClick(cardId);
  }
}

function handleCountryClick(cardId) {
  const el = getCardEl(cardId);
  if (state.selectedCountry === cardId) {
    state.selectedCountry = null;
    clearSecondarySelection();
    el.classList.remove('card--selected-country');
    return;
  }
  if (state.selectedCountry) {
    getCardEl(state.selectedCountry)?.classList.remove('card--selected-country');
  }
  clearSecondarySelection();
  state.selectedCountry = cardId;
  el.classList.add('card--selected-country');
}

function handleSecondaryClick(cardId) {
  if (!state.selectedCountry) return;

  const card = state.cards.find(c => c.id === cardId);
  const el   = getCardEl(cardId);

  // Toggle off
  if (state.selectedSecondary.includes(cardId)) {
    state.selectedSecondary = state.selectedSecondary.filter(id => id !== cardId);
    el.classList.remove('card--selected-secondary');
    return;
  }

  // One-per-column: swap out any existing card of the same type
  const sameTypeId = state.selectedSecondary.find(id =>
    state.cards.find(c => c.id === id).type === card.type,
  );
  if (sameTypeId) {
    state.selectedSecondary = state.selectedSecondary.filter(id => id !== sameTypeId);
    getCardEl(sameTypeId)?.classList.remove('card--selected-secondary');
  }

  state.selectedSecondary.push(cardId);
  el.classList.add('card--selected-secondary');

  if (state.selectedSecondary.length === 4) {
    validateSelection();
  }
}

function clearSecondarySelection() {
  state.selectedSecondary.forEach(id => {
    getCardEl(id)?.classList.remove('card--selected-secondary', 'card--wrong');
  });
  state.selectedSecondary = [];
}

// === VALIDATION ===

function validateSelection() {
  state.busy = true;
  const countryCca3 = state.cards.find(c => c.id === state.selectedCountry).cca3;
  const allCorrect  = state.selectedSecondary.every(id =>
    state.cards.find(c => c.id === id).cca3 === countryCca3,
  );

  if (allCorrect) {
    lockMatch(countryCca3);
    return;
  }

  state.mistakes++;
  updateStats();

  const wrongIds = state.selectedSecondary.filter(id =>
    state.cards.find(c => c.id === id).cca3 !== countryCca3,
  );

  wrongIds.forEach(id => {
    const el = getCardEl(id);
    if (!el) return;
    el.classList.remove('card--selected-secondary');
    el.classList.add('card--wrong');
  });

  setTimeout(() => {
    state.selectedSecondary.forEach(id => {
      getCardEl(id)?.classList.remove('card--wrong', 'card--selected-secondary');
    });
    state.selectedSecondary = [];
    state.busy = false;
  }, 500);
}

// === MATCH LOCKING ===

function lockMatch(cca3) {
  const colorClass = MATCH_COLORS[state.colorIdx++];
  state.matched[cca3] = colorClass;

  state.cards
    .filter(c => c.cca3 === cca3)
    .forEach(c => {
      const el = getCardEl(c.id);
      if (!el) return;
      el.classList.remove('card--selected-country', 'card--selected-secondary', 'card--wrong');
      el.classList.add('card--matched', `card--${colorClass}`);
      el.classList.add('card--pop');
      el.addEventListener('animationend', () => el.classList.remove('card--pop'), { once: true });
    });

  const idx = state.countries.findIndex(c => c.cca3 === cca3);
  $dots.querySelector(`[data-idx="${idx}"]`)?.classList.add(`dot-${colorClass}`);

  state.selectedCountry  = null;
  state.selectedSecondary = [];
  updateStats();

  if (Object.keys(state.matched).length === 5) {
    state.done = true;
    setTimeout(showResults, 600);
  } else {
    state.busy = false;
  }
}

// === RESULTS ===

function showResults() {
  $resultTime.textContent     = formatTime(Date.now() - state.startTime);
  $resultMistakes.textContent = state.mistakes;
  showScreen('results-screen');
}

// === GAME INIT ===

async function startGame(difficulty) {
  state = createInitialState();
  $diffPicker.hidden = true;
  $loadingMsg.textContent = 'Loading countries…';
  $loadingMsg.hidden = false;
  $retryBtn.hidden = true;
  showScreen('loading-screen');

  try {
    // Both promises were kicked off at page load — usually already resolved
    const [buckets] = await Promise.all([allCountriesPromise, worldDataPromise]);

    state.countries = pickCountries(buckets, difficulty);

    if (state.countries.length < 5) {
      throw new Error(`Only ${state.countries.length} countries available for difficulty "${difficulty}"`);
    }

    console.assert(state.countries.length === 5, 'Expected 5 countries');
    state.countries.forEach(c => {
      console.assert(c.name?.common,                   `Missing name for ${c.cca3}`);
      console.assert(c.flags?.png,                     `Missing flag for ${c.cca3}`);
      console.assert(typeof c.population === 'number', `Missing population for ${c.cca3}`);
    });

    state.cards = buildCards(state.countries);
    console.assert(state.cards.length === 25,                          'Expected 25 cards');
    console.assert(new Set(state.cards.map(c => c.id)).size === 25,   'Card IDs must be unique');

    state.startTime = Date.now();
    renderGame();
    showScreen('game-screen');
  } catch (err) {
    console.error(err);
    // Reset so the next attempt re-fetches fresh data
    allCountriesPromise = fetchAllCountries();
    worldDataPromise    = loadWorldData();
    $loadingMsg.textContent = 'Failed to load. Check your connection.';
    $diffPicker.hidden = false;
    $retryBtn.hidden = false;
  }
}

// Show difficulty picker immediately on load
resetToStart();
