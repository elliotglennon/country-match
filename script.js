// =============================================================
// Country Match — script.js
// =============================================================

// === TIERS ===
const TIERS = [
  ['GBR', 'FRA', 'DEU', 'USA', 'JPN', 'BRA', 'CHN', 'IND', 'AUS', 'CAN'], // 0 well-known
  ['EGY', 'NGA', 'ARG', 'MEX', 'ZAF', 'TUR', 'KOR', 'IDN', 'ESP', 'ITA'], // 1 mid
  ['ISL', 'NZL', 'GRC', 'PRT', 'CZE', 'HUN', 'CHE', 'SWE', 'POL', 'NLD'], // 2 harder
  ['MNG', 'BTN', 'FJI', 'SUR', 'MRT', 'GMB', 'NAM', 'MDA', 'ALB', 'TLS'], // 3 obscure
];

// Tier pick patterns per difficulty
const DIFFICULTY_PATTERNS = {
  easy:   [0, 0, 1, 1, 1], // 2× well-known, 3× mid
  medium: [0, 1, 1, 2, 3], // one of each
  hard:   [1, 1, 2, 3, 3], // 2× mid, 1× harder, 2× obscure
  expert: [2, 2, 3, 3, 3], // 2× harder, 3× obscure
};

// Column order: Country is first (leftmost) as requested
const CARD_TYPES    = ['country', 'flag', 'capital', 'population', 'shape'];
const COL_HEADERS   = ['Country', 'Flag', 'Capital', 'Population', 'Shape'];
const MATCH_COLORS  = ['matched-0', 'matched-1', 'matched-2', 'matched-3', 'matched-4'];

// === WORLD ATLAS (country shapes) ===
// Loaded once at startup; used by shape cards.
let worldFeatures = null; // keyed by numeric ISO code (e.g. 826 for GBR)
const worldDataPromise = loadWorldData();

async function loadWorldData() {
  if (typeof topojson === 'undefined') {
    console.warn('topojson-client not available — shape cards will show placeholder');
    return;
  }
  try {
    const topo = await fetch(
      'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
    ).then(r => r.json());
    const fc = topojson.feature(topo, topo.objects.countries);
    worldFeatures = {};
    fc.features.forEach(f => { worldFeatures[f.id] = f; }); // f.id is numeric ISO
  } catch (e) {
    console.warn('World atlas failed to load — shape cards will show placeholder', e);
  }
}

// Build an inline SVG silhouette from a GeoJSON feature.
// Uses a simple bounding-box projection into a 100×100 viewBox.
function makeShapeSvg(feature) {
  if (!feature || !feature.geometry) return '<span class="shape-missing">?</span>';

  const geom = feature.geometry;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;

  function scanRing(ring) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  if (geom.type === 'Polygon') {
    geom.coordinates.forEach(scanRing);
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach(poly => poly.forEach(scanRing));
  } else {
    return '<span class="shape-missing">?</span>';
  }

  if (!isFinite(minLon) || maxLon <= minLon) return '<span class="shape-missing">?</span>';

  const W = 100, H = 100, PAD = 10;
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat || lonSpan;
  const scale = Math.min((W - 2 * PAD) / lonSpan, (H - 2 * PAD) / latSpan);
  const dx = (W - lonSpan * scale) / 2;
  const dy = (H - latSpan * scale) / 2;

  function pt([lon, lat]) {
    const x = (lon - minLon) * scale + dx;
    const y = H - ((lat - minLat) * scale + dy); // flip Y axis
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }

  function ringToD(ring) {
    if (ring.length < 3) return '';
    return 'M' + ring.map(pt).join('L') + 'Z';
  }

  let d;
  if (geom.type === 'Polygon') {
    d = geom.coordinates.map(ringToD).filter(Boolean).join(' ');
  } else {
    d = geom.coordinates
      .flatMap(poly => poly.map(ringToD))
      .filter(Boolean)
      .join(' ');
  }

  if (!d) return '<span class="shape-missing">?</span>';

  return `<svg viewBox="0 0 ${W} ${H}" class="shape-svg"><path d="${d}" class="shape-path" fill-rule="evenodd"/></svg>`;
}

// === GAME STATE ===
let state = createInitialState();

function createInitialState() {
  return {
    countries: [],         // fetched country objects (ordered by tier pick)
    cards: [],             // 25 card objects with explicit grid positions
    selectedCountry: null, // card id or null
    selectedSecondary: [], // up to 4 card ids (one per non-country type)
    matched: {},           // cca3 → colorClass
    mistakes: 0,
    startTime: null,
    done: false,
    colorIdx: 0,
    busy: false,           // locks interactions during animations
  };
}

// === DOM REFS ===
const $loading         = document.getElementById('loading-screen');
const $loadingMsg      = document.getElementById('loading-message');
const $retryBtn        = document.getElementById('retry-btn');
const $diffPicker      = document.getElementById('difficulty-picker');
const $game            = document.getElementById('game-screen');
const $grid            = document.getElementById('card-grid');
const $dots            = document.getElementById('progress-dots');
const $statMatched     = document.getElementById('stat-matched');
const $statMistakes    = document.getElementById('stat-mistakes');
const $results         = document.getElementById('results-screen');
const $resultTime      = document.getElementById('result-time');
const $resultMistakes  = document.getElementById('result-mistakes');
const $playAgain       = document.getElementById('play-again-btn');

// Difficulty buttons kick off a game
document.querySelectorAll('.btn--diff').forEach(btn => {
  btn.addEventListener('click', () => startGame(btn.dataset.difficulty));
});

// Retry / Play Again both return to difficulty selection
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

// === COUNTRY SELECTION ===

function pickCountryCodes(difficulty) {
  const pattern = DIFFICULTY_PATTERNS[difficulty] || DIFFICULTY_PATTERNS.medium;
  const used = new Set();
  const result = [];
  for (const tierIdx of pattern) {
    const available = TIERS[tierIdx].filter(c => !used.has(c));
    const chosen = pickRandom(available);
    used.add(chosen);
    result.push(chosen);
  }
  return result;
}

// === FETCH ===

async function fetchCountries(codes) {
  // ccn3 = numeric ISO code used to look up world-atlas shapes
  const url = `https://restcountries.com/v3.1/alpha?codes=${codes.join(',')}&fields=name,capital,population,flags,cca3,ccn3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// === CARD BUILDING ===
// Cards are placed in a 5-column grid (one column per type).
// Within each column the 5 countries are shuffled independently,
// so matching row ≠ matching country.

function buildCards(countries) {
  const cards = [];
  CARD_TYPES.forEach((type, colIdx) => {
    // Independent shuffle of country order within this column
    const rowOrder = shuffle([...Array(countries.length).keys()]);
    rowOrder.forEach((countryIdx, rowIdx) => {
      const country = countries[countryIdx];
      cards.push({
        id: `${country.cca3}-${type}`,
        type,
        countryIdx,
        cca3: country.cca3,
        gridCol: colIdx + 1,
        gridRow: rowIdx + 2, // row 1 is the column header
      });
    });
  });
  return cards;
}

// === RENDER ===

function renderGame() {
  // Progress dots
  $dots.innerHTML = '';
  state.countries.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'progress-dot';
    dot.dataset.idx = i;
    $dots.appendChild(dot);
  });

  // Grid: clear, add column headers at row 1, then cards
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
  el.style.gridRow = String(card.gridRow);
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
      // ccn3 is a string like "826"; world-atlas feature ids are numbers
      const numericId = parseInt(country.ccn3 || '0', 10);
      const feature = worldFeatures?.[numericId];
      return makeShapeSvg(feature);
    }
  }
}

function updateStats() {
  const n = Object.keys(state.matched).length;
  $statMatched.textContent = `Matched: ${n} / 5`;
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
  const el = getCardEl(cardId);

  // Toggle off
  if (state.selectedSecondary.includes(cardId)) {
    state.selectedSecondary = state.selectedSecondary.filter(id => id !== cardId);
    el.classList.remove('card--selected-secondary');
    return;
  }

  // One-per-column: if there's already a card of this type selected, swap it out
  const sameTypeId = state.selectedSecondary.find(id => {
    return state.cards.find(c => c.id === id).type === card.type;
  });
  if (sameTypeId) {
    state.selectedSecondary = state.selectedSecondary.filter(id => id !== sameTypeId);
    getCardEl(sameTypeId)?.classList.remove('card--selected-secondary');
  }

  state.selectedSecondary.push(cardId);
  el.classList.add('card--selected-secondary');

  // 4 secondary cards = one per non-country column → validate
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
  const allCorrect = state.selectedSecondary.every(id => {
    return state.cards.find(c => c.id === id).cca3 === countryCca3;
  });

  if (allCorrect) {
    lockMatch(countryCca3);
    return;
  }

  state.mistakes++;
  updateStats();

  // Shake only the wrong cards
  const wrongIds = state.selectedSecondary.filter(id => {
    return state.cards.find(c => c.id === id).cca3 !== countryCca3;
  });

  wrongIds.forEach(id => {
    const el = getCardEl(id);
    if (!el) return;
    el.classList.remove('card--selected-secondary');
    el.classList.add('card--wrong');
  });

  // Clear all secondary after 500ms, keep country selected
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

  // Lock all 5 cards for this country (country + 4 attributes)
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

  const countryIdx = state.countries.findIndex(c => c.cca3 === cca3);
  $dots.querySelector(`[data-idx="${countryIdx}"]`)?.classList.add(`dot-${colorClass}`);

  state.selectedCountry = null;
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
  $resultTime.textContent = formatTime(Date.now() - state.startTime);
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
    const codes = pickCountryCodes(difficulty);

    // Fetch countries and world atlas in parallel
    const [rawCountries] = await Promise.all([
      fetchCountries(codes),
      worldDataPromise,
    ]);

    // Preserve tier pick order (API may return in any order)
    state.countries = codes
      .map(code => rawCountries.find(c => c.cca3 === code))
      .filter(Boolean);

    // Sanity checks
    console.assert(state.countries.length === 5, 'Expected 5 countries');
    state.countries.forEach(c => {
      console.assert(c.name?.common,               `Missing name for ${c.cca3}`);
      console.assert(c.flags?.png,                 `Missing flag for ${c.cca3}`);
      console.assert(typeof c.population === 'number', `Missing population for ${c.cca3}`);
    });

    state.cards = buildCards(state.countries);

    console.assert(state.cards.length === 25, 'Expected 25 cards');
    console.assert(new Set(state.cards.map(c => c.id)).size === 25, 'Card IDs must be unique');

    state.startTime = Date.now();
    renderGame();
    showScreen('game-screen');
  } catch (err) {
    console.error(err);
    $loadingMsg.textContent = 'Failed to load. Check your connection.';
    $diffPicker.hidden = false;
    $retryBtn.hidden = false;
  }
}

// Show difficulty picker on load
resetToStart();
