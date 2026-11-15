# Deployment

[Without SSR](#without-ssr)
[With SSR](#with-ssr)

## Without SSR

The following steps are needed to deploy to Fly.io. This guide assumes that you'll be using Fly Postgres as your database. Further guidance on how to deploy to Fly.io can be found [here](https://fly.io/docs/elixir/getting-started/).

1. Generate a `Dockerfile`:

```bash
mix phx.gen.release --docker
```

2. Modify the generated `Dockerfile` to install Node.js 24 and the npm dependencies:

```diff
# ./Dockerfile

...

# install build dependencies
 RUN apt-get update \
-  && apt-get install -y --no-install-recommends build-essential git \
+  && apt-get install -y --no-install-recommends build-essential git curl \
   && rm -rf /var/lib/apt/lists/*

+ # install nodejs for build stage
+ RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs

 RUN mix deps.compile
-RUN mix assets.setup

...

COPY assets assets

+ # install all npm packages in assets directory
+ RUN cd /app/assets && npm install
```

Note: `nodejs` is installed in the build stage. This is because we need `nodejs` to install our `npm` dependencies.

3. Launch your app with the Fly.io CLI:

```bash
fly launch
```

4. When prompted to tweak settings, choose `y`:

```bash
? Do you want to tweak these settings before proceeding? (y/N) y
```

This will launch a new window where you can tweak your launch settings. In the database section, choose `Fly Postgres` and enter a name for your database. You may also want to change your database to the development configuration to avoid extra costs. You can leave the rest of the settings as-is unless you want to change them.

Deployment will continue once you hit confirm.

5. Once the deployment completes, run the following command to see your deployed app!

```bash
fly apps open
```

## With SSR

See the [SSR guide](/guides/ssr.md) first to setup your project.

The following steps are needed to deploy to Fly.io. This guide assumes that you'll be using Fly Postgres as your database. Further guidance on how to deploy to Fly.io can be found [here](https://fly.io/docs/elixir/getting-started/).

1. Generate a `Dockerfile`:

```bash
mix phx.gen.release --docker
```

2. Modify the generated `Dockerfile` to install Node.js 24 and the npm dependencies:

```diff
# ./Dockerfile

...

# install build dependencies
 RUN apt-get update \
-  && apt-get install -y --no-install-recommends build-essential git \
+  && apt-get install -y --no-install-recommends build-essential git curl \
   && rm -rf /var/lib/apt/lists/*

+ # install nodejs for build stage
+ RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs

 RUN mix deps.compile
-RUN mix assets.setup

...

COPY assets assets

+ # install all npm packages in assets directory
+ RUN cd /app/assets && npm install

...

# start a new build stage so that the final image will only contain
# the compiled release and other runtime necessities
FROM ${RUNNER_IMAGE}

 RUN apt-get update \
-  && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 locales ca-certificates \
+  && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 locales ca-certificates curl \
   && rm -rf /var/lib/apt/lists/*

+ # install nodejs for production environment
+ RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs

...

WORKDIR /app

 # Keep npm's local file dependency links and their targets in place.
+COPY --from=builder --chown=nobody:root /app/assets/node_modules /app/assets/node_modules
+COPY --from=builder --chown=nobody:root /app/deps /app/deps
+RUN ln -s assets/node_modules /app/node_modules
+
 # Copy the release as in the generated Dockerfile.
 COPY --from=builder --chown=nobody:root /app/_build/${MIX_ENV}/rel/<app_name> ./
```

Node.js is needed both to build the assets and to render them in the final image. The server bundle imports npm packages at runtime, so the final image also needs `node_modules`. The `/app/assets` and `/app/deps` paths preserve the relative links created for the local Phoenix and LiveReact packages. The `/app/node_modules` link lets Node find those packages from the release. Replace `<app_name>` with the release name in your generated Dockerfile.

3. Launch your app with the Fly.io CLI:

```bash
fly launch
```

4. When prompted to tweak settings, choose `y`:

```bash
? Do you want to tweak these settings before proceeding? (y/N) y
```

This will launch a new window where you can tweak your launch settings. In the database section, choose `Fly Postgres` and enter a name for your database. You may also want to change your database to the development configuration to avoid extra costs. You can leave the rest of the settings as-is unless you want to change them.

Deployment will continue once you hit confirm.

5. Once the deployment completes, run the following command to see your deployed app!

```bash
fly apps open
```
