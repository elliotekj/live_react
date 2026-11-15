# Counter and events

A React control sends a LiveView event and displays the server's updated count, while its step slider stays in React.

## Sub-features

- `counter-increment`: event round trip and prop update.
- `counter-decrement`: event in the opposite direction.
- `counter-local-step`: React-local slider affects the next event.

## How to get to it (user POV)

Open `/examples/counter` or select **Counter** from Examples and choose **Preview**.

## Driving it with the browser

Preconditions: Doctor passed; a new page starts with count `0` and step `1`.

- Record the visible initial counter. Click **+1** and verify the count becomes `1`. Click **−1** and verify `0`.
- Focus the **step** slider and change it to `2`; the buttons become **−2** and **+2**. Click **+2** and verify the count becomes `2`.
- Capture the action sequence, visible results and browser errors in the evidence directory. Reloading resets this in-memory example; it is not persistence proof.

## Gotchas

The page has source-code tabs and a nested preview. Interact with the actual buttons in Preview. A pre-rendered `0` does not establish that the live socket connected; the counter must change.
