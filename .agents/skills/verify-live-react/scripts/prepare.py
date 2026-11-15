#!/usr/bin/env python3
"""Prepare an isolated, pinned example app against the current checkout."""
import argparse
import os
from pathlib import Path
import socket
import subprocess

REVISION = "476802013f043331e2ed800a41a4f7e251e9097a"


def run(*args, cwd, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def replace_once(path, old, new):
    text = path.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"Expected one occurrence of {old!r} in {path}")
    path.write_text(text.replace(old, new))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("repo", type=Path)
    parser.add_argument("run", type=Path)
    parser.add_argument("http_port", type=int)
    parser.add_argument("vite_port", type=int)
    args = parser.parse_args()
    repo = args.repo.resolve(strict=True)
    run_dir = args.run.resolve(strict=True)
    if not (repo / "mix.exs").is_file() or not (repo / "assets/js/live_react/hooks.js").is_file():
        raise SystemExit("repo must be the LiveReact checkout")
    if args.http_port == args.vite_port or not all(1024 <= p <= 65535 for p in (args.http_port, args.vite_port)):
        raise SystemExit("choose two distinct unprivileged ports")
    for port in (args.http_port, args.vite_port):
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", port))
    app = run_dir / "app"
    if app.exists():
        raise SystemExit(f"Refusing to reuse {app}")
    app.mkdir()
    run("git", "init", "-q", cwd=app)
    run("git", "remote", "add", "origin", "https://github.com/mrdotb/live_react_examples.git", cwd=app)
    run("git", "fetch", "--quiet", "--depth", "1", "origin", REVISION, cwd=app)
    run("git", "checkout", "--quiet", "--detach", "FETCH_HEAD", cwd=app)
    config = app / "config/dev.exs"
    replace_once(config, "port: 3200", f"port: {args.http_port}")
    replace_once(config, "http://localhost:3300", f"http://127.0.0.1:{args.vite_port}")
    replace_once(app / "assets/vite.config.js", "host: '0.0.0.0'", "host: '127.0.0.1'")
    replace_once(app / "assets/package.json", '"dev": "vite --host"', '"dev": "vite --host 127.0.0.1"')
    env = os.environ.copy()
    env.update(LIVE_REACT_PATH=str(repo), VITE_PORT=str(args.vite_port), MIX_ENV="dev")
    run("mix", "deps.get", cwd=app, env=env)
    (app / "deps/live_react").symlink_to(repo, target_is_directory=True)
    run("mix", "setup", cwd=app, env=env)
    print(f"Prepared {app}\nRun with LIVE_REACT_PATH={repo} VITE_PORT={args.vite_port} mix phx.server", flush=True)


if __name__ == "__main__":
    main()
