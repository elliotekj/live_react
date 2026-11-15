defmodule LiveReactChangeTrackingTest do
  @moduledoc """
  Covers which attributes LiveView actually *sends* on a re-render.

  The other props-diff tests render the component directly and read the
  attributes off the resulting HTML, where every attribute is always present.
  That cannot catch a bug in `mark_computed_changed/3`, because marking only
  decides what LiveView puts on the wire. Here we ask the `Rendered` struct for
  its dynamic parts with change tracking enabled, so an attribute LiveView
  would skip comes back as `nil`.
  """
  use ExUnit.Case

  import Phoenix.Component

  def spread_component(assigns) do
    ~H"""
    <LiveReact.react name="T" id="fixed" ssr={false} {@props} />
    """
  end

  def spread_ssr_component(assigns) do
    ~H"""
    <LiveReact.react name="T" id="fixed" {@props} />
    """
  end

  defmodule CaptureSSR do
    def render(_name, _props, _slots) do
      send(self(), :ssr_rendered)
      "<p>Rendered</p>"
    end
  end

  test "dynamic spreads use the supplied socket to decide whether to render SSR" do
    previous = Application.get_env(:live_react, :ssr_module)
    Application.put_env(:live_react, :ssr_module, CaptureSSR)
    on_exit(fn -> Application.put_env(:live_react, :ssr_module, previous) end)

    for {socket, ssr?} <- [
          {%Phoenix.LiveView.Socket{}, true},
          {%Phoenix.LiveView.Socket{transport_pid: self()}, false}
        ] do
      spread_ssr_component(%{props: %{socket: socket, title: "new"}, __changed__: %{props: true}})
      |> Phoenix.HTML.Safe.to_iodata()
      |> IO.iodata_to_binary()

      if ssr?, do: assert_received(:ssr_rendered), else: refute_received(:ssr_rendered)
    end
  end

  test "HEEx dynamic spreads identify full snapshots on updates" do
    for {props, changed} <- [
          {%{title: "old", removed: true}, nil},
          {%{title: "new", added: true}, %{props: %{title: "old", removed: true}}}
        ] do
      html =
        spread_component(%{props: props, __changed__: changed})
        |> Phoenix.HTML.Safe.to_iodata()
        |> IO.iodata_to_binary()

      [element] = Floki.parse_fragment!(html)
      assert Floki.attribute(element, "data-props-full") == ["true"]

      assert LiveReact.Test.get_react(html).props ==
               Map.new(props, fn {k, v} -> {to_string(k), v} end)
    end

    assert Enum.any?(
             sent(updated_assigns(%{})),
             &String.contains?(&1, "data-props-full=\"false\"")
           )
  end

  # The dynamic parts LiveView would actually send, change tracking enabled.
  defp sent(assigns) do
    %Phoenix.LiveView.Rendered{dynamic: dynamic} = LiveReact.react(assigns)

    dynamic.(true)
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&IO.iodata_to_binary/1)
  end

  # `data-props` carries a full JSON object; `Patch.encode_object/1` swaps `"` for `^`.
  defp snapshot?(value), do: String.starts_with?(value, "{^")
  defp patch_for_items?(value), do: String.contains?(value, "/items")

  defp updated_assigns(extra) do
    extra
    |> Map.merge(%{name: "T", items: [%{id: 1, title: "a"}], __changed__: %{}})
    |> assign(:items, [%{id: 1, title: "b"}])
  end

  describe "connected re-render" do
    test "sends stream names when a prop changes between stream and ordinary data" do
      stream = Phoenix.LiveView.LiveStream.new(:items, make_ref(), [%{id: 1}], [])

      for {old, new, expected} <- [
            {stream, [%{id: 2}], "[]"},
            {[%{id: 2}], stream, "[&quot;items&quot;]"},
            {true, stream, "[&quot;items&quot;]"}
          ] do
        sent = sent(%{name: "T", id: "same", items: new, __changed__: %{items: old}})
        assert Enum.any?(sent, &String.contains?(&1, expected))
      end
    end

    test "sends a changed component name" do
      sent = sent(%{name: "NewComponent", id: "same", __changed__: %{name: "OldComponent"}})

      assert Enum.any?(sent, &String.contains?(&1, "data-name=\"NewComponent\""))
    end

    test "sends a full snapshot and mode when diff changes in either direction" do
      for {old, new} <- [{false, true}, {true, false}] do
        sent =
          sent(%{
            name: "T",
            id: "same",
            diff: new,
            title: "new",
            unchanged: "retained",
            __changed__: %{diff: old, title: "old"}
          })

        assert Enum.any?(sent, &String.contains?(&1, "data-use-diff=\"#{new}\""))
        assert Enum.any?(sent, &(String.contains?(&1, "retained") and snapshot?(&1)))
      end
    end

    test "does not replay an unchanged stream when diff mode changes" do
      stream = Phoenix.LiveView.LiveStream.new(:users, make_ref(), [%{id: 1}], [])

      for {old, new} <- [{false, true}, {true, false}] do
        sent =
          sent(%{
            name: "T",
            id: "same",
            diff: new,
            users: stream,
            __changed__: %{diff: old}
          })

        refute Enum.any?(sent, &String.contains?(&1, "/users"))
      end
    end

    test "sends the diff and does not resend the props snapshot" do
      socket = %Phoenix.LiveView.Socket{transport_pid: self()}

      sent = sent(updated_assigns(%{socket: socket}))

      assert Enum.any?(sent, &patch_for_items?/1)
      refute Enum.any?(sent, &snapshot?/1)
    end

    test "sends the diff even when the call site does not pass socket" do
      # Regression: `dead` used to be true whenever `socket` was absent, which
      # forced the full-props branch forever. `data-props` was resent carrying
      # only the *changed* keys while `data-props-diff` was never marked
      # changed, so a client in diff mode never saw another update.
      sent = sent(updated_assigns(%{}))

      assert Enum.any?(sent, &patch_for_items?/1)
      refute Enum.any?(sent, &snapshot?/1)
    end
  end

  describe "first render" do
    test "sends the full props snapshot, with or without a socket" do
      for extra <- [%{}, %{socket: nil}] do
        assigns = Map.merge(extra, %{name: "T", items: [%{id: 1}], __changed__: nil})

        sent = sent(assigns)

        assert Enum.any?(sent, &snapshot?/1)
        refute Enum.any?(sent, &patch_for_items?/1)
      end
    end
  end
end
