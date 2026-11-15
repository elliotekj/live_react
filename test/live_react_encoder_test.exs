defmodule LiveReact.EncoderTest do
  use ExUnit.Case

  alias LiveReact.Encoder

  defmodule Ambiguous do
    defstruct [:id]
  end

  defimpl LiveReact.Encoder, for: Ambiguous do
    def encode(_value, _opts), do: %{"x" => 1, :x => 2}
  end

  defp render(assigns) do
    assigns
    |> LiveReact.react()
    |> Phoenix.HTML.Safe.to_iodata()
    |> IO.iodata_to_binary()
  end

  test "rejects ambiguous JSON keys in snapshots and patches" do
    for bad <- [
          %{"x" => 1, :x => 2},
          %{"1" => 1, 1 => 2},
          %{"nil" => 1, nil => 2},
          %{"outer" => [%{"x" => 1, :x => 2}]}
        ] do
      assert_raise ArgumentError, ~r/ambiguous JSON object key/, fn ->
        render(%{name: "Demo", data: bad, __changed__: nil, ssr: false})
      end

      assert_raise ArgumentError, ~r/ambiguous JSON object key/, fn ->
        render(%{name: "Demo", data: bad, __changed__: %{data: %{}}, ssr: false})
      end
    end
  end

  test "keeps distinct JSON keys when an empty string and nil coexist" do
    html = render(%{name: "Demo", data: %{nil => 1, "" => 2}, __changed__: nil, ssr: false})
    assert LiveReact.Test.get_react(html).props["data"] == %{"nil" => 1, "" => 2}
  end

  test "rejects ambiguous keys returned by custom encoders in props and streams" do
    item = %Ambiguous{id: 1}

    assert_raise ArgumentError, ~r/ambiguous JSON object key/, fn ->
      render(%{name: "Demo", data: [item], __changed__: nil, ssr: false})
    end

    stream = Phoenix.LiveView.LiveStream.new(:items, make_ref(), [item], [])

    assert_raise ArgumentError, ~r/ambiguous JSON object key/, fn ->
      render(%{name: "Demo", items: stream, __changed__: nil, ssr: false})
    end
  end

  describe "primitive types" do
    test "encodes integers, floats, strings, booleans, nil, atoms" do
      assert Encoder.encode(42, []) == 42
      assert Encoder.encode(3.14, []) == 3.14
      assert Encoder.encode("hello", []) == "hello"
      assert Encoder.encode(true, []) == true
      assert Encoder.encode(false, []) == false
      assert Encoder.encode(nil, []) == nil
      assert Encoder.encode(:hello, []) == :hello
    end
  end

  describe "complex types" do
    test "encodes lists recursively" do
      assert Encoder.encode([1, [2, 3], 4], []) == [1, [2, 3], 4]
      assert Encoder.encode([], []) == []
    end

    test "encodes maps recursively" do
      nested = %{user: %{name: "John", age: 30}, items: [1, 2, 3]}
      assert Encoder.encode(nested, []) == nested
    end
  end

  defmodule TestUser do
    @moduledoc false
    @derive Encoder
    defstruct [:name, :age, :email]
  end

  defmodule TestAccount do
    @moduledoc false
    @derive Encoder
    defstruct [:user, :balance]
  end

  defmodule DerivedUserOnly do
    @moduledoc false
    @derive {Encoder, only: [:name, :age]}
    defstruct [:name, :age, :email, :password]
  end

  defmodule DerivedUserExcept do
    @moduledoc false
    @derive {Encoder, except: [:password]}
    defstruct [:name, :age, :email, :password]
  end

  defmodule NotDerivedUser do
    @moduledoc false
    defstruct [:name, :age, :email]
  end

  describe "structs" do
    test "encodes structs to maps without __struct__" do
      user = %TestUser{name: "John", age: 30, email: "john@example.com"}
      encoded = Encoder.encode(user, [])

      assert encoded == %{name: "John", age: 30, email: "john@example.com"}
      refute Map.has_key?(encoded, :__struct__)
    end

    test "encodes nested structs" do
      account = %TestAccount{
        user: %TestUser{name: "John", age: 30, email: "j@x.com"},
        balance: 1000
      }

      assert Encoder.encode(account, []) == %{
               user: %{name: "John", age: 30, email: "j@x.com"},
               balance: 1000
             }
    end

    test "encodes structs in lists and maps" do
      users = [%TestUser{name: "John", age: 30, email: "j@x.com"}]
      assert Encoder.encode(users, []) == [%{name: "John", age: 30, email: "j@x.com"}]

      assert Encoder.encode(%{admin: %TestUser{name: "Jane", age: 25, email: "ja@x.com"}}, []) ==
               %{admin: %{name: "Jane", age: 25, email: "ja@x.com"}}
    end
  end

  describe "deriving functionality" do
    test "derives encoder with only specified fields" do
      user = %DerivedUserOnly{name: "John", age: 30, email: "j@x.com", password: "secret"}
      assert Encoder.encode(user, []) == %{name: "John", age: 30}
    end

    test "derives encoder excluding specified fields" do
      user = %DerivedUserExcept{name: "John", age: 30, email: "j@x.com", password: "secret"}
      assert Encoder.encode(user, []) == %{name: "John", age: 30, email: "j@x.com"}
    end

    test "non-derived structs raise protocol error" do
      struct = %NotDerivedUser{name: "John", age: 30, email: "j@x.com"}

      assert_raise Protocol.UndefinedError,
                   ~r/LiveReact.Encoder protocol must always be explicitly implemented/,
                   fn ->
                     Encoder.encode(struct, [])
                   end
    end
  end

  describe "date and time types" do
    test "encodes date and time types as ISO8601 strings" do
      date = ~D[2023-01-01]
      naive_datetime = ~N[2023-01-01 12:00:00]
      datetime = DateTime.from_naive!(naive_datetime, "Etc/UTC")

      assert Encoder.encode(date, []) == Date.to_iso8601(date)
      assert Encoder.encode(naive_datetime, []) == NaiveDateTime.to_iso8601(naive_datetime)
      assert Encoder.encode(datetime, []) == DateTime.to_iso8601(datetime)
    end
  end
end
