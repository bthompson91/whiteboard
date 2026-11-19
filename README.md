# Whiteboard

A browser-based venue booking whiteboard.

- Displays bookings in a date/room grid: days down the left, rooms across the top.
- Booking blocks are locked by default and can be explicitly unlocked for editing.
- Provides a separate markup layer for text notes and arrows.
- Markup remains in place when a new booking file is loaded; only booking data refreshes.
- Initial data source: `30 day forecast-2026-11-19-14-35-40.xls` and `config/Crown_melb.yaml` from `WhiteboardGenerator`.

## Development

```bash
npm install
npm run dev
```

## Planned data flow

1. Load a venue configuration YAML to establish rooms, display order, and venue metadata.
2. Load a booking forecast XLS file.
3. Parse bookings into normalized records containing date, room, start/end time, title, and status.
4. Render booking blocks on the grid.
5. Store markup separately from bookings so replacing the booking dataset does not move annotations.
