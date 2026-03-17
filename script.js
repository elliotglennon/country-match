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

// Five distinct colour classes (CSS handles the actual colours)
const MATCH_COLORS = ['matched-0', 'matched-1', 'matched-2', 'matched-3', 'matched-4'];

// === GAME STATE ===
let state = createInitialState();

function createInitialState() {
  return {
    countries: [],        // fetched country objects (ordered by tier pick)
    cards: [],            // shuffled array of 20 card objects
    selectedCountry: null, // card id string or null
    selectedSecondary: [], // array of up to 3 card id strings
    matched: {},          // cca3 -> colorClass e.g. 'matched-0'
    mistakes: 0,
    startTime: null,
    done: false,
    colorIdx: 0,          // next MATCH_COLORS index
    busy: false,          // lock interactions during animations
  };
}

// === DOM REFS ===
const $loading    = document.getElementById('loading-screen');
const $loadingMsg = document.getElementById('loading-message');
const $retryBtn   = document.getElementById('retry-btn');
const $game       = document.getElementById('game-screen');
const $grid       = document.getElementById('card-grid');
const $dots       = document.getElementById('progress-dots');
const $statMatched  = document.getElementById('stat-matched');
const $statMistakes = document.getElementById('stat-mistakes');
const $results       = document.getElementById('results-screen');
const $resultTime    = document.getElementById('result-time');
const $resultMistakes = document.getElementById('result-mistakes');
const $playAgain     = document.getElementById('play-again-btn');

$retryBtn.addEventListener('click', startGame);
$playAgain.addEventListener('click', startGame);

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
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${s}s`;
}

function showScreen(id) {
  [$loading, $game, $results].forEach(el => { el.hidden = el.id !== id; });
}

function getCardEl(id) {
  return $grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
}

// === COUNTRY SELECTION ===

// Pattern: one from tier 0, two from tier 1, one from tier 2, one from tier 3
function pickCountryCodes() {
  const used = new Set();
  const result = [];
  const pattern = [0, 1, 1, 2, 3];
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
  const url = `https://restcountries.com/v3.1/alpha?codes=${codes.join(',')}&fields=name,capital,population,flags,cca3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// === CARD BUILDING ===

function buildCards(countries) {
  const cards = [];
  countries.forEach((country, countryIdx) => {
    ['country', 'flag', 'capital', 'population'].forEach(type => {
      cards.push({
        id: `${country.cca3}-${type}`,
        type,
        countryIdx,
        cca3: country.cca3,
      });
    });
  });
  return shuffle(cards);
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

  // Card grid
  $grid.innerHTML = '';
  state.cards.forEach(card => {
    $grid.appendChild(createCardEl(card));
  });

  updateStats();
}

const TYPE_LABELS = {
  country: 'Country',
  flag: 'Flag',
  capital: 'Capital',
  population: 'Population',
};

function createCardEl(card) {
  const country = state.countries[card.countryIdx];
  const el = document.createElement('div');
  el.className = `card card--${card.type}`;
  el.dataset.id = card.id;
  el.innerHTML =
    `<span class="card-type-label">${TYPE_LABELS[card.type]}</span>` +
    `<div class="card-content">${cardInnerHTML(card, country)}</div>`;
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
      return `<span>${country.capital && country.capital[0] ? country.capital[0] : '—'}</span>`;
    case 'population':
      return `<span>${formatPopulation(country.population)}</span>`;
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
  if (!card) return;

  // Ignore already-matched cards (pointer-events:none handles this in CSS too)
  if (state.matched[card.cca3]) return;

  if (card.type === 'country') {
    handleCountryClick(cardId);
  } else {
    handleSecondaryClick(cardId);
  }
}

function handleCountryClick(cardId) {
  const el = getCardEl(cardId);

  if (state.selectedCountry === cardId) {
    // Toggle off
    state.selectedCountry = null;
    clearSecondarySelection();
    el.classList.remove('card--selected-country');
    return;
  }

  // Deselect previous country
  if (state.selectedCountry) {
    getCardEl(state.selectedCountry).classList.remove('card--selected-country');
  }
  clearSecondarySelection();

  state.selectedCountry = cardId;
  el.classList.add('card--selected-country');
}

function handleSecondaryClick(cardId) {
  if (!state.selectedCountry) return;

  const el = getCardEl(cardId);

  // Toggle off if already selected
  if (state.selectedSecondary.includes(cardId)) {
    state.selectedSecondary = state.selectedSecondary.filter(id => id !== cardId);
    el.classList.remove('card--selected-secondary');
    return;
  }

  state.selectedSecondary.push(cardId);
  el.classList.add('card--selected-secondary');

  if (state.selectedSecondary.length === 3) {
    validateSelection();
  }
}

function clearSecondarySelection() {
  state.selectedSecondary.forEach(id => {
    const el = getCardEl(id);
    if (el) el.classList.remove('card--selected-secondary', 'card--wrong');
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

  // Wrong — find and shake only the incorrect cards
  state.mistakes++;
  updateStats();

  const wrongIds = state.selectedSecondary.filter(id => {
    return state.cards.find(c => c.id === id).cca3 !== countryCca3;
  });

  wrongIds.forEach(id => {
    const el = getCardEl(id);
    if (!el) return;
    el.classList.remove('card--selected-secondary');
    el.classList.add('card--wrong');
  });

  // After 500ms: clear ALL secondary selection, keep country active
  setTimeout(() => {
    state.selectedSecondary.forEach(id => {
      const el = getCardEl(id);
      if (el) el.classList.remove('card--wrong', 'card--selected-secondary');
    });
    state.selectedSecondary = [];
    state.busy = false;
  }, 500);
}

// === MATCH LOCKING ===

function lockMatch(cca3) {
  const colorClass = MATCH_COLORS[state.colorIdx++];
  state.matched[cca3] = colorClass;

  // Apply matched styles to all 4 cards of this country
  state.cards
    .filter(c => c.cca3 === cca3)
    .forEach(c => {
      const el = getCardEl(c.id);
      if (!el) return;
      el.classList.remove('card--selected-country', 'card--selected-secondary', 'card--wrong');
      el.classList.add('card--matched', `card--${colorClass}`);
      // Pop animation
      el.classList.add('card--pop');
      el.addEventListener('animationend', () => el.classList.remove('card--pop'), { once: true });
    });

  // Fill matching progress dot
  const countryIdx = state.countries.findIndex(c => c.cca3 === cca3);
  const dot = $dots.querySelector(`[data-idx="${countryIdx}"]`);
  if (dot) dot.classList.add(`dot-${colorClass}`);

  // Clear selection state
  state.selectedCountry = null;
  state.selectedSecondary = [];
  updateStats();

  const matchCount = Object.keys(state.matched).length;
  if (matchCount === 5) {
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

async function startGame() {
  state = createInitialState();
  $loadingMsg.textContent = 'Loading countries…';
  $retryBtn.hidden = true;
  showScreen('loading-screen');

  try {
    const codes = pickCountryCodes();
    const rawCountries = await fetchCountries(codes);

    // Preserve tier-order (API may return in any order)
    state.countries = codes
      .map(code => rawCountries.find(c => c.cca3 === code))
      .filter(Boolean);

    // Lightweight sanity assertions
    console.assert(state.countries.length === 5, 'Expected 5 countries');
    state.countries.forEach(c => {
      console.assert(c.name && c.name.common, `Missing name for ${c.cca3}`);
      console.assert(c.flags && c.flags.png, `Missing flag for ${c.cca3}`);
      console.assert(typeof c.population === 'number', `Missing population for ${c.cca3}`);
    });

    state.cards = buildCards(state.countries);

    console.assert(state.cards.length === 20, 'Expected 20 cards');
    console.assert(
      new Set(state.cards.map(c => c.id)).size === 20,
      'Card IDs must be unique',
    );

    state.startTime = Date.now();
    renderGame();
    showScreen('game-screen');
  } catch (err) {
    console.error(err);
    $loadingMsg.textContent = 'Failed to load countries. Please check your connection and try again.';
    $retryBtn.hidden = false;
  }
}

// Kick off on load
startGame();
