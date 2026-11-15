import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHooks } from "./hooks";
import { getRender } from "./server.mjs";
import { createMockLiveViewHook } from "./tests/helpers";

const Card = ({ children }) => children;

describe("React slots", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it.each([false, true])(
    "renders UTF-8 slots with SSR set to %s",
    async (ssr) => {
      const html = "<p>Hello, café 😀</p>";
      const element = document.createElement("div");
      element.setAttribute("data-name", "Card");
      element.setAttribute(
        "data-slots",
        JSON.stringify({ default: Buffer.from(html).toString("base64") }),
      );
      if (ssr) {
        element.setAttribute("data-ssr", "");
        element.innerHTML = getRender({ Card })("Card", {}, { default: html });
      }
      document.body.appendChild(element);
      const hook = { ...createMockLiveViewHook(), el: element };
      const { ReactHook } = getHooks({ Card });
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});

      await act(() => ReactHook.mounted.call(hook));

      expect(element.textContent).toBe("Hello, café 😀");
      expect(errors).not.toHaveBeenCalled();

      await act(() => hook._root.unmount());
      errors.mockRestore();
    },
  );
});
