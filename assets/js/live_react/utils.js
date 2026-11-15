import React from "react";
import { LiveReactProvider } from "./context";

function getHooks(props) {
  return {
    pushEvent: props.pushEvent,
    pushEventTo: props.pushEventTo,
    handleEvent: props.handleEvent,
    removeHandleEvent: props.removeHandleEvent,
    upload: props.upload,
    uploadTo: props.uploadTo,
  };
}

export function getComponentTree(Component, props, children) {
  if (Object.prototype.hasOwnProperty.call(props, "__proto__")) {
    throw new Error('A top-level prop named "__proto__" is not supported');
  }

  const componentInstance = React.createElement(Component, props, ...children);

  return React.createElement(
    LiveReactProvider,
    getHooks(props),
    componentInstance,
  );
}
