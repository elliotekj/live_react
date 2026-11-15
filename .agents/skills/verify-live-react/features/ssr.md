# Server rendering

The SSR example compares React markup rendered on the server with markup produced only in the browser.

## Sub-features

- `ssr-html`: server-rendered markup is in the initial response.
- `ssr-hydration`: both panels appear after browser startup.

## How to get to it (user POV)

Open `/examples/ssr` or select **SSR Control** and **Preview**.

## Driving it with the browser

Preconditions: Doctor passed and Vite is running on the selected port.

- Save the raw response with `curl -fsS "http://127.0.0.1:$LR_HTTP_PORT/examples/ssr" > "$LR_EVIDENCE/ssr-response.html"`. It must include `Rendered on the server` in rendered markup.
- In the browser open the same route and verify both `Rendered on the server` and `Rendered only in the browser` are visible. Capture browser errors, including hydration errors, and both results.

## Gotchas

The browser-only text may appear in serialized props in the raw HTML; search the actual rendered element rather than asserting that the phrase is absent from the entire response. A successful HTTP response is not hydration proof.
