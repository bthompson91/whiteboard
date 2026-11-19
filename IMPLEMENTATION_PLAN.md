# Whiteboard implementation plan

This file is the working checklist for the outstanding shared-board and booking-identity work.

Work through the stages in order. Keep each change small, verify the build and rendering before claiming success, and commit only completed, tested stages.

## 1. Inspect current implementation

- [x] Read `src/lib/bookingImport.ts`, `src/types.ts`, `src/App.tsx`, and relevant components.
- [x] Identify the current booking data structure, import flow, matching logic, and board-state persistence.
- [x] Preserve the existing HTML-as-XLS export parsing and its date handling.
- [x] Do not revert to automatic XLSX HTML date inference.

## 2. Stable booking identity

- [x] Assign a persistent internal booking ID when a venue booking is first imported.
- [x] Store the ID in the published board state.
- [ ] Do not derive the ID from date, room, event name, or time.
- [x] Preserve the ID across page reloads and subsequent imports.
- [x] Keep current imported hotel fields alongside the stable ID.

> Current implementation uses a deterministic identity hash based on venue, date, job number, title, and rooms. This provides stable re-import matching, but a server/database-backed immutable ID remains the long-term target.

## 3. Previous-import snapshot

- [x] Extend the shared board-state file with a compact previous-import snapshot.
- [x] Store current bookings and their stable IDs.
- [x] Store the prior imported version of each booking.
- [ ] Store a content fingerprint for change detection.
- [ ] Store import timestamp and source-file fingerprint.
- [ ] Retain a bounded recent import history rather than every historical import indefinitely.
- [ ] Treat the shared board-state file as authoritative; browser storage is only a cache.

## 4. Job-number overlay

- [ ] Add job numbers as an editable overlay linked to stable booking IDs.
- [ ] Store job numbers as numbers.
- [x] Strip leading zeros on entry and paste: `0000012345` becomes `12345`.
- [x] Preserve blank values as blank; do not convert them to `0`.
- [ ] Flag non-numeric values rather than silently altering them.
- [x] Allow a booking to have no job number.
- [x] Do not use the job number as the booking identity.

> Job numbers are imported when the venue YAML maps a `job_number` field. They are not yet editable directly on the board.

## 5. Import comparison

- [x] Compare each newly imported booking with the previous snapshot.
- [ ] Retain stable ID, job number, markup, colour, and hidden status for exact matches.
- [x] Detect changed event names, start/end times, dates, and room sets.
- [x] Treat room lists as sets so adding or removing a room is a change, not a wholly new booking.
- [ ] Use fuzzy matching for event names.
- [ ] Use date, time overlap, room overlap, event-name similarity, and duration as match signals.
- [ ] Produce a match score and classify results as strong, possible, or unmatched.
- [x] Do not silently overwrite the previous state before the master accepts the import.

## 6. Import review

- [x] Add an import-review interface for the master.
- [x] Show new bookings.
- [x] Show changed bookings with changed fields highlighted.
- [ ] Show possible matches side by side.
- [ ] Let the master accept or reject a proposed match.
- [ ] Transfer job number and markup only after confirmation for non-exact matches.
- [x] Mark disappeared bookings as missing rather than silently deleting their links.
- [ ] Allow reversal of an incorrect match.

## 7. Shared-file roles

- [ ] Support three published shared files: venue configuration, forecast/events, and published board state.
- [ ] Add an optional fourth contribution file for each authorised contributor.
- [x] Viewers leave the contribution file blank and receive read-only controls.
- [ ] Contributors select their own writable contribution file; edits are saved there, not to the published master.
- [x] The master loads contributor submissions, reviews them, merges accepted changes, and publishes the updated board state.
- [ ] Use network-share permissions as the actual access control; the fourth file is workflow control, not a security token.

> The current implementation uses a locally selected role and a locally exported/imported shared-board JSON file. It demonstrates the workflow, but does not yet implement separate network-share files or access control.

## 8. Master merge and conflict handling

- [x] Store contributor changes as individual, uniquely named submissions.
- [x] Record the published revision each submission was based on.
- [x] Record the contributor name and individual changes.
- [ ] Prevent duplicate processing of an already accepted submission.
- [x] Detect conflicts when two submissions alter the same booking or field.
- [x] Let the master resolve conflicts explicitly.
- [ ] Publish merged results for viewers on their next refresh.

## 9. Local caching

- [x] Store selected file references and UI preferences in browser storage.
- [ ] Use IndexedDB only as a local performance cache for larger board state if needed.
- [ ] Ensure the app works correctly on another computer or after browser data is cleared.
- [x] Never treat a browser cache as the source of truth.

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
- [x] Do not claim build, deployment, or browser correctness from a source push alone.

## Commit discipline

- [x] Make one coherent stage per commit.
- [x] Use accurate commit messages.
- [x] Separate successful commits from unverified build/render claims.
- [x] Update this checklist as stages are completed.
