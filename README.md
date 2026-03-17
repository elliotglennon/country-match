# Country Match

A geography card-matching game. Match each country name to its flag, capital city, and population across a shuffled 5×4 grid.

Countries are drawn from four difficulty tiers — one well-known, two mid-tier, one harder, one obscure — so every round is a different challenge.

## How to play

1. **Click a country name card** — it gets a gold border.
2. **Click its three attribute cards** — flag, capital, and population.
3. When all four match they lock in with a colour highlight and the progress dot fills.
4. A wrong pick shakes the incorrect cards and resets your secondary selection (the country stays selected so you can try again).
5. Match all five countries to finish. Your time and mistake count are shown on the results screen.

## Run locally

No server needed — just open `index.html` in any modern browser.

```
open index.html       # macOS
start index.html      # Windows
xdg-open index.html   # Linux
```

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under *Source*, choose **Deploy from a branch**, select `main`, folder `/ (root)`.
4. Save — your game will be live at `https://<username>.github.io/<repo-name>/` within a minute or two.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup — three screens: loading, game, results |
| `style.css` | All styles including animations and responsive grid |
| `script.js` | All game logic, state management, API fetch |

No build step, no framework, no npm.
