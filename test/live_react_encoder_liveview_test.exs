defmodule LiveReact.Encoder.LiveViewTest do
  use ExUnit.Case

  alias LiveReact.Encoder
  alias Phoenix.LiveView.AsyncResult
  alias Phoenix.LiveView.UploadConfig

  describe "AsyncResult" do
    test "encodes loading state" do
      result = AsyncResult.loading()
      encoded = Encoder.encode(result, [])

      assert encoded.ok == false
      assert encoded.loading == true
      assert encoded.result == nil
    end

    test "encodes successful state" do
      result = AsyncResult.loading() |> AsyncResult.ok("value")
      encoded = Encoder.encode(result, [])

      assert encoded.ok == true
      assert encoded.result == "value"
    end

    test "encodes failed state" do
      result = AsyncResult.loading() |> AsyncResult.failed({:error, "boom"})
      encoded = Encoder.encode(result, [])

      assert encoded.ok == false
      assert encoded.failed == "boom"
    end

    test "preserves structured JSON error details and hides non-JSON terms" do
      reason = %{code: "offline", retryable: false, details: ["network"]}
      result = AsyncResult.loading() |> AsyncResult.failed({:error, reason})
      assert Encoder.encode(result, []).failed == reason

      result = AsyncResult.loading() |> AsyncResult.failed(reason)
      assert Encoder.encode(result, []).failed == reason

      result =
        AsyncResult.loading() |> AsyncResult.failed({:error, %{reason: {:private, "secret"}}})

      assert Encoder.encode(result, []).failed == "async operation failed"
    end

    test "renders complex async failures without leaking internal details" do
      result = AsyncResult.loading() |> AsyncResult.failed({:exit, {:badmatch, "private"}})

      html =
        LiveReact.react(%{name: "Demo", result: result, __changed__: nil, ssr: false})
        |> Phoenix.HTML.Safe.to_iodata()
        |> IO.iodata_to_binary()

      assert LiveReact.Test.get_react(html).props["result"]["failed"] == "async operation failed"
      refute html =~ "private"
    end

    test "does not expose task exit reasons in rendered props" do
      for reason <- ["api-token-PRIVATE", :private_exit, {:error, "PRIVATE"}] do
        result = AsyncResult.loading() |> AsyncResult.failed({:exit, reason})

        html =
          LiveReact.react(%{name: "Demo", result: result, __changed__: nil, ssr: false})
          |> Phoenix.HTML.Safe.to_iodata()
          |> IO.iodata_to_binary()

        assert LiveReact.Test.get_react(html).props["result"]["failed"] ==
                 "async operation failed"

        refute html =~ "PRIVATE"
        refute html =~ "private_exit"
      end
    end
  end

  describe "UploadEntry / UploadConfig" do
    test "encodes an empty UploadConfig" do
      config = UploadConfig.build(:avatar, "ref123", accept: :any, max_entries: 1)
      encoded = Encoder.encode(config, [])

      assert encoded.ref
      assert encoded.name == :avatar
      assert encoded.entries == []
      assert encoded.errors == []
    end
  end
end
