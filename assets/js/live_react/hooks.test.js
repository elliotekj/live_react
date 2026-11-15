import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockLiveViewHook } from "./tests/helpers";

const renderMock = vi.fn();
const rootMock = { render: renderMock, unmount: vi.fn() };

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: vi.fn(() => rootMock),
    hydrateRoot: vi.fn(() => rootMock),
  },
}));

const TestComponent = () => null;

function lastRenderedProps() {
  // The rendered tree is <LiveReactProvider {...hooks}><TestComponent {...props} /></LiveReactProvider>
  const tree = renderMock.mock.calls.at(-1)[0];
  return tree.props.children.props;
}

// Minimal test-only encoder mirroring LiveReact.Patch.serialize/1 and
// LiveReact.Patch.encode_object/1, so fixtures can't drift from hand-typed
// wire strings. Exercised indirectly by decodeCompactPatch/decodeCompactJson
// (already unit-tested against real Elixir-produced fixtures in Task 9).
const OP_CODES = {
  add: "a",
  remove: "d",
  replace: "r",
  upsert: "u",
  limit: "l",
};

function encodeValue(value) {
  if (value === null) return "z";
  if (value === true) return "b1";
  if (value === false) return "b0";
  if (typeof value === "number") {
    const s = String(value);
    return `n${s.length}:${s}`;
  }
  if (typeof value === "string") return `s${value.length}:${value}`;
  const json = JSON.stringify(value).replace(/"/g, "^");
  return `J${json.length}:${json}`;
}

function encodePatch(ops) {
  return ops
    .flatMap(([op, path, value]) => {
      if (op !== "upsert_limit") return [[op, path, value]];
      const parent = path.slice(0, path.lastIndexOf("/"));
      return [
        ["upsert", path, value.item],
        ["limit", parent, { on_insert: value.item.__dom_id }],
        ["limit", parent, value.limit],
      ];
    })
    .map(([op, path, value]) => {
      const prefix = `${OP_CODES[op]}${path.length}:${path}`;
      return op === "remove" ? prefix : prefix + encodeValue(value);
    })
    .join("");
}

function encodeProps(props) {
  return JSON.stringify(props).replace(/"/g, "^");
}

describe("ReactHook", () => {
  let getHooks;
  let ReactHook;

  beforeEach(async () => {
    vi.resetModules();
    renderMock.mockClear();
    ({ getHooks } = await import("./hooks"));
    ({ ReactHook } = getHooks({ TestComponent }));
  });

  it("merges base props and streams on mount", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });

    ReactHook.mounted.call(hook);

    const props = lastRenderedProps();
    expect(props.title).toBe("Hello");
    expect(props.users).toEqual([{ __dom_id: "u1" }]);
  });

  it("keeps unrelated stream items on update-only operations", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({}),
      "data-stream-names": JSON.stringify(["users"]),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "users-1", name: "one" }],
        ["upsert", "/users/-", { __dom_id: "users-2", name: "two" }],
      ]),
    });
    ReactHook.mounted.call(hook);

    hook.el.setAttribute(
      "data-streams-diff",
      encodePatch([["replace", "/users/$$users-3", { __dom_id: "users-3" }]]),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps().users.map((item) => item.name)).toEqual([
      "one",
      "two",
    ]);

    hook.el.setAttribute(
      "data-streams-diff",
      encodePatch([
        [
          "replace",
          "/users/$$users-1",
          { __dom_id: "users-1", name: "updated" },
        ],
      ]),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps().users.map((item) => item.name)).toEqual([
      "updated",
      "two",
    ]);
    warn.mockRestore();
  });

  it("limits new stream items but not updates to existing items", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({}),
      "data-stream-names": JSON.stringify(["users"]),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "a" }],
        ["upsert", "/users/-", { __dom_id: "b" }],
      ]),
    });
    ReactHook.mounted.call(hook);
    hook.el.setAttribute(
      "data-streams-diff",
      encodePatch([
        [
          "upsert_limit",
          "/users/-",
          { item: { __dom_id: "a", updated: true }, limit: 1 },
        ],
      ]),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps().users).toEqual([
      { __dom_id: "a", updated: true },
      { __dom_id: "b" },
    ]);

    hook.el.setAttribute(
      "data-streams-diff",
      encodePatch([
        ["upsert_limit", "/users/-", { item: { __dom_id: "c" }, limit: -2 }],
      ]),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps().users).toEqual([
      { __dom_id: "b" },
      { __dom_id: "c" },
    ]);

    hook.el.setAttribute(
      "data-streams-diff",
      encodePatch([
        ["replace", "/users", []],
        ["upsert_limit", "/users/-", { item: { __dom_id: "a" }, limit: 1 }],
        ["upsert_limit", "/users/-", { item: { __dom_id: "b" }, limit: 1 }],
      ]),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps().users).toEqual([{ __dom_id: "a" }]);
  });

  it("applies props_diff on update when data-use-diff is true", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-use-diff": "true",
    });

    ReactHook.mounted.call(hook);

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-name") return "TestComponent";
      if (name === "data-use-diff") return "true";
      if (name === "data-props-diff")
        return encodePatch([["replace", "/title", "World"]]);
      if (name === "data-streams-diff") return null;
      return null;
    });

    ReactHook.updated.call(hook);

    expect(lastRenderedProps().title).toBe("World");
  });

  it("replaces props wholesale on update when data-use-diff is false", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-use-diff": "false",
    });

    ReactHook.mounted.call(hook);

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-name") return "TestComponent";
      if (name === "data-use-diff") return "false";
      if (name === "data-props") return encodeProps({ title: "Replaced" });
      if (name === "data-streams-diff") return null;
      return null;
    });

    ReactHook.updated.call(hook);

    expect(lastRenderedProps().title).toBe("Replaced");
  });

  it("uses a new component when its name changes", () => {
    const OtherComponent = () => null;
    const { ReactHook: hookDefinition } = getHooks({
      TestComponent,
      OtherComponent,
    });
    const hook = createMockLiveViewHook({ "data-name": "TestComponent" });

    hookDefinition.mounted.call(hook);
    hook.el.setAttribute("data-name", "OtherComponent");
    hookDefinition.updated.call(hook);

    expect(renderMock.mock.calls.at(-1)[0].props.children.type).toBe(
      OtherComponent,
    );
  });

  it("resyncs the full props snapshot when diff mode changes", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-use-diff": "false",
      "data-props": encodeProps({ title: "old", kept: "yes" }),
      "data-props-diff": encodePatch([["replace", "/title", "stale"]]),
    });

    ReactHook.mounted.call(hook);
    hook.el.setAttribute("data-use-diff", "true");
    hook.el.setAttribute(
      "data-props",
      encodeProps({ title: "new", kept: "yes" }),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps()).toMatchObject({ title: "new", kept: "yes" });

    hook.el.setAttribute(
      "data-props-diff",
      encodePatch([["replace", "/title", "latest"]]),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps()).toMatchObject({ title: "latest", kept: "yes" });

    hook.el.setAttribute("data-use-diff", "false");
    hook.el.setAttribute(
      "data-props",
      encodeProps({ title: "final", kept: "yes" }),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps()).toMatchObject({ title: "final", kept: "yes" });
  });

  it("removes departed streams without replaying the previous stream patch", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-use-diff": "false",
      "data-props": encodeProps({}),
      "data-stream-names": JSON.stringify(["items"]),
      "data-streams-diff": encodePatch([
        ["replace", "/items", []],
        ["upsert", "/items/-", { __dom_id: "a", name: "stream" }],
      ]),
    });
    ReactHook.mounted.call(hook);
    expect(lastRenderedProps().items[0].name).toBe("stream");

    hook.el.setAttribute("data-stream-names", "[]");
    hook.el.setAttribute(
      "data-props",
      encodeProps({ items: [{ name: "plain" }] }),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps().items).toEqual([{ name: "plain" }]);
  });

  it("uses a changed ordinary prop after a stream in diff mode", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-use-diff": "true",
      "data-props": encodeProps({}),
      "data-stream-names": JSON.stringify(["items"]),
      "data-streams-diff": encodePatch([
        ["replace", "/items", [{ __dom_id: "a", name: "stream" }]],
      ]),
    });
    ReactHook.mounted.call(hook);
    hook.el.setAttribute("data-stream-names", "[]");
    hook.el.setAttribute(
      "data-props-diff",
      encodePatch([["replace", "/items", [{ name: "plain" }]]]),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps().items).toEqual([{ name: "plain" }]);
  });

  it("initializes newly introduced empty streams and applies later inserts", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-use-diff": "false",
      "data-props": encodeProps({ items: [{ name: "plain" }] }),
      "data-stream-names": "[]",
    });
    ReactHook.mounted.call(hook);

    hook.el.setAttribute("data-props", encodeProps({}));
    hook.el.setAttribute("data-stream-names", JSON.stringify(["items"]));
    ReactHook.updated.call(hook);
    expect(lastRenderedProps().items).toEqual([]);

    hook.el.setAttribute(
      "data-streams-diff",
      encodePatch([["upsert", "/items/-", { __dom_id: "b", name: "stream" }]]),
    );
    ReactHook.updated.call(hook);
    expect(lastRenderedProps().items).toEqual([
      { __dom_id: "b", name: "stream" },
    ]);

    hook.el.setAttribute("data-stream-names", "[]");
    ReactHook.updated.call(hook);
    expect(lastRenderedProps().items).toBeUndefined();
  });

  it("keeps departed streams removed after reconnect with an old patch attribute", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({}),
      "data-stream-names": JSON.stringify(["items"]),
      "data-streams-diff": encodePatch([
        ["replace", "/items", [{ __dom_id: "a" }]],
      ]),
    });
    ReactHook.mounted.call(hook);
    hook.el.setAttribute("data-stream-names", "[]");
    hook.el.setAttribute("data-props", encodeProps({ items: ["plain"] }));
    ReactHook.reconnected.call(hook);
    expect(lastRenderedProps().items).toEqual(["plain"]);
  });

  it("rejects a stream named __proto__ without changing prototypes", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({}),
      "data-stream-names": JSON.stringify(["__proto__"]),
      "data-streams-diff": encodePatch([
        ["upsert", "/__proto__/-", { __dom_id: "a" }],
      ]),
    });
    expect(() => ReactHook.mounted.call(hook)).toThrow(
      'A top-level prop named "__proto__" is not supported',
    );
    expect(Object.getPrototypeOf(hook._streams)).toBe(Object.prototype);
    expect(Object.hasOwn(hook._streams, "__proto__")).toBe(true);
    expect(hook._streams.__proto__).toEqual([{ __dom_id: "a" }]);
  });

  it("accumulates stream inserts across updates without losing prior items", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-use-diff": "true",
      "data-props": encodeProps({}),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });

    ReactHook.mounted.call(hook);

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-name") return "TestComponent";
      if (name === "data-use-diff") return "true";
      if (name === "data-props-diff") return null;
      if (name === "data-streams-diff")
        return encodePatch([["upsert", "/users/-", { __dom_id: "u2" }]]);
      return null;
    });

    ReactHook.updated.call(hook);

    expect(lastRenderedProps().users).toEqual([
      { __dom_id: "u1" },
      { __dom_id: "u2" },
    ]);
  });

  it("reconnected() resyncs streams via diff, same as updated()", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });

    ReactHook.mounted.call(hook);

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-name") return "TestComponent";
      if (name === "data-use-diff") return "true";
      if (name === "data-props") return encodeProps({ title: "Hello" });
      if (name === "data-props-diff") return null;
      if (name === "data-streams-diff")
        return encodePatch([["upsert", "/users/-", { __dom_id: "u2" }]]);
      return null;
    });

    ReactHook.reconnected.call(hook);

    expect(lastRenderedProps().users).toEqual([
      { __dom_id: "u1" },
      { __dom_id: "u2" },
    ]);
  });

  it("reconnected() does a full props resync from data-props instead of applying a diff", () => {
    // Regression test: on a real LiveView reconnect the server process is
    // fresh (assigns.__changed__ == nil), so calculate_props_diff/2 produces
    // an EMPTY diff regardless of how much server state actually changed
    // while disconnected. The full, current snapshot is sent via data-props
    // instead. reconnected() must read that fresh snapshot rather than
    // applying the (necessarily empty) data-props-diff to the stale
    // in-memory props, or the component would keep showing stale data after
    // reconnecting.
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
    });

    ReactHook.mounted.call(hook);
    expect(lastRenderedProps().title).toBe("Hello");

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-name") return "TestComponent";
      if (name === "data-use-diff") return "true";
      // Fresh full snapshot reflecting server state that advanced while
      // disconnected...
      if (name === "data-props") return encodeProps({ title: "World" });
      // ...paired with the empty diff the server actually sends on
      // reconnect (init = true means calculate_props_diff/2 has nothing to
      // report).
      if (name === "data-props-diff") return encodePatch([]);
      if (name === "data-streams-diff") return null;
      return null;
    });

    ReactHook.reconnected.call(hook);

    expect(lastRenderedProps().title).toBe("World");
  });
});
