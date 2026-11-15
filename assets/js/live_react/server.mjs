import React from "react";
import { renderToString } from "react-dom/server";
import { getComponentTree } from "./utils";

function unavailable() {
  throw new Error("LiveView helpers are unavailable during server rendering");
}

const serverHooks = {
  pushEvent: unavailable.bind(null),
  pushEventTo: unavailable.bind(null),
  handleEvent: unavailable.bind(null),
  removeHandleEvent: unavailable.bind(null),
  upload: unavailable.bind(null),
  uploadTo: unavailable.bind(null),
};

function getChildren(slots) {
  if (!slots?.default) {
    return [];
  }

  return [
    React.createElement("div", {
      dangerouslySetInnerHTML: { __html: slots.default.trim() },
    }),
  ];
}

export function getRender(components) {
  return function render(name, props, slots) {
    const Component = components[name];
    if (!Component) {
      throw new Error(`Component "${name}" not found`);
    }
    const children = getChildren(slots);
    const tree = getComponentTree(
      Component,
      { ...props, ...serverHooks },
      children,
    );

    // https://react.dev/reference/react-dom/server/renderToString
    return renderToString(tree);
  };
}
