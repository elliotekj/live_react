# Streams

The messages example sends inserts, edits, deletions and resets from LiveView to React as a stream.

## Sub-features

- `streams-insert`, `streams-edit`, `streams-delete`, `streams-reset`.

## How to get to it (user POV)

Open `/examples/streams` or select **Phoenix Streams** and **Preview**.

## Driving it with the browser

Preconditions: Doctor passed; the initial message `hey, anyone here? 👋` is visible.

- Fill the textbox with placeholder `say something…` with `verification message` and click **Send**. Verify the new message and initial message both appear.
- Within the new message's list item, click **Edit**, replace its text with `verification edited`, and click **Save**. Verify the edited text appears once.
- Within that same row click **Delete**. Verify the edited message disappears and the original remains.
- Click **Replace all**. Verify the original and deleted text are absent and three replacement rows appear. Capture the sequence and resulting list.

## Gotchas

Multiple rows have **Edit** and **Delete** buttons; scope each control to its message row. Replacement texts are randomized, so assert the count and removal of old entries rather than specific replacement strings.
