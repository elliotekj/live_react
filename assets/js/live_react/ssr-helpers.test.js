import React, { act, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLiveReact } from "./context";
import { getHooks } from "./hooks";
import { getRender } from "./server.mjs";
import { createMockLiveViewHook } from "./tests/helpers";

const names = [
  "pushEvent",
  "pushEventTo",
  "handleEvent",
  "removeHandleEvent",
  "upload",
  "uploadTo",
];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  vi.restoreAllMocks();
});

it("hydrates with the same LiveView helpers in props and context", async () => {
  function Component(props) {
    const liveReact = useLiveReact();
    const available =
      new Set(names.map((name) => props[name])).size === names.length &&
      names.every(
        (name) =>
          typeof props[name] === "function" && props[name] === liveReact[name],
      );
    return React.createElement("p", null, available ? "enabled" : "disabled");
  }

  const props = Object.fromEntries(names.map((name) => [name, "overridden"]));
  const element = document.createElement("div");
  element.setAttribute("data-name", "Component");
  element.setAttribute("data-ssr", "");
  element.setAttribute(
    "data-props",
    JSON.stringify(props).replaceAll('"', "^"),
  );
  element.innerHTML = getRender({ Component })("Component", props, {});
  document.body.appendChild(element);
  const hook = { ...createMockLiveViewHook(), el: element };
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  await act(() => getHooks({ Component }).ReactHook.mounted.call(hook));

  expect(element.textContent).toBe("enabled");
  expect(errors).not.toHaveBeenCalled();
  await act(() => hook._root.unmount());
});

it("reports attempts to invoke LiveView helpers during server rendering", () => {
  function Component({ pushEvent }) {
    pushEvent("save", {});
    return null;
  }

  expect(() => getRender({ Component })("Component", {}, {})).toThrow(
    "LiveView helpers are unavailable during server rendering",
  );
});

it("keeps helper effects stable across updates and reconnects", async () => {
  const effect = vi.fn();
  function Component(props) {
    const liveReact = useLiveReact();
    const helpers = names.map((name) => props[name]);
    expect(names.every((name) => props[name] === liveReact[name])).toBe(true);
    useEffect(() => {
      effect();
      props.pushEvent("mounted", {});
    }, helpers);
    return React.createElement("p", null, props.count);
  }

  const element = document.createElement("div");
  element.setAttribute("data-name", "Component");
  element.setAttribute("data-props", "{^count^:0}");
  document.body.appendChild(element);
  const hook = { ...createMockLiveViewHook(), el: element };
  hook.pushEvent = vi.fn(function () {
    expect(this).toBe(hook);
  });
  const { ReactHook } = getHooks({ Component });

  await act(() => ReactHook.mounted.call(hook));
  element.setAttribute("data-props", "{^count^:1}");
  await act(() => ReactHook.updated.call(hook));
  element.setAttribute("data-props", "{^count^:2}");
  await act(() => ReactHook.reconnected.call(hook));

  expect(element.textContent).toBe("2");
  expect(effect).toHaveBeenCalledOnce();
  expect(hook.pushEvent).toHaveBeenCalledOnce();
  await act(() => hook._root.unmount());
});

it("uses full snapshots after a change-tracked prop update", async () => {
  function Component({ title, removed, added }) {
    return React.createElement("p", null, `${title}/${removed}/${added}`);
  }

  const element = document.createElement("div");
  element.setAttribute("data-name", "Component");
  element.setAttribute("data-use-diff", "true");
  element.setAttribute("data-props-full", "true");
  element.setAttribute("data-props", "{^title^:^old^,^removed^:true}");
  document.body.appendChild(element);
  const hook = { ...createMockLiveViewHook(), el: element };
  const { ReactHook } = getHooks({ Component });

  await act(() => ReactHook.mounted.call(hook));
  element.setAttribute("data-props-full", "false");
  element.setAttribute("data-props-diff", "r6:/titles3:new");
  await act(() => ReactHook.updated.call(hook));
  expect(element.textContent).toBe("new/true/undefined");

  element.setAttribute("data-props-full", "true");
  await act(() => ReactHook.updated.call(hook));
  expect(element.textContent).toBe("old/true/undefined");

  element.setAttribute("data-props", "{^title^:^spread^,^added^:true}");
  await act(() => ReactHook.updated.call(hook));
  expect(element.textContent).toBe("spread/undefined/true");
  await act(() => hook._root.unmount());
});
