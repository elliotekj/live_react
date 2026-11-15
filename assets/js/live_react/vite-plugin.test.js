// @vitest-environment node
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const liveReactPlugin = createRequire(import.meta.url)("./vite-plugin.js");

afterEach(() => vi.restoreAllMocks());

function setup(options = {}) {
  let middleware;
  const render = vi.fn(async (name, props, slots) =>
    JSON.stringify({ name, props, slots }),
  );
  vi.spyOn(process.stdin, "on").mockReturnThis();
  vi.spyOn(process.stdin, "resume").mockReturnThis();
  liveReactPlugin(options).configureServer({
    middlewares: { use: (handler) => (middleware = handler) },
    ssrLoadModule: async () => ({ render }),
    ssrFixStacktrace: (error) => error.stack,
  });
  return { middleware, render };
}

function request(
  middleware,
  { headers = {}, chunks = [], url = "/ssr_render", abort = false } = {},
) {
  const req = Object.assign(new EventEmitter(), {
    method: "POST",
    url,
    headers,
    resume: vi.fn(),
  });
  const res = { setHeader: vi.fn(), end: vi.fn() };
  const next = vi.fn();
  middleware(req, res, next);
  for (const chunk of chunks) req.emit("data", chunk);
  req.emit(abort ? "aborted" : "end");
  return { req, res, next };
}

describe("development SSR endpoint", () => {
  it("skips virtual modules when handling a hot update", () => {
    const plugin = liveReactPlugin();
    const updates = [];
    const module = { file: null, url: "/virtual:dep" };
    const server = {
      moduleGraph: { invalidateModule: (item, seen) => seen.add(item) },
      ws: { send: (message) => updates.push(message) },
    };

    expect(
      plugin.handleHotUpdate({
        file: "page.heex",
        modules: [module],
        server,
        timestamp: 1,
      }),
    ).toEqual([]);
    expect(updates[0].updates).toEqual([]);
  });

  it("rejects browser origins and requests without JSON content type", () => {
    const { middleware, render } = setup();
    for (const origin of ["https://attacker.example", "null", ""]) {
      const { res } = request(middleware, {
        headers: { origin, "content-type": "text/plain" },
        chunks: ['{"name":"Example"}'],
      });
      expect(res.statusCode).toBe(403);
    }
    const { res } = request(middleware, {
      headers: { "content-type": "text/plain" },
    });
    expect(res.statusCode).toBe(415);
    expect(render).not.toHaveBeenCalled();
  });

  it("renders JSON sent by the server, including a custom route and split UTF-8", async () => {
    const { middleware, render } = setup({ path: "/render" });
    const payload = Buffer.from(
      JSON.stringify({ name: "Example", props: { text: "é" }, slots: {} }),
    );
    const split = payload.indexOf(Buffer.from("é")) + 1;
    const { res } = request(middleware, {
      url: "/render?query=1",
      headers: { "content-type": "application/json; charset=utf-8" },
      chunks: [payload.subarray(0, split), payload.subarray(split)],
    });
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledOnce());
    expect(render).toHaveBeenCalledWith("Example", { text: "é" }, {});
    expect(JSON.parse(res.end.mock.calls[0][0]).props).toEqual({ text: "é" });
  });

  it("rejects oversized and malformed bodies without rendering", () => {
    const { middleware, render } = setup({ maxBodyBytes: 16 });
    const headers = { "content-type": "application/json" };
    const oversized = request(middleware, {
      headers,
      chunks: ["12345678", "123456789"],
    });
    expect(oversized.res.statusCode).toBe(413);
    expect(oversized.res.end).toHaveBeenCalledOnce();
    const malformed = request(middleware, { headers, chunks: ["{"] });
    expect(malformed.res.statusCode).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });

  it("accepts a body at the byte limit and rejects multibyte content above it", async () => {
    const { middleware, render } = setup({ maxBodyBytes: 14 });
    const headers = { "content-type": "application/json" };
    const exact = request(middleware, { headers, chunks: ['{"name":"abc"}'] });
    await vi.waitFor(() => expect(exact.res.end).toHaveBeenCalledOnce());
    expect(render).toHaveBeenCalledWith("abc", undefined, undefined);
    const oversized = request(middleware, {
      headers,
      chunks: ['{"name":"éé"}'],
    });
    expect(oversized.res.statusCode).toBe(413);
    expect(render).toHaveBeenCalledOnce();
  });

  it("does not render an aborted request", () => {
    const { middleware, render } = setup();
    const { req, res } = request(middleware, {
      headers: { "content-type": "application/json" },
      chunks: ['{"name":"Example"}'],
      abort: true,
    });
    req.emit("end");
    expect(render).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it.each([
    [new Error("Broken JSX component"), { message: "Broken JSX component" }],
    [null, { message: "null" }],
    [
      Object.assign(new Error("Syntax error"), {
        loc: { file: "view.jsx", line: 2, column: 3 },
        frame: "bad code",
      }),
      {
        message: "Syntax error",
        loc: { file: "view.jsx", line: 2, column: 3 },
        frame: "bad code",
      },
    ],
  ])("returns useful renderer error details", async (error, expected) => {
    const { middleware, render } = setup();
    render.mockRejectedValue(error);
    const { res } = request(middleware, {
      headers: { "content-type": "application/json" },
      chunks: ['{"name":"Example"}'],
    });
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledOnce());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.end.mock.calls[0][0]).error).toEqual(expected);
  });
});
