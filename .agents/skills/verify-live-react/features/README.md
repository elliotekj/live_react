# LiveReact verification map

These journeys exercise the public example app against the current LiveReact checkout. Start and diagnose the isolated app using [the skill](../SKILL.md). Each route has a Preview tab; verify the listed behavior through that tab, not through source-code tabs. Take before and after browser snapshots, record errors and preserve evidence outside the run directory. Report unvisited entry points and unmet preconditions rather than inferring they work.

- [Counter and events](counter.md): React event to LiveView assign and back.
- [Streams](streams.md): insert, edit, delete and reset streamed React props.
- [Prop diffing](props.md): changed props with and without incremental updates.
- [Server rendering](ssr.md): SSR and browser-only rendering.
- [Slots](slots.md): HEEx children inside a React component.
