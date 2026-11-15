defmodule LiveReactSSRViteJSTest do
  use ExUnit.Case

  setup do
    {:ok, _} = Application.ensure_all_started(:inets)

    for key <- [:vite_host, :vite_ssr_path, :vite_ssr_timeout] do
      previous = Application.fetch_env(:live_react, key)

      on_exit(fn ->
        case previous do
          {:ok, value} -> Application.put_env(:live_react, key, value)
          :error -> Application.delete_env(:live_react, key)
        end
      end)
    end

    :ok
  end

  defp render_with_error(error) do
    {:ok, listener} =
      :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}, reuseaddr: true])

    {:ok, port} = :inet.port(listener)
    Application.put_env(:live_react, :vite_host, "http://127.0.0.1:#{port}")

    server =
      Task.async(fn ->
        {:ok, socket} = :gen_tcp.accept(listener)
        {:ok, _request} = :gen_tcp.recv(socket, 0)
        body = Jason.encode!(%{error: error})

        :ok =
          :gen_tcp.send(
            socket,
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: #{byte_size(body)}\r\nConnection: close\r\n\r\n#{body}"
          )

        :gen_tcp.close(socket)
        :gen_tcp.close(listener)
      end)

    result = LiveReact.SSR.ViteJS.render("Example", %{}, %{})
    Task.await(server)
    result
  end

  test "returns an error message without requiring a source location" do
    assert {:error, "Broken JSX component"} =
             render_with_error(%{message: "Broken JSX component"})
  end

  test "returns the source location and frame when present" do
    error = %{
      message: "Syntax error",
      loc: %{file: "view.jsx", line: 2, column: 3},
      frame: "bad code"
    }

    assert {:error, "Syntax error\nview.jsx:2:3\nbad code"} = render_with_error(error)
  end

  test "sends requests to the configured SSR path" do
    {:ok, listener} =
      :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}, reuseaddr: true])

    {:ok, port} = :inet.port(listener)
    Application.put_env(:live_react, :vite_host, "http://127.0.0.1:#{port}")
    Application.put_env(:live_react, :vite_ssr_path, "/custom-render")

    server =
      Task.async(fn ->
        {:ok, socket} = :gen_tcp.accept(listener)
        {:ok, request} = :gen_tcp.recv(socket, 0)

        :gen_tcp.send(
          socket,
          "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
        )

        :gen_tcp.close(socket)
        :gen_tcp.close(listener)
        request
      end)

    assert LiveReact.SSR.ViteJS.render("Example", %{}, %{}) == "ok"
    assert Task.await(server) =~ "POST /custom-render HTTP/1.1"
  end

  test "times out when Vite accepts a request without responding" do
    {:ok, listener} =
      :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}, reuseaddr: true])

    {:ok, port} = :inet.port(listener)
    Application.put_env(:live_react, :vite_host, "http://127.0.0.1:#{port}")
    Application.put_env(:live_react, :vite_ssr_timeout, 200)

    server =
      Task.async(fn ->
        {:ok, socket} = :gen_tcp.accept(listener)
        {:ok, _request} = :gen_tcp.recv(socket, 0)
        Process.sleep(400)
        :gen_tcp.close(socket)
        :gen_tcp.close(listener)
      end)

    assert {:error, "Vite SSR request timed out after 200ms"} =
             LiveReact.SSR.ViteJS.render("Example", %{}, %{})

    Task.await(server)
  end
end
