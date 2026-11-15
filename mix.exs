defmodule LiveReact.MixProject do
  use Mix.Project

  @source_url "https://github.com/mrdotb/live_react"
  @version "2.0.0"

  def project do
    [
      app: :live_react,
      version: @version,
      elixir: "~> 1.16",
      start_permanent: Mix.env() == :prod,
      consolidate_protocols: Mix.env() != :test,
      deps: deps(),
      description: "E2E reactivity for React and LiveView",
      package: package(),
      docs: docs(),
      source_url: @source_url
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      extra_applications: [:logger, :inets]
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      {:jason, "~> 1.2"},
      {:jsonpatch, "~> 2.3"},
      {:nodejs, "~> 3.1", optional: true},
      {:floki, ">= 0.30.0", optional: true},
      {:ecto, "~> 3.0", optional: true},
      {:phoenix_ecto, "~> 4.0", optional: true},
      {:phoenix, ">= 1.7.0"},
      {:phoenix_html, ">= 3.3.1"},
      {:phoenix_live_view, ">= 0.20.0"},
      {:telemetry, "~> 0.4 or ~> 1.0"},
      {:credo, "~> 1.7", only: [:dev, :test]},
      {:ex_doc, "~> 0.19", only: :dev, runtime: false},
      {:git_ops, "~> 2.12", only: [:dev]}
    ]
  end

  defp package do
    [
      maintainers: ["Baptiste Chaleil"],
      licenses: ["MIT"],
      links: %{
        Github: "https://github.com/mrdotb/live_react"
      },
      files:
        ~w(assets/copy assets/js lib)s ++
          ~w(CHANGELOG.md LICENSE.md mix.exs package.json README.md .formatter.exs)s
    ]
  end

  defp docs do
    [
      name: "LiveReact",
      source_ref: "v#{@version}",
      source_url: "https://github.com/mrdotb/live_react",
      homepage_url: "https://github.com/mrdotb/live_react",
      main: "readme",
      extras: [
        "README.md",
        "guides/installation.md",
        "guides/props-diffing.md",
        "guides/deployment.md",
        "guides/development.md",
        "guides/ssr.md",
        "guides/upgrading-to-2.0.md",
        "guides/upgrading-to-vite-8.md",
        "CHANGELOG.md"
      ]
    ]
  end
end
