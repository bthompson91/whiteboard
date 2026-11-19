# Whiteboard implementation plan

This file is the working checklist for the outstanding shared-board and booking-identity work.

Work through the stages in order. Keep each change small, verify the build and rendering before claiming success, and commit only completed, tested stages.

## 1. Inspect current implementation

- [ ] Read `src/lib/bookingImport.ts`, `src/types.ts`, `src/App.tsx`, and relevant components.
- [ ] Identify the current booking data structure, import flow, matching logic, and board-state persistence.
- [ ] Preserve the existing HTML-as-XLS export parsing and its date handling.
- [ ] Do not revert to automatic XLSX HTML date inference.

## 2. Stable booking identity

- [ ] Assign a persistent internal booking ID when a venue booking is first imported.
- [ ] Store the ID in the published board state.
- [ ] Do not derive the ID from date, room, event name, or time.
- [ ] Preserve the ID across page reloads and subsequent imports.
- [ ] Keep current imported hotel fields alongside the stable ID.

## 3. Previous-import snapshot

- [ ] Extend the shared board-state file with a compact previous-import snapshot.
- [ ] Store current bookings and their stable IDs.
- [ ] Store the prior imported version of each booking.
- [ ] Store a content fingerprint for change detection.
- [ ] Store import timestamp and source-file fingerprint.
- [ ] Retain a bounded recent import history rather than every historical import indefinitely.
- [ ] Treat the shared board-state file as authoritative; browser storage is only a cache.

## 4. Job-number overlay

- [ ] Add job numbers as an editable overlay linked to stable booking IDs.
- [ ] Store job numbers as numbers.
- [ ] Strip leading zeros on entry and paste: `0000012345` becomes `12345`.
- [ ] Preserve blank values as blank; do not convert them to `0`.
- [ ] Flag non-numeric values rather than silently altering them.
- [ ] Allow a booking to have no job number.
- [ ] Do not use the job number as the booking identity.

## 5. Import comparison

- [ ] Compare each newly imported booking with the previous snapshot.
- [ ] Retain stable ID, job number, markup, colour, and hidden status for exact matches.
- [ ] Detect changed event names, start/end times, dates, and room sets.
- [ ] Treat room lists as sets so adding or removing a room is a change, not a wholly new booking.
- [ ] Use fuzzy matching for event names.
- [ ] Use date, time overlap, room overlap, event-name similarity, and duration as match signals.
- [ ] Produce a match score and classify results as strong, possible, or unmatched.
- [ ] Do not silently overwrite the previous state before the master accepts the import.

## 6. Import review

- [ ] Add an import-review interface for the master.
- [ ] Show new bookings.
- [ ] Show changed bookings with changed fields highlighted.
- [ ] Show possible matches side by side.
- [ ] Let the master accept or reject a proposed match.
- [ ] Transfer job number and markup only after confirmation for non-exact matches.
- [ ] Mark disappeared bookings as missing rather than silently deleting their links.
- [ ] Allow reversal of an incorrect match.

## 7. Shared-file roles

- [ ] Support three published shared files: venue configuration, forecast/events, and published board state.
- [ ] Add an optional fourth contribution file for each authorised contributor.
- [ ] Viewers leave the contribution file blank and receive read-only controls.
- [ ] Contributors select their own writable contribution file; edits are saved there, not to the published master.
- [ ] The master loads contributor submissions, reviews them, merges accepted changes, and publishes the updated board state.
- [ ] Use network-share permissions as the actual access control; the fourth file is workflow control, not a security token.

## 8. Master merge and conflict handling

- [ ] Store contributor changes as individual, uniquely named submissions.
- [ ] Record the published revision each submission was based on.
- [ ] Record the contributor name and individual changes.
- [ ] Prevent duplicate processing of an already accepted submission.
- [ ] Detect conflicts when two submissions alter the same booking or field.
- [ ] Let the master resolve conflicts explicitly.
- [ ] Publish merged results for viewers on their next refresh.

## 9. Local caching

- [ ] Store selected file references and UI preferences in browser storage.
- [ ] Use IndexedDB only as a local performance cache for larger board state if needed.
- [ ] Ensure the app works correctly on another computer or after browser data is cleared.
- [ ] Never treat a browser cache as the source of truth.

## 10. Verification

- [ ] Run the production build.
- [ ] Inspect the deployed GitHub Pages output.
- [ ] Test forecast import and re-import.
- [ ] Test stable IDs across reloads and imports.
- [ ] Test job-number entry, leading-zero removal, blank values, and invalid values.
- [ ] Test changed event names, times, dates, and room sets.
- [ ] Test room additions and removals.
- [ ] Test viewer, contributor, and master workflows.
- [ ] Verify the booking grid, room columns, overnight continuation, and visual merging still render correctly.
- [ ] Do not claim build, deployment, or browser correctness from a source push alone.

## Commit discipline

- [ ] Make one coherent stage per commit.
- [ ] Use accurate commit messages.
- [ ] Separate successful commits from unverified build/render claims.
- [ ] Update this checklist as stages are completed.
