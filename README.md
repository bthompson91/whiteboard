# Whiteboard

A browser-based venue booking whiteboard.

GitHub Pages serves the built application from the `docs/` folder on `main`.

## Deployment

Every push to `main` runs the GitHub workflow in `.github/workflows/deploy.yml`, which builds the app and commits the generated `docs/` folder. GitHub Pages serves the site from `docs/` on `main` — there is nothing to build or commit by hand.

To build locally:

```bash
npm install
npm run build
npm test
```

The site will be available at:

https://bthompson91.github.io/whiteboard/

## Usage

- Load `crown_melb.yaml` to establish the venue, room order, aliases, mappings, exclusions, and allowed booking statuses.
- Load `30 day forecast-2026-11-19-14-35-40.xls` to display bookings.
- Days run down the left; rooms run across the top.
- Booking blocks are locked by default. Use **Unlock bookings** to edit them.
- Use the markup layer to add text notes and arrows.
- Markup is stored in browser localStorage and remains in place when a new booking file is loaded.
