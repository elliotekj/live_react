import React, { act } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { getHooks } from "./hooks";
import { getRender } from "./server.mjs";
import { createMockLiveViewHook } from "./tests/helpers";

const Component = (props) => React.createElement("p", null, props.title);
const encode = (value) => JSON.stringify(value).replaceAll('"', "^");
const message = 'A top-level prop named "__proto__" is not supported';

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

it("rejects a top-level __proto__ prop during SSR", () => {
  const props = JSON.parse('{"__proto__":{"isAdmin":true}}');
  expect(() => getRender({ Component })("Component", props, {})).toThrow(
    message,
  );
});

it.each(["prop", "stream"])(
  "rejects a top-level __proto__ %s on the client",
  async (kind) => {
    const element = document.createElement("div");
    element.setAttribute("data-name", "Component");
    if (kind === "prop") {
      element.setAttribute(
        "data-props",
        encode(JSON.parse('{"__proto__":{"isAdmin":true}}')),
      );
    } else {
      element.setAttribute("data-stream-names", JSON.stringify(["__proto__"]));
    }
    document.body.appendChild(element);
    const hook = { ...createMockLiveViewHook(), el: element };

    await act(() => {
      expect(() =>
        getHooks({ Component }).ReactHook.mounted.call(hook),
      ).toThrow(message);
    });
    await act(() => hook._root.unmount());
  },
);

it("keeps nested __proto__ data as an own JSON property", () => {
  const props = JSON.parse(
    '{"title":"safe","data":{"__proto__":{"isAdmin":true}}}',
  );
  const check = ({ data }) =>
    React.createElement(
      "p",
      null,
      JSON.stringify({
        own: Object.hasOwn(data, "__proto__"),
        inherited: data.isAdmin ?? null,
      }),
    );
  expect(getRender({ check })("check", props, {})).toContain(
    "{&quot;own&quot;:true,&quot;inherited&quot;:null}",
  );
});
