// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

const project = process.cwd();
let fixture;

afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

describe("packaged configuration", () => {
  it("bundles the legacy module entry", async () => {
    fixture = mkdtempSync(join(tmpdir(), "live-react-package-"));
    mkdirSync(join(fixture, "node_modules"));
    symlinkSync(project, join(fixture, "node_modules/live_react"), "dir");
    const entry = join(fixture, "entry.js");
    writeFileSync(
      entry,
      'import { getHooks } from "live_react"; console.log(getHooks);',
    );

    const result = await build({
      configFile: false,
      root: fixture,
      logLevel: "silent",
      resolve: { exportsFields: [], mainFields: ["module"] },
      build: { ssr: entry, write: false },
      ssr: { noExternal: ["live_react"] },
    });

    expect(result.output.some(({ code }) => code?.includes("getHooks"))).toBe(
      true,
    );
  });

  it("resolves the copied TypeScript alias into react-components", () => {
    fixture = mkdtempSync(join(tmpdir(), "live-react-alias-"));
    mkdirSync(join(fixture, "js"));
    mkdirSync(join(fixture, "react-components"));
    mkdirSync(join(fixture, "node_modules"));
    symlinkSync(
      resolve(project, "node_modules/vite"),
      join(fixture, "node_modules/vite"),
      "dir",
    );
    writeFileSync(
      join(fixture, "tsconfig.json"),
      readFileSync(resolve(project, "assets/copy/tsconfig.json")),
    );
    writeFileSync(
      join(fixture, "react-components/foo.ts"),
      "export const answer = 42;\n",
    );
    writeFileSync(
      join(fixture, "js/app.ts"),
      'import { answer } from "@/foo"; console.log(answer);\n',
    );

    expect(() =>
      execFileSync(
        process.execPath,
        [
          resolve(project, "node_modules/typescript/bin/tsc"),
          "-p",
          fixture,
          "--incremental",
          "false",
        ],
        { stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("type-checks components and nested application files", () => {
    fixture = mkdtempSync(join(tmpdir(), "live-react-typecheck-"));
    mkdirSync(join(fixture, "js/nested"), { recursive: true });
    mkdirSync(join(fixture, "react-components"));
    mkdirSync(join(fixture, "node_modules"));
    symlinkSync(
      resolve(project, "node_modules/vite"),
      join(fixture, "node_modules/vite"),
      "dir",
    );
    writeFileSync(
      join(fixture, "tsconfig.json"),
      readFileSync(resolve(project, "assets/copy/tsconfig.json")),
    );
    writeFileSync(
      join(fixture, "js/app.ts"),
      'import.meta.glob("../react-components/**/*.tsx");\n',
    );
    writeFileSync(
      join(fixture, "js/nested/bad.ts"),
      'export const broken: number = "wrong";\n',
    );
    writeFileSync(
      join(fixture, "react-components/bad.tsx"),
      'export const broken: number = "wrong";\n',
    );

    try {
      execFileSync(
        process.execPath,
        [
          resolve(project, "node_modules/typescript/bin/tsc"),
          "-p",
          fixture,
          "--incremental",
          "false",
        ],
        { stdio: "pipe" },
      );
      throw new Error("Expected type checking to fail");
    } catch (error) {
      const output = String(error.stdout);
      expect(output).toContain("js/nested/bad.ts");
      expect(output).toContain("react-components/bad.tsx");
      expect(output).toContain("TS2322");
    }
  });

  it("declares the PostCSS plugins required by the copied configuration", async () => {
    fixture = mkdtempSync(join(tmpdir(), "live-react-postcss-"));
    const packageJson = readFileSync(
      resolve(project, "assets/copy/package.json"),
    );
    writeFileSync(join(fixture, "package.json"), packageJson);
    writeFileSync(
      join(fixture, "postcss.config.js"),
      readFileSync(resolve(project, "assets/copy/postcss.config.js")),
    );
    const manifest = JSON.parse(packageJson);
    const { default: config } = await import(
      pathToFileURL(join(fixture, "postcss.config.js")).href
    );
    for (const plugin of Object.keys(config.plugins)) {
      expect(
        manifest.dependencies?.[plugin] ?? manifest.devDependencies?.[plugin],
      ).toBeTruthy();
    }
  });

  it("renders an SSR bundle in a release with npm file dependencies", async () => {
    fixture = mkdtempSync(join(tmpdir(), "live-react-release-"));
    const builder = join(fixture, "builder");
    const release = join(fixture, "release");
    const modules = join(builder, "assets/node_modules");
    const localPackage = join(builder, "deps/local-package");
    const output = join(release, "lib/app/priv/react-components");
    mkdirSync(modules, { recursive: true });
    mkdirSync(localPackage, { recursive: true });
    for (const name of ["react", "react-dom", "scheduler"]) {
      cpSync(resolve(project, "node_modules", name), join(modules, name), {
        recursive: true,
      });
    }
    writeFileSync(
      join(localPackage, "package.json"),
      '{"name":"local-package","type":"module","exports":"./index.js"}',
    );
    writeFileSync(join(localPackage, "index.js"), 'export default "hello";');
    symlinkSync("../../deps/local-package", join(modules, "local-package"));
    const entry = join(builder, "assets/server.js");
    writeFileSync(
      entry,
      'import React from "react"; import { renderToString } from "react-dom/server"; import text from "local-package"; export const render = () => renderToString(React.createElement("p", null, text));',
    );
    await build({
      configFile: false,
      logLevel: "silent",
      build: { ssr: entry, outDir: output },
      ssr: {
        external: ["react", "react-dom", "react-dom/server", "local-package"],
      },
    });
    const run = () =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import(${JSON.stringify(pathToFileURL(join(output, "server.mjs")).href)}).then(m => console.log(m.render()));`,
        ],
        { encoding: "utf8", stdio: "pipe" },
      );
    expect(run).toThrow();
    mkdirSync(join(release, "assets"), { recursive: true });
    cpSync(modules, join(release, "assets/node_modules"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    cpSync(join(builder, "deps"), join(release, "deps"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    symlinkSync("assets/node_modules", join(release, "node_modules"));
    expect(run().trim()).toBe("<p>hello</p>");
  });
});
