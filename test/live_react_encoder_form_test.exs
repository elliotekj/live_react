defmodule LiveReact.EncoderFormTest do
  use ExUnit.Case

  import Ecto.Changeset
  import Phoenix.Component, only: [to_form: 2]

  alias LiveReact.Encoder
  alias Phoenix.HTML.FormData

  defp encode_form(source, attrs) do
    module = source.__struct__
    changeset = module.changeset(source, attrs)
    form = FormData.to_form(changeset, as: module.__schema__(:source))
    Encoder.encode(form, [])
  end

  defmodule Simple do
    @moduledoc false
    use Ecto.Schema

    import Ecto.Changeset

    @derive {Encoder, except: [:secret]}
    embedded_schema do
      field(:name, :string)
      field(:secret, :string)
      field(:age, :integer)
      field(:active, :boolean)
      field(:tags, {:array, :string})
      field(:score, :float)
    end

    def changeset(simple, attrs) do
      simple
      |> cast(attrs, [:name, :secret, :age, :active, :tags, :score])
      |> validate_required([:name])
      |> validate_number(:age, greater_than: 0)
      |> validate_number(:score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    end
  end

  defmodule Details do
    use Ecto.Schema
    @derive Encoder
    embedded_schema do
      field(:name, :string)
    end

    def changeset(details, attrs) do
      details |> Ecto.Changeset.cast(attrs, [:name]) |> Ecto.Changeset.validate_required([:name])
    end
  end

  defmodule Profile do
    use Ecto.Schema
    @derive Encoder
    embedded_schema do
      embeds_one(:details, Details, on_replace: :delete)
      embeds_many(:items, Details, on_replace: :delete)
    end
  end

  defmodule Post do
    use Ecto.Schema
    @derive {Encoder, except: [:secret]}
    schema "posts" do
      field(:title, :string)
      field(:secret, :string)
      belongs_to(:author, Author)
    end
  end

  defmodule Author do
    use Ecto.Schema
    @derive {Encoder, except: [:secret]}
    schema "authors" do
      field(:name, :string)
      field(:secret, :string)
      has_many(:posts, Post)
    end
  end

  describe "Phoenix.HTML.Form encoding — Ecto changeset backed" do
    test "represents unloaded associations as nil without exposing excluded fields" do
      author = %Author{name: "Ada", secret: "private"}
      encoded = author |> change() |> FormData.to_form(as: "author") |> Encoder.encode([])

      assert encoded.values.posts == nil
      refute Map.has_key?(encoded.values, :secret)
    end

    test "honors an explicit request not to nilify unloaded associations" do
      form = %Author{name: "Ada"} |> change() |> FormData.to_form(as: "author")

      assert_raise Protocol.UndefinedError, fn ->
        Encoder.encode(form, nilify_not_loaded: false)
      end
    end

    test "preserves loaded associations and nested unloaded values" do
      post = %Post{title: "Hello", secret: "private"}

      for {posts, expected} <- [{[], []}, {[post], [%{title: "Hello", author: nil}]}] do
        author = %Author{name: "Ada", posts: posts}
        encoded = author |> change() |> FormData.to_form(as: "author") |> Encoder.encode([])

        assert length(encoded.values.posts) == length(expected)

        Enum.zip(encoded.values.posts, expected)
        |> Enum.each(fn {value, fields} ->
          assert Map.take(value, Map.keys(fields)) == fields
          refute Map.has_key?(value, :secret)
        end)
      end
    end

    test "encodes an unchanged changeset with no params" do
      encoded =
        %Simple{name: "Ada"} |> change() |> FormData.to_form(as: "simple") |> Encoder.encode([])

      assert encoded.values.name == "Ada"
      assert encoded.valid
    end

    test "includes programmatically added embedded records" do
      changeset = %Profile{} |> change() |> put_embed(:items, [%Details{name: "Added"}])
      encoded = changeset |> FormData.to_form(as: "profile") |> Encoder.encode([])
      assert [%{name: "Added"}] = encoded.values.items
    end

    test "preserves unchanged embedded records" do
      profile = %Profile{items: [%Details{name: "Kept"}]}
      encoded = profile |> change() |> FormData.to_form(as: "profile") |> Encoder.encode([])
      assert [%{name: "Kept"}] = encoded.values.items
      assert encoded.errors == %{}
    end

    test "keeps nested errors aligned with retained items when removing an embedded record" do
      old_id = Ecto.UUID.generate()
      keep_id = Ecto.UUID.generate()

      profile = %Profile{
        items: [%Details{id: old_id, name: "Old"}, %Details{id: keep_id, name: "Keep"}]
      }

      invalid = %Details{id: keep_id, name: "Keep"} |> change() |> add_error(:name, "invalid")
      changeset = profile |> change() |> put_embed(:items, [invalid, %Details{name: "New"}])
      encoded = changeset |> FormData.to_form(as: "profile") |> Encoder.encode([])

      assert Enum.map(encoded.values.items, & &1.name) == ["Keep", "New"]
      assert encoded.errors == %{items: [%{name: ["invalid"]}, nil]}
      refute encoded.valid
    end

    test "encodes an explicitly removed embedded record" do
      profile = %Profile{details: %Details{name: "Ada"}}
      changeset = profile |> cast(%{"details" => nil}, []) |> cast_embed(:details)
      assert changeset.changes.details == nil

      encoded = changeset |> FormData.to_form(as: "profile") |> Encoder.encode([])
      assert encoded.values.details == nil
      assert encoded.errors == %{}
    end

    test "keeps errors for an invalid embedded record" do
      changeset = %Profile{} |> cast(%{"details" => %{"name" => ""}}, []) |> cast_embed(:details)
      encoded = changeset |> FormData.to_form(as: "profile") |> Encoder.encode([])
      assert encoded.errors == %{details: %{name: ["can't be blank"]}}
    end

    test "encodes form with simple values" do
      simple = %Simple{}

      attrs = %{
        name: "John",
        secret: "hidden_value",
        age: 30,
        active: true,
        tags: ["elixir", "phoenix"],
        score: 95.5
      }

      encoded = encode_form(simple, attrs)

      assert encoded == %{
               name: "simple",
               values: %{
                 id: nil,
                 name: "John",
                 age: 30,
                 active: true,
                 tags: ["elixir", "phoenix"],
                 score: 95.5
               },
               errors: %{},
               valid: true
             }
    end

    test "encodes form with validation errors" do
      simple = %Simple{}
      attrs = %{name: nil, age: -5, score: 150}
      encoded = encode_form(simple, attrs)

      assert encoded.name == "simple"
      assert encoded.valid == false

      assert encoded.values == %{
               id: nil,
               name: nil,
               age: -5,
               active: nil,
               tags: nil,
               score: 150
             }

      assert encoded.errors == %{
               name: ["can't be blank"],
               age: ["must be greater than 0"],
               score: ["must be less than or equal to 100"]
             }
    end

    test "preserves multiple errors on a changeset field" do
      changeset = %Simple{} |> change() |> add_error(:name, "first") |> add_error(:name, "second")
      encoded = changeset |> FormData.to_form(as: "simple") |> Encoder.encode([])
      assert encoded.errors.name == ["second", "first"]
    end
  end

  describe "Phoenix.HTML.Form encoding — plain map backed (no Ecto)" do
    test "marks a form with errors invalid" do
      form =
        to_form(%{"email" => "bad"},
          as: :user,
          errors: [email: {"invalid", []}],
          action: :validate
        )

      encoded = Encoder.encode(form, [])
      assert encoded.errors == %{email: ["invalid"]}
      refute encoded.valid
    end

    test "preserves multiple errors on a map field" do
      form =
        to_form(%{"email" => "bad"},
          as: :user,
          errors: [email: {"first", []}, email: {"second", []}],
          action: :validate
        )

      assert Encoder.encode(form, []).errors == %{email: ["first", "second"]}
    end

    test "encodes form backed by simple map data" do
      form_data = %{
        "name" => "John Doe",
        "email" => "john@example.com",
        "role" => "developer",
        "bio" => "Software engineer with 5 years experience",
        "notifications" => true
      }

      form = to_form(form_data, as: :user)
      encoded = Encoder.encode(form, [])

      assert encoded == %{
               name: "user",
               values: %{
                 "name" => "John Doe",
                 "email" => "john@example.com",
                 "role" => "developer",
                 "bio" => "Software engineer with 5 years experience",
                 "notifications" => true
               },
               errors: %{},
               valid: true
             }
    end

    test "encodes form with empty map data" do
      form_data = %{
        "name" => "",
        "email" => "",
        "role" => "",
        "bio" => "",
        "notifications" => false
      }

      form = to_form(form_data, as: :profile)
      encoded = Encoder.encode(form, [])

      assert encoded == %{
               name: "profile",
               values: %{
                 "name" => "",
                 "email" => "",
                 "role" => "",
                 "bio" => "",
                 "notifications" => false
               },
               errors: %{},
               valid: true
             }
    end
  end
end
