function unescapePathComponent(path) {
  return path.replace(/~1/g, "/").replace(/~0/g, "~");
}

function hasOwn(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function resolvePathComponent(component, arrayObj) {
  if (!component.startsWith("$$")) {
    return component;
  }

  const targetId = component.substring(2);
  const index = arrayObj.findIndex(
    (item) =>
      item &&
      typeof item === "object" &&
      hasOwn(item, "__dom_id") &&
      item.__dom_id == targetId,
  );

  if (index === -1) {
    console.warn(
      `JSON Patch: Item with __dom_id "${targetId}" not found in array, skipping operation`,
    );
    return null;
  }

  return index.toString();
}

function readPathSegment(path, start, end) {
  const segment = path.slice(start, end);
  return segment.indexOf("~") === -1 ? segment : unescapePathComponent(segment);
}

function resolveArrayIndex(key, arrayObj, allowAppend) {
  if (key.startsWith("$$")) {
    const resolved = resolvePathComponent(key, arrayObj);
    return resolved === null ? null : parseInt(resolved, 10);
  }

  if (key === "-") return allowAppend ? arrayObj.length : arrayObj.length - 1;
  return parseInt(key, 10);
}

export function getValueByPointer(document, pointer) {
  if (pointer === "") return document;

  const keys = pointer.split("/").slice(1);
  let obj = document;

  for (const key of keys) {
    let resolvedKey =
      key.indexOf("~") !== -1 ? unescapePathComponent(key) : key;

    if (Array.isArray(obj)) {
      if (resolvedKey.startsWith("$$")) {
        const resolved = resolvePathComponent(resolvedKey, obj);
        if (resolved === null) return undefined;
        resolvedKey = resolved;
      }
      resolvedKey =
        resolvedKey === "-" ? obj.length - 1 : parseInt(resolvedKey, 10);
      obj = hasOwn(obj, resolvedKey) ? obj[resolvedKey] : undefined;
    } else {
      obj = hasOwn(obj, resolvedKey) ? obj[resolvedKey] : undefined;
    }
  }

  return obj;
}

/**
 * Apply a single patch operation on a JSON document in-place.
 */
export function applyOperation(document, operation) {
  return applyPatchOperation(
    document,
    operation.op,
    operation.path,
    operation.value,
  );
}

function applyPatchOperation(document, op, path, value) {
  if (path === "") {
    switch (op) {
      case "add":
      case "replace":
        return value;
      case "test":
        return document;
      case "remove":
        return null;
    }
  }

  let obj = document;
  let segmentStart = 1;

  while (true) {
    const segmentEnd = path.indexOf("/", segmentStart);
    if (segmentEnd === -1) break;

    const key = readPathSegment(path, segmentStart, segmentEnd);

    if (Array.isArray(obj)) {
      const index = resolveArrayIndex(key, obj, false);
      if (index === null || !hasOwn(obj, index)) return document;
      obj = obj[index];
    } else {
      if (!hasOwn(obj, key)) return document;
      obj = obj[key];
    }

    segmentStart = segmentEnd + 1;
  }

  const unescapedKey = readPathSegment(path, segmentStart, path.length);

  if (obj == null || typeof obj !== "object") return document;

  if (Array.isArray(obj)) {
    const resolvedIndex = resolveArrayIndex(unescapedKey, obj, true);
    if (resolvedIndex === null) return document;
    const index = resolvedIndex;

    switch (op) {
      case "add":
        obj.splice(index, 0, value);
        break;
      case "remove":
        obj.splice(index, 1);
        break;
      case "replace":
        obj[index] = value;
        break;
      case "upsert":
      case "upsert_limit": {
        const limit = op === "upsert_limit" ? value.limit : null;
        if (op === "upsert_limit") value = value.item;
        if (value && typeof value === "object" && hasOwn(value, "__dom_id")) {
          const existingIndex = obj.findIndex(
            (item) =>
              item &&
              typeof item === "object" &&
              hasOwn(item, "__dom_id") &&
              item.__dom_id === value.__dom_id,
          );

          if (existingIndex !== -1) {
            obj[existingIndex] = value;
          } else {
            obj.splice(index, 0, value);
            if (limit !== null) limitArray(obj, limit);
          }
        } else {
          obj.splice(index, 0, value);
          if (limit !== null) limitArray(obj, limit);
        }
        break;
      }
      case "test":
        break;
      case "limit":
        if (value >= 0) {
          if (value < obj.length) obj.splice(value);
        } else {
          const keepCount = Math.abs(value);
          if (keepCount < obj.length) obj.splice(0, obj.length - keepCount);
        }
        break;
    }
  } else {
    switch (op) {
      case "add":
      case "replace":
        setOwn(obj, unescapedKey, value);
        break;
      case "remove":
        delete obj[unescapedKey];
        break;
      case "test":
        break;
      case "limit":
        const targetArray = hasOwn(obj, unescapedKey)
          ? obj[unescapedKey]
          : undefined;
        if (Array.isArray(targetArray)) {
          if (value >= 0) {
            if (value < targetArray.length) targetArray.splice(value);
          } else {
            const keepCount = Math.abs(value);
            if (keepCount < targetArray.length)
              targetArray.splice(0, targetArray.length - keepCount);
          }
        }
        break;
    }
  }

  return document;
}

function limitArray(array, limit) {
  if (limit >= 0) {
    if (limit < array.length) array.splice(limit);
  } else {
    const keepCount = Math.abs(limit);
    if (keepCount < array.length) array.splice(0, array.length - keepCount);
  }
}

function cloneShallow(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === "object") return { ...value };
  return value;
}

function ensureWritableChild(parent, key, owned) {
  const child = parent[key];
  if (child && typeof child === "object" && !owned.has(child)) {
    const clone = cloneShallow(child);
    owned.add(clone);
    setOwn(parent, key, clone);
  }
}

/**
 * Clones containers along `path`, the first time this patch
 * batch touches each one — so the eventual write, wherever in
 * applyPatchOperation's own traversal it lands, always mutates a
 * this-batch-fresh object/array instead of aliasing a value some other
 * live reference (a prior render's props, a memoized child's captured
 * item) still points to.
 *
 * Segment 1 is always a clone candidate, even for single-segment paths
 * like `/users` — that's what `applyPatchOperation`'s top-level splice/
 * assign (e.g. the `limit` operation) mutates directly. Segments 2..N-1
 * extend the same guarantee to nested paths like `/items/1/name`, where
 * both `document.items` (the array) and `document.items[1]` (the item)
 * need fresh references before the write two levels down.
 */
function ensureWritablePath(document, path, owned, op) {
  let obj = document;
  let segmentStart = 1;

  while (true) {
    const segmentEnd = path.indexOf("/", segmentStart);
    if (segmentEnd === -1) break;

    const key = readPathSegment(path, segmentStart, segmentEnd);
    let resolvedKey = key;

    if (obj == null || typeof obj !== "object") return false;

    if (Array.isArray(obj)) {
      const index = resolveArrayIndex(key, obj, false);
      if (index === null) return;
      resolvedKey = index;
    }

    if (!hasOwn(obj, resolvedKey)) return false;
    ensureWritableChild(obj, resolvedKey, owned);

    obj = obj[resolvedKey];
    segmentStart = segmentEnd + 1;
  }

  if (obj == null || typeof obj !== "object") return false;

  if (segmentStart === 1 || op === "limit") {
    const key = readPathSegment(path, segmentStart, path.length);
    if (hasOwn(obj, key)) ensureWritableChild(obj, key, owned);
  }

  return true;
}

export function applyPatch(document, patch) {
  let result = document;
  let owned = new WeakSet();

  for (let index = 0; index < patch.length; index++) {
    let operation = patch[index];
    const next = patch[index + 1];
    const limit = patch[index + 2];
    if (
      operation.op === "upsert" &&
      next?.op === "limit" &&
      next.path === operation.path.slice(0, operation.path.lastIndexOf("/")) &&
      next.value &&
      typeof next.value === "object" &&
      hasOwn(next.value, "on_insert") &&
      next.value.on_insert === operation.value?.__dom_id &&
      limit?.op === "limit" &&
      limit.path === next.path &&
      typeof limit.value === "number"
    ) {
      operation = {
        op: "upsert_limit",
        path: operation.path,
        value: { item: operation.value, limit: limit.value },
      };
      index += 2;
    }
    if (operation.path === "") {
      result = applyOperation(result, operation);
      owned = new WeakSet();
      continue;
    }

    if (ensureWritablePath(result, operation.path, owned, operation.op)) {
      applyOperation(result, operation);
    }
  }

  return result;
}
