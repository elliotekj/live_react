# Slots

A Phoenix-rendered button appears as a child of a React component and updates its LiveView count.

## Sub-features

- `slots-render`: HEEx content appears inside React.
- `slots-event`: the HEEx button updates the React-displayed count.

## How to get to it (user POV)

Open `/examples/slots` or select **Slots** and **Preview**.

## Driving it with the browser

Preconditions: Doctor passed and **Increment from HEEx** and the count `0` are visible.

- Record the initial state. Click **Increment from HEEx** and verify the count becomes `1` and the button remains usable.
- Capture the action and resulting state. Click again and verify the count becomes `2`.

## Gotchas

Use the button inside the Preview, not text in the source tabs. A visible initial button alone proves neither its event wiring nor React updates.
