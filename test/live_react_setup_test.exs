defmodule LiveReactSetupTest do
  use ExUnit.Case

  test "copies assets when the dependency path contains copy" do
    root =
      Path.join(
        System.tmp_dir!(),
        "live-react-copy-#{System.pid()}-#{System.unique_integer([:positive])}"
      )

    File.mkdir!(root)
    dependency = Path.join(root, "dependency")
    project = Path.join(root, "project")
    source = Path.join(dependency, "assets/copy/js/server.js")
    File.mkdir_p!(Path.dirname(source))
    File.write!(source, "export const render = true;\n")

    File.write!(Path.join(dependency, "mix.exs"), """
    defmodule SetupDependency.MixProject do
      use Mix.Project
      def project, do: [app: :live_react, version: "0.1.0"]
    end
    """)

    File.mkdir_p!(project)

    File.write!(Path.join(project, "mix.exs"), """
    defmodule SetupFixture.MixProject do
      use Mix.Project
      def project, do: [app: :setup_fixture, version: "0.1.0", deps: [{:live_react, path: #{inspect(dependency)}}]]
    end
    """)

    try do
      source = Path.expand("../lib/mix/tasks/setup.ex", __DIR__)
      code = "Code.require_file(#{inspect(source)}); Mix.Tasks.LiveReact.Setup.run([])"

      {output, status} =
        System.cmd("mix", ["run", "--no-start", "--no-deps-check", "--no-compile", "-e", code],
          cd: project,
          stderr_to_stdout: true
        )

      assert status == 0, output
      target = Path.join(project, "assets/js/server.js")
      assert File.read!(target) == "export const render = true;\n"
      File.write!(target, "existing file")

      {output, status} =
        System.cmd("mix", ["run", "--no-start", "--no-deps-check", "--no-compile", "-e", code],
          cd: project,
          stderr_to_stdout: true
        )

      assert status == 0, output
      assert File.read!(target) == "existing file"
    after
      File.rm_rf!(root)
    end
  end
end
