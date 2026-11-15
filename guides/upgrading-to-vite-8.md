# Upgrade to Vite 8

Existing LiveReact applications can keep their current frontend dependencies. Follow these steps if you choose to upgrade your application's Vite configuration to Vite 8. The `mix live_react.setup` task does not overwrite existing files, so update your application files yourself.

1. Use a supported version of Node.js. Vite 8 requires Node.js 20.19+ or 22.12+. See the [Vite 8 release notes](https://vite.dev/blog/announcing-vite8.html#node-js-support) for supported versions.
2. Upgrade Vite and your Vite plugins in `assets/package.json`. Check the [Vite migration guide](https://vite.dev/guide/migration.html) for changes that affect your plugins and configuration.
3. If your `build-server` script uses `--minify esbuild`, replace it with `--minify`:

   ```json
   "build-server": "tsc && vite build --ssr js/server.js --out-dir ../priv/react-components --minify && echo '{\"type\": \"module\" } ' > ../priv/react-components/package.json"
   ```

   Vite 8 no longer installs esbuild directly. If you need to retain esbuild for minification or a plugin, install it as a development dependency instead. See the [Vite migration guide](https://vite.dev/guide/migration.html) for details.
4. Run `npm install`, `npm run build`, and `npm run build-server` in `assets`. Resolve any errors from your application or plugins before deploying.

The updated LiveReact setup template also uses newer React type definitions and TypeScript. If you upgrade those packages, check your application's types and compiler options too.
