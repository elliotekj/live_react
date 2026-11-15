---
name: verify-live-react
description: Verify LiveReact through its Phoenix example app and a real browser when changing React hooks, props, streams, SSR, slots, or integration behavior.
---

# Verify LiveReact

LiveReact is a library, not a standalone server. Its documented consumer is the separate `live_react_examples` app. The pinned example revision used here is `476802013f043331e2ed800a41a4f7e251e9097a`; update the pin and feature map together if that app changes. Read [the feature map](features/README.md) and drive every entry point relevant to the change. The example stores counter and stream state in a LiveView process; there is no database or login.

## Launch

Run from the LiveReact checkout. This creates a disposable example checkout and installs its Mix and npm dependencies from the network. It uses the checkout's *current working tree*, including uncommitted changes. Requires Git, Python 3, Elixir 1.19+/OTP 28 and Node 24. Use installed compatible tools on `PATH`; if a version manager enforces the example's unavailable versions, explicitly select the installed compatible versions before proceeding.

```sh
set -o pipefail
export LR_REPO="$(pwd -P)"
export LR_RUN="$(mktemp -d "${TMPDIR:-/tmp}/live-react-verify.XXXXXX")"
export LR_EVIDENCE="$(mktemp -d "${TMPDIR:-/tmp}/live-react-proof.XXXXXX")"
export LR_HTTP_PORT=43210 LR_VITE_PORT=43211
"$LR_REPO/.agents/skills/verify-live-react/scripts/prepare.py" "$LR_REPO" "$LR_RUN" "$LR_HTTP_PORT" "$LR_VITE_PORT" 2>&1 | tee "$LR_EVIDENCE/prepare.log"
```

The helper refuses occupied ports and an existing `$LR_RUN/app`. Pick two other unused ports if needed; never stop a process belonging to another run. `prepare.py` pins the example, binds both servers to loopback, builds client and SSR assets, and links its Elixir and JavaScript package dependencies to this checkout. Require a zero exit status and `Prepared ...` as the final helper output. In a sandbox that blocks network access, run preparation with the approved network permission. If preparation fails, delete only this run's `$LR_RUN` and preserve `$LR_EVIDENCE`.

In a dedicated terminal/exec session, start the app in the foreground (keep the session ID):

```sh
cd "$LR_RUN/app"
LIVE_REACT_PATH="$LR_REPO" VITE_PORT="$LR_VITE_PORT" MIX_ENV=dev mix phx.server
```

Wait for `Running LiveReactExamplesWeb.Endpoint ... 127.0.0.1:<HTTP port>` and Vite on the chosen port. Then run Doctor and open `/examples/counter`; the page must display `0`, `−1`, and `+1`. HTTP alone does not prove React and LiveView are connected: complete the counter journey before declaring readiness. If the session exits, capture its output and clean up. Fixed ports are only defaults: use distinct pairs and run directories for simultaneous runs.

## Doctor

```sh
readlink "$LR_RUN/app/deps/live_react"
curl -fsS "http://127.0.0.1:$LR_HTTP_PORT/examples/counter" > "$LR_EVIDENCE/doctor.html"
lsof -nP -iTCP:"$LR_HTTP_PORT" -iTCP:"$LR_VITE_PORT" -sTCP:LISTEN
```

The symlink must resolve to `$LR_REPO`, both ports must be owned by the foreground session and its Vite child, and the response must contain `examples/Counter`. Inspect the reported PIDs with `lsof -a -p <PID> -d cwd`: their working directories must be `$LR_RUN/app` or its `assets` directory. If ownership, identity, or readiness is uncertain, stop; do not drive an existing instance. Check the session log for startup or SSR errors. A browser may need a moment to connect after the first page load.

## Drive

Use the computer-use browser on `http://127.0.0.1:$LR_HTTP_PORT`, with the actual UI controls in each feature file. Select elements from a fresh accessibility/DOM snapshot; never call component internals or inject synthetic LiveView events. For the counter, click the rendered `+1` button and observe the displayed count change from `0` to `1`. That round trip exercises the actual React handler, LiveView event, changed assign and React update.

## Evidence

Record the exact feature ID, URL, example revision, checkout revision plus dirty status, action, before/after accessibility snapshots, and browser errors. For the computer-use browser, capture the output of `await tab.getAXState({disableDiffing: true})` before and after actions and `await tab.dev.logs({levels: ["error"], limit: 50})`; save those outputs in the evidence directory. Save the snapshots and transcript as UTF-8 files in `$LR_EVIDENCE`; save screenshots there when the browser tool supports writing them. Capture both action and result, not only a final screen. For side effects, confirm the resulting visible state and an independent public read when the feature offers one; this demo's counter and messages are process-local and reset on reload. `doctor.html` is a server response and the browser snapshot proves the interactive result; neither alone proves the whole journey. Retain console errors and server output on failure. Do not substitute internal setters or test-only endpoints for user actions.

## Cleanup

Close only the browser tab opened for this run. Send Ctrl-C to the recorded foreground server session and wait for it and its Vite child to exit; never kill by process name. Check the two selected ports are free. Remove only the `$LR_RUN` directory created by this run; keep `$LR_EVIDENCE` and confirm it still contains the proof. Apply this cleanup after every failed run too.

## Helpers

`./.agents/skills/verify-live-react/scripts/prepare.py REPO RUN_DIR HTTP_PORT VITE_PORT` prepares the isolated consumer. It requires an existing empty run directory and two free ports. Its pinned clone, runtime-only config edits and dependency installs are verification scaffolding, not changes to the project or another checkout.
