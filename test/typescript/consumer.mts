import type React from "react";
import { getHooks, Link } from "live_react";
import { getRender } from "live_react/server";
import liveReactPlugin from "live_react/vite-plugin";

const Component: React.FC<{ title: string }> = () => null;
const hooks = getHooks({ Component });
const render = getRender({ Component });
const html: string = render(
  "Component",
  { title: "Hello" },
  { default: "<p>Hi</p>" },
);
const plugin = liveReactPlugin({
  path: "/render",
  entrypoint: "./server.js",
  maxBodyBytes: 1024,
});
const link: React.ReactElement = Link({ href: null });

// @ts-expect-error Components must be valid React elements.
getHooks({ Invalid: 1 });
// @ts-expect-error The body limit is a number of bytes.
liveReactPlugin({ maxBodyBytes: "large" });

void [hooks.ReactHook, html, plugin.name, link];
