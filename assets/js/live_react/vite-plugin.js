function hotUpdateType(path) {
  if (!path) return null;
  if (path.endsWith("css")) return "css-update";
  if (path.endsWith("js")) return "js-update";
  return null;
}

const jsonResponse = (res, statusCode, data) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
};

const jsonMiddleware = (req, res, maxBodyBytes, next) => {
  let size = 0;
  let finished = false;
  const chunks = [];

  req.on("data", (chunk) => {
    if (finished) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBodyBytes) {
      finished = true;
      chunks.length = 0;
      jsonResponse(res, 413, { error: "Request body too large" });
      return;
    }
    chunks.push(bytes);
  });

  req.on("end", () => {
    if (finished) return;
    finished = true;
    try {
      req.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      next();
    } catch (error) {
      jsonResponse(res, 400, { error: "Invalid JSON" });
    }
  });

  req.on("aborted", () => {
    finished = true;
    chunks.length = 0;
  });
  req.on("error", (err) => {
    if (finished) return;
    finished = true;
    console.error(err);
    jsonResponse(res, 500, { error: "Internal Server Error" });
  });
};

function liveReactPlugin(opts = {}) {
  const maxBodyBytes = opts.maxBodyBytes ?? 10 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new TypeError("maxBodyBytes must be a positive integer");
  }
  return {
    name: "live-react",
    handleHotUpdate({ file, modules, server, timestamp }) {
      if (file.match(/\.(heex|ex)$/)) {
        // if it's and .ex or .heex file, invalidate all related files so they'll be updated correctly
        const invalidatedModules = new Set();
        for (const mod of modules) {
          server.moduleGraph.invalidateModule(
            mod,
            invalidatedModules,
            timestamp,
            true,
          );
        }

        const updates = Array.from(invalidatedModules)
          .filter((m) => hotUpdateType(m.file))
          .map((m) => ({
            type: hotUpdateType(m.file),
            path: m.url,
            acceptedPath: m.url,
            timestamp: timestamp,
          }));

        // ask client to hot-reload updated modules
        server.ws.send({ type: "update", updates: updates });

        // we handle the hot update ourselves
        return [];
      }
    },
    configureServer(server) {
      // Terminate the watcher when Phoenix quits
      // configureServer is only called in dev, so it's safe to use here
      process.stdin.on("close", () => process.exit(0));
      process.stdin.resume();

      // setup SSR endpoint /ssr_render
      const path = opts.path || "/ssr_render";
      const entrypoint = opts.entrypoint || "./js/server.js";
      server.middlewares.use(function liveReactMiddleware(req, res, next) {
        if (req.method == "POST" && req.url.split("?", 1)[0] === path) {
          if (req.headers.origin !== undefined) {
            jsonResponse(res, 403, { error: "Origin not allowed" });
            req.resume();
            return;
          }
          if (
            !/^application\/json(?:\s*;|\s*$)/i.test(
              req.headers["content-type"] || "",
            )
          ) {
            jsonResponse(res, 415, { error: "Expected application/json" });
            req.resume();
            return;
          }
          jsonMiddleware(req, res, maxBodyBytes, async () => {
            try {
              const render = (await server.ssrLoadModule(entrypoint)).render;
              const html = await render(
                req.body.name,
                req.body.props,
                req.body.slots,
              );
              res.end(html);
            } catch (e) {
              if (e != null) server.ssrFixStacktrace(e);
              jsonResponse(res, 500, {
                error: {
                  message: String(e?.message ?? e),
                  loc: e?.loc,
                  frame: e?.frame,
                },
              });
            }
          });
        } else {
          next();
        }
      });
    },
  };
}

module.exports = liveReactPlugin;
