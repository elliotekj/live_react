defmodule LiveReactStreamsDiffTest do
  use ExUnit.Case

  alias LiveReact.Test
  alias Phoenix.LiveView.LiveStream
  alias Phoenix.LiveView.Socket

  defp render_react_assigns(assigns) do
    rendered = LiveReact.react(assigns)
    html = rendered |> Phoenix.HTML.html_escape() |> Phoenix.HTML.safe_to_string()
    Test.get_react(html)
  end

  # `react/1` forces a full stream reset whenever the render is "dead" (no connected
  # socket), since the client has no prior state to patch against in that case. These
  # tests exercise incremental (non-initial) diffs, so they simulate a connected
  # LiveView socket to opt into the incremental code path instead of the dead/init one.
  defp connected_socket, do: %Socket{transport_pid: self()}

  defp assert_patches_equal(actual, expected) do
    actual_sorted = actual |> decode_patch() |> Enum.sort_by(&{&1["path"], &1["op"]})
    expected_sorted = Enum.sort_by(expected, &{&1["path"], &1["op"]})
    assert actual_sorted == expected_sorted
  end

  defp decode_patch(patch_list) do
    patch_list
    |> Enum.map(fn
      [op, path] -> %{"op" => op, "path" => path}
      [op, path, value] -> %{"op" => op, "path" => path, "value" => value}
    end)
    |> Enum.reject(&(&1["op"] == "test"))
  end

  defmodule StreamUser do
    @moduledoc false
    @derive LiveReact.Encoder
    defstruct [:id, :name, :age]
  end

  defmodule CaptureSSR do
    def render(_name, props, _slots) do
      send(self(), {:ssr_props, props})
      "<div>ok</div>"
    end
  end

  defmodule CountedItem do
    defstruct [:id]
  end

  defimpl LiveReact.Encoder, for: CountedItem do
    def encode(item, _opts) do
      count = Process.get(:stream_encoding_count, 0) + 1
      Process.put(:stream_encoding_count, count)
      %{id: item.id, token: count}
    end
  end

  test "server and browser receive the same encoded stream item" do
    previous = Application.get_env(:live_react, :ssr_module)
    Application.put_env(:live_react, :ssr_module, CaptureSSR)
    on_exit(fn -> Application.put_env(:live_react, :ssr_module, previous) end)
    Process.put(:stream_encoding_count, 0)

    stream = LiveStream.new(:users, make_ref(), [%CountedItem{id: 1}], [])
    react = render_react_assigns(%{name: "List", users: stream, __changed__: nil})

    assert_received {:ssr_props, %{users: [%{token: token}]}}

    assert ["upsert", "/users/-", %{"token" => ^token}] =
             Enum.find(react.streams_diff, &match?(["upsert", _, _], &1))

    assert Process.get(:stream_encoding_count) == 1
  end

  test "server rendering receives the same initial stream data as the browser" do
    previous = Application.get_env(:live_react, :ssr_module)
    Application.put_env(:live_react, :ssr_module, CaptureSSR)
    on_exit(fn -> Application.put_env(:live_react, :ssr_module, previous) end)

    stream = LiveStream.new(:users, make_ref(), [%{id: 1}, %{id: 2}, %{id: 3}], [])
    stream = LiveStream.insert_item(stream, %{id: 4}, 0, -3, false)
    stream = LiveStream.insert_item(stream, %{id: 2, changed: true}, -1, nil, false)
    stream = LiveStream.insert_item(stream, %{id: 9}, -1, nil, true)

    react = render_react_assigns(%{name: "List", users: stream, __changed__: nil})
    assert_received {:ssr_props, %{users: users}}

    assert Enum.map(users, & &1.id) == [4, 1, 3, 2]
    assert Enum.at(users, 3).changed
    assert ["limit", "/users", -3] in react.streams_diff
  end

  test "deduplicates repeated stream inserts like Phoenix on initial render" do
    previous = Application.get_env(:live_react, :ssr_module)
    Application.put_env(:live_react, :ssr_module, CaptureSSR)
    on_exit(fn -> Application.put_env(:live_react, :ssr_module, previous) end)

    stream = LiveStream.new(:users, make_ref(), [%{id: 1}, %{id: 2}], [])
    stream = LiveStream.insert_item(stream, %{id: 1, updated: true}, -1, nil, false)
    react = render_react_assigns(%{name: "List", users: stream, __changed__: nil})

    assert_received {:ssr_props, %{users: users}}
    assert Enum.map(users, & &1.id) == [2, 1]
    assert List.last(users).updated

    assert [
             ["replace", "/users", []],
             ["upsert", "/users/-", %{"id" => 2}],
             ["upsert", "/users/-", %{"id" => 1, "updated" => true}]
           ] = react.streams_diff
  end

  test "uses the latest item and earliest insertion options on incremental reset" do
    stream = LiveStream.new(:users, make_ref(), [], [])
    stream = stream |> LiveStream.prune() |> LiveStream.reset()
    stream = LiveStream.insert_item(stream, %{id: 1, version: 1}, -1, 1, false)
    stream = LiveStream.insert_item(stream, %{id: 2}, -1, nil, false)
    stream = LiveStream.insert_item(stream, %{id: 1, version: 2}, 0, -2, false)
    react = render_react_assigns(%{users: stream, __changed__: %{users: true}, ssr: false})

    assert [
             ["replace", "/users", []],
             ["upsert", "/users/-", %{"id" => 2}],
             ["upsert", "/users/-", %{"id" => 1, "version" => 2}],
             ["limit", "/users", %{"on_insert" => "users-1"}],
             ["limit", "/users", 1]
           ] = react.streams_diff
  end

  test "initial SSR and wire both use the earliest options for duplicate inserts" do
    previous = Application.get_env(:live_react, :ssr_module)
    Application.put_env(:live_react, :ssr_module, CaptureSSR)
    on_exit(fn -> Application.put_env(:live_react, :ssr_module, previous) end)

    stream = LiveStream.new(:users, make_ref(), [], [])
    stream = LiveStream.insert_item(stream, %{id: 1, version: 1}, -1, 1, false)
    stream = LiveStream.insert_item(stream, %{id: 2}, -1, nil, false)
    stream = LiveStream.insert_item(stream, %{id: 1, version: 2}, 0, -2, false)
    react = render_react_assigns(%{name: "List", users: stream, __changed__: nil})

    assert_received {:ssr_props, %{users: [%{id: 2}]}}

    assert [
             ["replace", "/users", []],
             ["upsert", "/users/-", %{"id" => 2}],
             ["upsert", "/users/-", %{"id" => 1, "version" => 2}],
             ["limit", "/users", %{"on_insert" => "users-1"}],
             ["limit", "/users", 1]
           ] = react.streams_diff
  end

  test "escapes stream ids in update and removal paths" do
    stream = LiveStream.new(:users, make_ref(), [], dom_id: fn _ -> "a/~b" end)
    stream = LiveStream.delete_item(stream, %{id: 1})
    stream = LiveStream.insert_item(stream, %{id: 1}, -1, nil, true)
    react = render_react_assigns(%{users: stream, __changed__: %{users: true}, ssr: false})

    assert ["remove", "/users/$$a~1~0b"] in react.streams_diff
    assert Enum.any?(react.streams_diff, &match?(["replace", "/users/$$a~1~0b", _], &1))
  end

  test "escapes stream names in initial and incremental patches" do
    name = :"users/~active"
    stream = LiveStream.new(:users, make_ref(), [%{id: 1}], dom_id: fn _ -> "a/~b" end)
    initial = render_react_assigns(%{name => stream, :__changed__ => nil, :ssr => false})

    assert ["replace", "/users~1~0active", []] in initial.streams_diff
    assert Enum.any?(initial.streams_diff, &match?(["upsert", "/users~1~0active/-", _], &1))

    stream = stream |> LiveStream.prune() |> LiveStream.reset()
    stream = LiveStream.delete_item(stream, %{id: 1})
    stream = LiveStream.insert_item(stream, %{id: 1}, -1, -1, true)

    updated =
      render_react_assigns(%{name => stream, :__changed__ => %{name => true}, :ssr => false})

    assert ["replace", "/users~1~0active", []] in updated.streams_diff
    assert ["remove", "/users~1~0active/$$a~1~0b"] in updated.streams_diff

    assert Enum.any?(
             updated.streams_diff,
             &match?(["replace", "/users~1~0active/$$a~1~0b", _], &1)
           )

    refute Enum.any?(updated.streams_diff, &match?(["limit", _, _], &1))
  end

  test "does not apply a limit to an update-only stream operation" do
    previous = Application.get_env(:live_react, :ssr_module)
    Application.put_env(:live_react, :ssr_module, CaptureSSR)
    on_exit(fn -> Application.put_env(:live_react, :ssr_module, previous) end)

    stream = LiveStream.new(:users, make_ref(), [%{id: 1}, %{id: 2}], [])
    stream = LiveStream.insert_item(stream, %{id: 3}, -1, 1, true)
    initial = render_react_assigns(%{name: "List", users: stream, __changed__: nil})

    assert_received {:ssr_props, %{users: users}}
    assert Enum.map(users, & &1.id) == [1, 2]
    refute Enum.any?(initial.streams_diff, &match?(["limit", _, _], &1))

    stream = LiveStream.prune(stream)
    stream = LiveStream.insert_item(stream, %{id: 1, updated: true}, -1, 1, true)
    incremental = render_react_assigns(%{users: stream, __changed__: %{users: true}, ssr: false})

    assert [["replace", "/users/$$users-1", %{"id" => 1, "updated" => true}]] =
             incremental.streams_diff
  end

  describe "LiveStream diff functionality" do
    test "uses the actual stream ID when an item has a string ID key" do
      stream = LiveStream.new(:users, make_ref(), [%{:id => 1, "__dom_id" => "spoof"}], [])

      html =
        LiveReact.react(%{name: "List", users: stream, __changed__: nil, ssr: false})
        |> Phoenix.HTML.Safe.to_iodata()
        |> IO.iodata_to_binary()

      [payload] = html |> Floki.parse_fragment!() |> Floki.attribute("data-streams-diff")
      assert length(String.split(payload, "__dom_id")) == 2

      assert [_, ["upsert", "/users/-", %{"__dom_id" => "users-1", "id" => 1}]] =
               LiveReact.Patch.deserialize(payload)
    end

    test "wraps non-map stream items with their value and ID" do
      stream = LiveStream.new(:items, make_ref(), ["alpha", [1, 2]], dom_id: &inspect/1)
      react = render_react_assigns(%{name: "List", items: stream, __changed__: nil, ssr: false})

      assert [
               ["replace", "/items", []],
               ["upsert", "/items/-", %{"__dom_id" => "\"alpha\"", "value" => "alpha"}],
               ["upsert", "/items/-", %{"__dom_id" => "[1, 2]", "value" => [1, 2]}]
             ] = react.streams_diff
    end

    test "renders four-field stream inserts in their original order" do
      stream = LiveStream.new(:users, make_ref(), [%{id: 1}, %{id: 2}], [])

      stream = %{
        stream
        | inserts:
            Enum.map(stream.inserts, fn insert ->
              {elem(insert, 0), elem(insert, 1), elem(insert, 2), elem(insert, 3)}
            end)
      }

      react = render_react_assigns(%{name: "List", users: stream, __changed__: nil, ssr: false})

      assert [
               ["replace", "/users", []],
               ["upsert", "/users/-", %{"id" => 1}],
               ["upsert", "/users/-", %{"id" => 2}]
             ] = react.streams_diff
    end

    test "consecutive identical stream operations have different wire values" do
      stream = LiveStream.new(:users, make_ref(), [%{id: 1}], [])

      patches =
        for _ <- 1..2 do
          :rand.seed(:exsss, {17, 31, 42})

          LiveReact.react(%{name: "List", users: stream, __changed__: %{users: true}, ssr: false})
          |> Phoenix.HTML.Safe.to_iodata()
          |> IO.iodata_to_binary()
          |> Floki.parse_fragment!()
          |> Floki.attribute("data-streams-diff")
          |> List.first()
        end

      assert [first, second] = patches
      assert first != second
      assert LiveReact.Patch.deserialize(first) == LiveReact.Patch.deserialize(second)
    end

    test "initial render with LiveStream has stream diff in streams_diff" do
      users = [
        %StreamUser{id: 1, name: "Alice", age: 30},
        %StreamUser{id: 2, name: "Bob", age: 25}
      ]

      stream = LiveStream.new(:users, make_ref(), users, [])

      react = render_react_assigns(%{users: stream, __changed__: nil})

      expected_patches = [
        %{"op" => "replace", "path" => "/users", "value" => []},
        %{
          "op" => "upsert",
          "path" => "/users/-",
          "value" => %{"__dom_id" => "users-1", "age" => 30, "id" => 1, "name" => "Alice"}
        },
        %{
          "op" => "upsert",
          "path" => "/users/-",
          "value" => %{"__dom_id" => "users-2", "age" => 25, "id" => 2, "name" => "Bob"}
        }
      ]

      assert react.props == %{}
      assert_patches_equal(react.streams_diff, expected_patches)
    end

    test "inserting item to LiveStream creates upsert operation" do
      new_user = %StreamUser{id: 3, name: "Charlie", age: 28}
      stream = LiveStream.new(:users, make_ref(), [], [])
      stream = LiveStream.insert_item(stream, new_user, -1, nil, false)

      react =
        render_react_assigns(%{
          users: stream,
          socket: connected_socket(),
          __changed__: %{users: LiveStream.new(:users, make_ref(), [], [])}
        })

      assert_patches_equal(react.streams_diff, [
        %{
          "op" => "upsert",
          "path" => "/users/-",
          "value" => %{"id" => 3, "name" => "Charlie", "age" => 28, "__dom_id" => "users-3"}
        }
      ])
    end

    test "deleting item from LiveStream creates remove operation" do
      user_to_delete = %StreamUser{id: 2, name: "Bob", age: 25}
      stream = LiveStream.new(:users, make_ref(), [], [])
      stream = LiveStream.delete_item(stream, user_to_delete)

      react =
        render_react_assigns(%{
          users: stream,
          socket: connected_socket(),
          __changed__: %{users: LiveStream.new(:users, make_ref(), [], [])}
        })

      assert_patches_equal(react.streams_diff, [%{"op" => "remove", "path" => "/users/$$users-2"}])
    end

    test "resetting LiveStream creates replace operation" do
      stream = LiveStream.new(:users, make_ref(), [], [])
      stream = LiveStream.reset(stream)

      react =
        render_react_assigns(%{
          users: stream,
          socket: connected_socket(),
          __changed__: %{users: LiveStream.new(:users, make_ref(), [], [])}
        })

      assert_patches_equal(react.streams_diff, [
        %{"op" => "replace", "path" => "/users", "value" => []}
      ])
    end

    test "stream with limit sends an atomic limited upsert" do
      stream = LiveStream.new(:users, make_ref(), [], [])

      stream =
        LiveStream.insert_item(stream, %StreamUser{id: 1, name: "User", age: 1}, -1, 5, false)

      react =
        render_react_assigns(%{
          users: stream,
          socket: connected_socket(),
          __changed__: %{users: LiveStream.new(:users, make_ref(), [], [])}
        })

      decoded = decode_patch(react.streams_diff)

      assert [
               %{"op" => "upsert", "path" => "/users/-", "value" => %{"id" => 1}},
               %{"op" => "limit", "path" => "/users", "value" => %{"on_insert" => "users-1"}},
               %{"op" => "limit", "path" => "/users", "value" => 5}
             ] = decoded
    end

    test "stream insert with update_only flag creates replace operation" do
      stream = LiveStream.new(:users, make_ref(), [], [])

      stream =
        LiveStream.insert_item(stream, %StreamUser{id: 1, name: "Updated", age: 1}, -1, nil, true)

      react =
        render_react_assigns(%{
          users: stream,
          socket: connected_socket(),
          __changed__: %{users: LiveStream.new(:users, make_ref(), [], [])}
        })

      decoded = decode_patch(react.streams_diff)

      replace_op =
        Enum.find(decoded, &(&1["op"] == "replace" && String.contains?(&1["path"], "$$")))

      assert replace_op["value"]["name"] == "Updated"
    end

    test "LiveStream assigns do not appear in props" do
      stream = LiveStream.new(:users, make_ref(), [], [])

      react = render_react_assigns(%{users: stream, title: "Page", __changed__: nil})

      assert react.props == %{"title" => "Page"}
    end
  end
end
