import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  const baseFetch = input.fetch ?? globalThis.fetch
  // opencode server 的 InstanceHttpApi 挂载在 root（/project/*），
  // 而 vendored client 1.17 仍请求 /api/project/*：改写路径以匹配当前 server。
  const compatFetch = ((
    request: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      typeof request === "string" ? request : request instanceof URL ? request.href : request.url,
    )
    if (url.pathname.startsWith("/api/project")) {
      url.pathname = url.pathname.replace(/^\/api/, "")
    }
    const nextRequest: RequestInfo =
      typeof request === "string"
        ? url.toString()
        : request instanceof URL
          ? new Request(url.toString(), init)
          : new Request(url.toString(), request)
    return baseFetch(nextRequest, init)
  }) as typeof globalThis.fetch
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: compatFetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
}

export type ServerApi = OpenCodeClient
