defmodule LiveReact.SSR.ViteJS do
  @moduledoc """
  Implements SSR by making a POST request to `http://{:vite_host}/ssr_render`.

  `ssr_render` is implemented as a Vite plugin. You have to add it to the `vite.config.js` plugins section.

  ```javascript
  import liveReactPlugin from "live_react/vite-plugin";

  {
    publicDir: "static",
    plugins: [react(), liveReactPlugin()],
    // ...
  }
  ```
  """

  @behaviour LiveReact.SSR

  def render(name, props, slots) do
    data = Jason.encode!(%{name: name, props: props, slots: slots})
    url = vite_path(Application.get_env(:live_react, :vite_ssr_path, "/ssr_render"))
    params = {String.to_charlist(url), [], ~c"application/json", data}
    timeout = Application.get_env(:live_react, :vite_ssr_timeout, 30_000)

    case :httpc.request(:post, params, [timeout: timeout, connect_timeout: timeout], []) do
      {:ok, {{_, 200, _}, _headers, body}} ->
        :erlang.list_to_binary(body)

      {:ok, {{_, 500, _}, _headers, body}} ->
        parse_error(body)

      {:ok, {{_, status, code}, _headers, _body}} ->
        {:error, "Unexpected Vite SSR response: #{status} #{code}"}

      {:error, {:failed_connect, [{:to_address, {url, port}}, {_, _, code}]}} ->
        {:error, "Unable to connect to Vite #{url}:#{port}: #{code}"}

      {:error, :timeout} ->
        {:error, "Vite SSR request timed out after #{timeout}ms"}

      {:error, reason} ->
        {:error, "Vite SSR request failed: #{inspect(reason)}"}
    end
  end

  defp parse_error(body) do
    case Jason.decode(body) do
      {:ok, %{"error" => %{"message" => msg} = error}} when is_binary(msg) ->
        location =
          case error["loc"] do
            %{"file" => file, "line" => line, "column" => column} ->
              "#{file}:#{line}:#{column}"

            _ ->
              nil
          end

        {:error, [msg, location, error["frame"]] |> Enum.filter(&is_binary/1) |> Enum.join("\n")}

      _ ->
        {:error, "Unexpected Vite SSR response: 500 #{body}"}
    end
  end

  @doc """
  A handy utility returning path relative to Vite JS host.
  """
  def vite_path(path) do
    case Application.get_env(:live_react, :vite_host) do
      nil ->
        message = """
        Vite.js host is not configured. Please add the following to config/dev.ex

        config :live_react, vite_host: "http://localhost:5173"

        and ensure vite.js is running
        """

        raise %LiveReact.SSR.NotConfigured{message: message}

      host ->
        # we get rid of assets prefix since for vite /assets is root
        Path.join(host, path)
    end
  end
end
