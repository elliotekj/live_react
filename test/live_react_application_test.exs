defmodule LiveReactApplicationTest do
  use ExUnit.Case

  test "starts the HTTP client regardless of SSR configuration" do
    assert :inets in Application.spec(:live_react, :applications)
    assert Enum.any?(Application.started_applications(), fn {name, _, _} -> name == :inets end)
  end
end
