import React from "react";
import ReactDOM from "react-dom/client";
import { getComponentTree } from "./utils";
import { decodeCompactJson, decodeCompactPatch } from "./compactPatch";
import { applyPatch } from "./jsonPatch";

function getAttributeJson(el, attributeName) {
  const data = el.getAttribute(attributeName);
  return data ? JSON.parse(data) : {};
}

function getDiff(el, attributeName) {
  return decodeCompactPatch(el.getAttribute(attributeName));
}

function getBaseProps(el) {
  const data = el.getAttribute("data-props");
  return data ? decodeCompactJson(data) : {};
}

function getComponent(components, el) {
  const name = el.getAttribute("data-name");
  if (!name) throw new Error("Component name must be provided");
  return components[name];
}

function getChildren(hook) {
  const dataSlots = getAttributeJson(hook.el, "data-slots");

  if (!dataSlots?.default) {
    return [];
  }

  return [
    React.createElement("div", {
      dangerouslySetInnerHTML: {
        __html: new TextDecoder()
          .decode(
            Uint8Array.from(atob(dataSlots.default), (byte) =>
              byte.charCodeAt(0),
            ),
          )
          .trim(),
      },
    }),
  ];
}

function getProps(hook) {
  return {
    ...hook._props,
    ...hook._streams,
    ...hook._helpers,
  };
}

function refreshStreams(hook, force = false) {
  const encodedNames = hook.el.getAttribute("data-stream-names");
  const names =
    encodedNames === null ? null : new Set(JSON.parse(encodedNames));

  if (names) {
    for (const name of Object.keys(hook._streams)) {
      if (!names.has(name)) delete hook._streams[name];
    }
    for (const name of names) {
      delete hook._props[name];
      if (!Object.prototype.hasOwnProperty.call(hook._streams, name)) {
        Object.defineProperty(hook._streams, name, {
          value: [],
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }
  }

  const encodedPatch = hook.el.getAttribute("data-streams-diff");
  if (force || encodedPatch !== hook._streamDiff) {
    let patch = decodeCompactPatch(encodedPatch);
    if (names) {
      patch = patch.filter(({ path }) =>
        names.has(
          path
            .slice(1)
            .split("/", 1)[0]
            .replace(/~1/g, "/")
            .replace(/~0/g, "~"),
        ),
      );
    }
    hook._streams = applyPatch(hook._streams, patch);
    hook._streamDiff = encodedPatch;
  }
}

function refreshProps(hook) {
  const useDiff = hook.el.getAttribute("data-use-diff") === "true";
  const fullProps = hook.el.getAttribute("data-props-full") === "true";
  if (useDiff && hook._useDiff === useDiff && !fullProps) {
    hook._props = applyPatch(hook._props, getDiff(hook.el, "data-props-diff"));
  } else {
    hook._props = getBaseProps(hook.el);
  }
  hook._useDiff = useDiff;
}

// Renders via a module-level function (rather than a `this._render()` method
// on the hook object) so it works regardless of how `mounted`/`updated`/
// `reconnected` are invoked. In production, LiveView's ViewHook merges every
// key of the hook definition (including a `_render` method) onto the same
// instance before calling any callback, so `this._render()` would resolve —
// but that merging is an internal LiveView implementation detail, not part
// of the public hook contract, so we don't rely on it here.
function render(hook) {
  const tree = getComponentTree(
    hook._Component,
    getProps(hook),
    getChildren(hook),
  );
  hook._root.render(tree);
}

export function getHooks(components) {
  const ReactHook = {
    mounted() {
      this._Component = getComponent(components, this.el);
      this._helpers = {
        pushEvent: this.pushEvent.bind(this),
        pushEventTo: this.pushEventTo.bind(this),
        handleEvent: this.handleEvent.bind(this),
        removeHandleEvent: this.removeHandleEvent.bind(this),
        upload: this.upload.bind(this),
        uploadTo: this.uploadTo.bind(this),
      };
      this._props = getBaseProps(this.el);
      this._useDiff = this.el.getAttribute("data-use-diff") === "true";
      this._streams = {};
      refreshStreams(this);

      const isSSR = this.el.hasAttribute("data-ssr");

      if (isSSR) {
        const tree = getComponentTree(
          this._Component,
          getProps(this),
          getChildren(this),
        );
        this._root = ReactDOM.hydrateRoot(this.el, tree);
      } else {
        this._root = ReactDOM.createRoot(this.el);
        render(this);
      }
    },
    updated() {
      if (this._root) {
        this._Component = getComponent(components, this.el);
        refreshProps(this);
        refreshStreams(this);
        render(this);
      }
    },
    reconnected() {
      if (this._root) {
        // Unlike updated(), always do a full props resync from the current
        // data-props attribute rather than applying data-props-diff. On
        // reconnect the LiveView process is fresh (assigns.__changed__ ==
        // nil), so the server-computed diff is a no-op even though state may
        // have advanced while disconnected — but the full snapshot in
        // data-props is always current, so read that directly.
        this._props = getBaseProps(this.el);
        this._Component = getComponent(components, this.el);
        this._useDiff = this.el.getAttribute("data-use-diff") === "true";
        refreshStreams(this, true);
        render(this);
      }
    },
    destroyed() {
      if (this._root) {
        const root = this._root;
        this._root = null;
        queueMicrotask(() => root.unmount());
      }
    },
  };

  return { ReactHook };
}
