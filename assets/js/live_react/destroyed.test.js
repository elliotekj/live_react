import React, { act, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getHooks } from "./hooks";
import { createMockLiveViewHook } from "./tests/helpers";

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

it("cleans up a removed component without waiting for navigation", async () => {
  const cleanup = vi.fn();
  function Component() {
    useEffect(() => cleanup, []);
    return React.createElement("p", null, "Content");
  }

  const element = document.createElement("div");
  element.setAttribute("data-name", "Component");
  document.body.appendChild(element);
  const hook = { ...createMockLiveViewHook(), el: element };
  const { ReactHook } = getHooks({ Component });

  await act(() => ReactHook.mounted.call(hook));
  expect(element.textContent).toBe("Content");

  await act(async () => {
    ReactHook.destroyed.call(hook);
    ReactHook.destroyed.call(hook);
    element.remove();
    await Promise.resolve();
  });
  expect(cleanup).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("phx:page-loading-stop"));
  expect(cleanup).toHaveBeenCalledOnce();
});
