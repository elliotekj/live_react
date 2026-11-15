declare function liveReactPlugin(options?: {
  path?: string;
  entrypoint?: string;
  maxBodyBytes?: number;
}): { name: string };

export = liveReactPlugin;
