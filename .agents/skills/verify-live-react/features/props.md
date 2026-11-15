# Prop diffing

The example compares incremental prop updates with full snapshots while changing the same server value.

## Sub-features

- `props-diff`: changed value reaches the diffed component.
- `props-full`: the full-snapshot component receives the same value.

## How to get to it (user POV)

Open `/examples/props-diffing` or select **Props Diffing** and **Preview**.

## Driving it with the browser

Preconditions: Doctor passed and both `diff={true}` and `diff={false}` panels are visible.

- Record both counter values and update indicators. Click **Change one field**.
- Verify both counters advance by one, the diffed panel reports `data-props-diff`, and the full-snapshot panel reports `data-props`. Record the values and the update sources.

## Gotchas

The byte counts depend on the payload and environment. Verify the update sources and matching visible values instead of hard-coding byte totals.
