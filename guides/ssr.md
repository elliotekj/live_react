# Server Side Rendering (SSR)

## Dynamic attribute spreads

When a component uses a dynamic HEEx attribute spread, pass the LiveView socket
to avoid server rendering again on connected updates:

```heex
<.react name="Card" socket={@socket} {@props} />
```

Dynamic spreads do not expose per-attribute change tracking. Without the socket,
LiveReact cannot distinguish a disconnected render from a connected update and
may call the SSR adapter again. Passing the socket preserves the initial SSR
render and skips it while connected.

## Development server requests

The Vite plugin accepts SSR requests without an `Origin` header and requires
the `application/json` content type. It limits request bodies to 10 MiB by
default. If your SSR props exceed that limit, set a larger byte limit in your
Vite configuration:

```javascript
liveReactPlugin({ maxBodyBytes: 20 * 1024 * 1024 });
```

These checks block browser-origin requests but do not authenticate network
clients. Keep the Vite server on a trusted network or protect it with an
authenticated proxy.

If you set the plugin's `path` option, configure Phoenix to use the same path.
Development SSR requests time out after 30 seconds by default. You can change
the timeout in milliseconds:

```elixir
config :live_react,
  vite_ssr_path: "/custom-render",
  vite_ssr_timeout: 60_000
```

_Disclaimer_ SSR for React is not a simple topic and there is a lot of issue than can arise depending on what React components you are using. It also consume more ressource since a nodejs worker is needed for the rendering. This is a simple implementation that works for the components and library I have tested.

## Project setup

⚠️ **Warning:** Server-side rendering (SSR) requires a Node.js worker. With a `pool_size` of 1 and the Phoenix app, you need at least **512MiB** of memory. Otherwise, the instance may experience **out-of-memory (OOM)** errors or severe slowness.

SSR requires Node.js to render the javascript on server side. Add `nodejs` to your mix file.

```elixir
defp deps do
  [
    {:nodejs, "~> 3.1"},
    ...
  ]
end
```

Add NodeJs.Supervisor to your `application.ex`

```elixir
def start(_type, _args) do
  children = [
    ...
    {NodeJS.Supervisor, [path: LiveReact.SSR.NodeJS.server_path(), pool_size: 4]},
  ]
end
```

Add a config entry to your `config/prod.exs`

```elixir
config :live_react,
  ssr_module: LiveReact.SSR.NodeJS,
  ssr: true
```

For complete deployment follow the [SSR deployment guide](/guides/deployment.md#with-ssr)
