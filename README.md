# Whiteboard

A browser-based venue booking whiteboard.

GitHub Pages serves the built application from the `docs/` folder on `main`.

## Deployment

1. Build the app:

```bash
npm install
npm run build
```

2. Commit and push the generated `docs/` folder to `main`.

3. In GitHub, set:

- **Settings → Pages → Source:** Deploy from a branch
- **Branch:** `main`
- **Folder:** `/docs`

The site will be available at:

https://bthompson91.github.io/whiteboard/

## Usage

- Load `crown_melb.yaml` to establish the venue, room order, aliases, mappings, exclusions, and allowed booking statuses.
- Load `30 day forecast-2026-11-19-14-35-40.xls` to display bookings.
- Days run down the left; rooms run across the top.
- Booking blocks are locked by default. Use **Unlock bookings** to edit them.
- Use the markup layer to add text notes and arrows.
- Markup is stored in browser localStorage and remains in place when a new booking file is loaded.
