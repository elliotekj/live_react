import { describe, it, expect } from "vitest";
import { getValueByPointer, applyOperation, applyPatch } from "./jsonPatch";

describe("getValueByPointer", () => {
  const testDoc = {
    foo: "bar",
    baz: [1, 2, 3],
    nested: { key: "value" },
  };

  it("returns the root document for an empty pointer", () => {
    expect(getValueByPointer(testDoc, "")).toBe(testDoc);
  });

  it("gets a simple property", () => {
    expect(getValueByPointer(testDoc, "/foo")).toBe("bar");
  });

  it("gets an array element by index", () => {
    expect(getValueByPointer(testDoc, "/baz/1")).toBe(2);
  });

  it("gets the last array element with -", () => {
    expect(getValueByPointer(testDoc, "/baz/-")).toBe(3);
  });

  it("gets a nested property", () => {
    expect(getValueByPointer(testDoc, "/nested/key")).toBe("value");
  });

  it("reads own JSON keys but not inherited properties", () => {
    const doc = JSON.parse('{"__proto__":{"constructor":{"prototype":1}}}');
    expect(getValueByPointer(doc, "/__proto__/constructor/prototype")).toBe(1);
    expect(getValueByPointer({}, "/__proto__")).toBeUndefined();
    expect(getValueByPointer({}, "/constructor/prototype")).toBeUndefined();
  });
});

describe("applyOperation", () => {
  it("stores __proto__ as an own key without changing the prototype", () => {
    const doc = {};
    applyOperation(doc, {
      op: "add",
      path: "/__proto__",
      value: { isAdmin: true },
    });
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype);
    expect(Object.hasOwn(doc, "__proto__")).toBe(true);
    expect(JSON.stringify(doc)).toBe('{"__proto__":{"isAdmin":true}}');
    expect(doc.isAdmin).toBeUndefined();
  });

  it("does not traverse inherited prototype paths", () => {
    const doc = {};
    applyOperation(doc, { op: "add", path: "/__proto__/isAdmin", value: true });
    applyOperation(doc, {
      op: "add",
      path: "/constructor/prototype/isAdmin",
      value: true,
    });
    expect(doc.isAdmin).toBeUndefined();
    expect(Object.prototype.isAdmin).toBeUndefined();
  });

  it("adds a property to an object", () => {
    const doc = { foo: "bar" };
    applyOperation(doc, { op: "add", path: "/baz", value: "qux" });
    expect(doc).toEqual({ foo: "bar", baz: "qux" });
  });

  it("replaces a property in an object", () => {
    const doc = { foo: "bar" };
    applyOperation(doc, { op: "replace", path: "/foo", value: "baz" });
    expect(doc).toEqual({ foo: "baz" });
  });

  it("removes a property from an object", () => {
    const doc = { foo: "bar", baz: "qux" };
    applyOperation(doc, { op: "remove", path: "/foo" });
    expect(doc).toEqual({ baz: "qux" });
  });

  it("adds an element to an array at a specific index", () => {
    const doc = { arr: [1, 2, 3] };
    applyOperation(doc, { op: "add", path: "/arr/1", value: "new" });
    expect(doc).toEqual({ arr: [1, "new", 2, 3] });
  });

  it("adds an element to the end of an array with -", () => {
    const doc = { arr: [1, 2, 3] };
    applyOperation(doc, { op: "add", path: "/arr/-", value: "new" });
    expect(doc).toEqual({ arr: [1, 2, 3, "new"] });
  });

  it("removes an element from an array", () => {
    const doc = { arr: [1, 2, 3] };
    applyOperation(doc, { op: "remove", path: "/arr/1" });
    expect(doc).toEqual({ arr: [1, 3] });
  });

  it("resolves $$dom_id in array paths for upsert (update)", () => {
    const doc = {
      rows: [
        { __dom_id: "a", v: 1 },
        { __dom_id: "b", v: 2 },
      ],
    };
    applyOperation(doc, {
      op: "upsert",
      path: "/rows/-",
      value: { __dom_id: "a", v: 99 },
    });
    expect(doc.rows).toEqual([
      { __dom_id: "a", v: 99 },
      { __dom_id: "b", v: 2 },
    ]);
  });

  it("resolves $$dom_id in array paths for upsert (insert)", () => {
    const doc = { rows: [{ __dom_id: "a", v: 1 }] };
    applyOperation(doc, {
      op: "upsert",
      path: "/rows/-",
      value: { __dom_id: "c", v: 3 },
    });
    expect(doc.rows).toEqual([
      { __dom_id: "a", v: 1 },
      { __dom_id: "c", v: 3 },
    ]);
  });

  it("removes an array element by $$dom_id", () => {
    const doc = { rows: [{ __dom_id: "a" }, { __dom_id: "b" }] };
    applyOperation(doc, { op: "remove", path: "/rows/$$a" });
    expect(doc.rows).toEqual([{ __dom_id: "b" }]);
  });

  it("applies limit by trimming from the end for positive values", () => {
    const doc = { rows: [1, 2, 3, 4] };
    applyOperation(doc, { op: "limit", path: "/rows", value: 2 });
    expect(doc.rows).toEqual([1, 2]);
  });

  it("applies limit by trimming from the start for negative values", () => {
    const doc = { rows: [1, 2, 3, 4] };
    applyOperation(doc, { op: "limit", path: "/rows", value: -2 });
    expect(doc.rows).toEqual([3, 4]);
  });
});

describe("applyPatch copy-on-write", () => {
  it("preserves earlier items when removal shifts an array index", () => {
    const first = { v: 1 };
    const second = { v: 2 };
    const doc = { items: [first, second] };

    applyPatch(doc, [
      { op: "replace", path: "/items/0/v", value: 3 },
      { op: "remove", path: "/items/0" },
      { op: "replace", path: "/items/0/v", value: 4 },
    ]);

    expect(doc.items).toEqual([{ v: 4 }]);
    expect(first).toEqual({ v: 1 });
    expect(second).toEqual({ v: 2 });
  });

  it.each([
    [
      "insertion",
      { op: "add", path: "/items/0", value: { v: 0 } },
      "/items/1/v",
    ],
    [
      "upsert",
      { op: "upsert", path: "/items/0", value: { __dom_id: "new", v: 0 } },
      "/items/1/v",
    ],
    [
      "negative limit",
      { op: "limit", path: "/items", value: -1 },
      "/items/0/v",
    ],
  ])("preserves shifted items after %s", (_name, change, target) => {
    const first = { v: 1 };
    const second = { v: 2 };
    const doc = { items: [first, second] };
    applyPatch(doc, [
      { op: "replace", path: target, value: 3 },
      change,
      { op: "replace", path: target, value: 4 },
    ]);
    expect(first).toEqual({ v: 1 });
    expect(second).toEqual({ v: 2 });
    expect(target === "/items/1/v" ? doc.items[1].v : doc.items[0].v).toBe(4);
  });

  it("preserves a replacement value when updating its descendants", () => {
    const replacement = { v: 2 };
    const doc = { item: { v: 1 } };
    applyPatch(doc, [
      { op: "replace", path: "/item/v", value: 3 },
      { op: "replace", path: "/item", value: replacement },
      { op: "replace", path: "/item/v", value: 4 },
    ]);
    expect(doc.item).toEqual({ v: 4 });
    expect(replacement).toEqual({ v: 2 });
  });

  it("updates own prototype-named keys without mutating their original values", () => {
    const original = JSON.parse(
      '{"profile":{"__proto__":{"constructor":{"prototype":{"isAdmin":false}}}}}',
    );
    const previousProfile = original.profile;
    const result = applyPatch(original, [
      {
        op: "replace",
        path: "/profile/__proto__/constructor/prototype/isAdmin",
        value: true,
      },
    ]);
    expect(result.profile.__proto__.constructor.prototype.isAdmin).toBe(true);
    expect(previousProfile.__proto__.constructor.prototype.isAdmin).toBe(false);
    expect(Object.getPrototypeOf(result.profile)).toBe(Object.prototype);
    expect(Object.prototype.isAdmin).toBeUndefined();
  });

  it("ignores inherited paths without creating prototype-derived values", () => {
    const doc = { profile: {} };
    applyPatch(doc, [
      { op: "add", path: "/profile/__proto__/isAdmin", value: true },
    ]);
    expect(doc.profile).toEqual({});
    expect(Object.getPrototypeOf(doc.profile)).toBe(Object.prototype);
    expect(doc.profile.isAdmin).toBeUndefined();
  });

  it("supports escaped path segments without reusing another path's clone", () => {
    const nested = { b: { value: 1 } };
    const escaped = { value: 1 };
    const doc = { a: nested, "a/b": escaped };
    applyPatch(doc, [
      { op: "replace", path: "/a/b/value", value: 2 },
      { op: "replace", path: "/a~1b/value", value: 3 },
    ]);
    expect(doc.a.b.value).toBe(2);
    expect(doc["a/b"].value).toBe(3);
    expect(nested.b.value).toBe(1);
    expect(escaped.value).toBe(1);
  });

  it("isolates nested limits and updates after a root replacement", () => {
    const oldRows = [1, 2, 3];
    const replacementRows = [4, 5, 6];
    const replacement = { data: { rows: replacementRows } };
    const result = applyPatch({ data: { rows: oldRows } }, [
      { op: "limit", path: "/data/rows", value: 1 },
      { op: "replace", path: "", value: replacement },
      { op: "limit", path: "/data/rows", value: 2 },
    ]);
    expect(oldRows).toEqual([1, 2, 3]);
    expect(replacementRows).toEqual([4, 5, 6]);
    expect(result.data.rows).toEqual([4, 5]);
  });

  it("gives a fresh array reference for a touched top-level key", () => {
    const original = { users: [{ __dom_id: "a", name: "Alice" }] };
    const usersRefBefore = original.users;

    const result = applyPatch(original, [
      { op: "upsert", path: "/users/-", value: { __dom_id: "b", name: "Bob" } },
    ]);

    expect(result.users).not.toBe(usersRefBefore);
    expect(result.users).toEqual([
      { __dom_id: "a", name: "Alice" },
      { __dom_id: "b", name: "Bob" },
    ]);
  });

  it("preserves previous arrays for conditional stream limits", () => {
    for (const [id, expected] of [
      ["a", ["a", "b"]],
      ["c", ["b", "c"]],
    ]) {
      const original = { users: [{ __dom_id: "a" }, { __dom_id: "b" }] };
      const previous = original.users;
      const result = applyPatch(original, [
        { op: "upsert", path: "/users/-", value: { __dom_id: id } },
        { op: "limit", path: "/users", value: { on_insert: id } },
        { op: "limit", path: "/users", value: -2 },
      ]);

      expect(result.users.map((item) => item.__dom_id)).toEqual(expected);
      expect(result.users).not.toBe(previous);
      expect(previous.map((item) => item.__dom_id)).toEqual(["a", "b"]);
    }
  });

  it("keeps untouched top-level keys reference-identical", () => {
    const original = {
      users: [{ __dom_id: "a" }],
      posts: [{ __dom_id: "p1" }],
    };
    const postsRefBefore = original.posts;

    const result = applyPatch(original, [{ op: "remove", path: "/users/$$a" }]);

    expect(result.posts).toBe(postsRefBefore);
  });

  it("keeps unaffected items reference-identical while replacing changed ones", () => {
    const alice = { __dom_id: "a", name: "Alice" };
    const bob = { __dom_id: "b", name: "Bob" };
    const original = { users: [alice, bob] };

    const result = applyPatch(original, [
      {
        op: "replace",
        path: "/users/$$b",
        value: { __dom_id: "b", name: "New Bob" },
      },
    ]);

    expect(result.users[0]).toBe(alice);
    expect(result.users[1]).not.toBe(bob);
    expect(result.users[1]).toEqual({ __dom_id: "b", name: "New Bob" });
  });

  it("only clones a key once across multiple ops in the same batch", () => {
    const original = { users: [{ __dom_id: "a" }] };

    const result = applyPatch(original, [
      { op: "upsert", path: "/users/-", value: { __dom_id: "b" } },
      { op: "upsert", path: "/users/-", value: { __dom_id: "c" } },
    ]);

    expect(result.users.map((u) => u.__dom_id)).toEqual(["a", "b", "c"]);
  });

  it("mutates and returns the same document object (bag identity is stable)", () => {
    const original = { users: [] };
    const result = applyPatch(original, [
      { op: "upsert", path: "/users/-", value: { __dom_id: "a" } },
    ]);
    expect(result).toBe(original);
  });

  it("gives item-level identity to a field-level replace inside an array element", () => {
    const item0 = { id: 1, name: "old" };
    const item1 = { id: 2, name: "b" };
    const original = { items: [item0, item1] };
    const itemsRefBefore = original.items;

    const result = applyPatch(original, [
      { op: "replace", path: "/items/0/name", value: "new" },
    ]);

    expect(result.items).not.toBe(itemsRefBefore);
    expect(result.items[0]).not.toBe(item0);
    expect(result.items[0]).toEqual({ id: 1, name: "new" });
    expect(result.items[1]).toBe(item1);
    expect(item0.name).toBe("old"); // the original object must be untouched
  });

  it("gives nested-object identity to a field-level replace inside a plain nested object", () => {
    const address = { city: "old" };
    const user = { name: "Ada", address };
    const original = { user };
    const userRefBefore = original.user;

    const result = applyPatch(original, [
      { op: "replace", path: "/user/address/city", value: "new" },
    ]);

    expect(result.user).not.toBe(userRefBefore);
    expect(result.user.address).not.toBe(address);
    expect(result.user.address).toEqual({ city: "new" });
    expect(result.user.name).toBe("Ada");
    expect(address.city).toBe("old"); // the original object must be untouched
  });

  it("does not corrupt an append insert with a stray undefined element", () => {
    const original = { users: [{ __dom_id: "a" }] };

    const result = applyPatch(original, [
      { op: "upsert", path: "/users/-", value: { __dom_id: "b" } },
    ]);

    expect(result.users).toEqual([{ __dom_id: "a" }, { __dom_id: "b" }]);
    expect(result.users).toHaveLength(2);
  });

  it("still clones a single-segment target for limit operations", () => {
    const original = { rows: [1, 2, 3, 4] };
    const rowsRefBefore = original.rows;

    const result = applyPatch(original, [
      { op: "limit", path: "/rows", value: 2 },
    ]);

    expect(result.rows).not.toBe(rowsRefBefore);
    expect(result.rows).toEqual([1, 2]);
  });
});
