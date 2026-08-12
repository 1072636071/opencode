import { describe, expect, test } from "bun:test"
import { createApiForServer, createSdkForServer } from "./server"
import { createCompatibleApi, toV2PromptInput } from "./server-compat"

function setup(
  protocol: "v1" | "v2" | Promise<"v1" | "v2">,
  responses?: { vcs?: { branch: string; default_branch: string } },
) {
  const requests: Request[] = []
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.method === "PATCH") {
        return Response.json({
          id: "ses_1",
          slug: "ses_1",
          projectID: "project",
          directory: "/repo",
          title: "Session",
          version: "1",
          time: { created: 1, updated: 1 },
        })
      }
      if (request.method === "POST" && request.url.endsWith("/prompt_async"))
        return new Response(undefined, { status: 204 })
      if (
        request.method === "POST" &&
        new URL(request.url).pathname.startsWith("/api/session/") &&
        request.url.endsWith("/prompt")
      ) {
        // v2 prompt route — response body is { data: SessionInputAdmitted }
        return Response.json({
          data: {
            admittedSeq: 1,
            id: "msg_1",
            sessionID: "ses_1",
            prompt: { text: "hello" },
            delivery: "steer",
            timeCreated: 1,
          },
        })
      }
      if (request.method === "POST" && request.url.endsWith("/prompt")) {
        return Response.json({
          admittedSeq: 1,
          id: "msg_1",
          sessionID: "ses_1",
          timeCreated: 1,
          type: "user",
          data: { text: "hello" },
          delivery: "steer",
        })
      }
      if (request.method === "GET" && new URL(request.url).pathname === "/vcs")
        return Response.json(responses?.vcs ?? {})
      if (request.method === "GET") return Response.json([])
      return new Response(undefined, { status: 204 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const server = { url: "http://localhost:4096" }
  const api = createCompatibleApi({
    protocol: typeof protocol === "string" ? Promise.resolve(protocol) : protocol,
    current: createApiForServer({ server, fetch: fetcher }),
    legacy: (directory) => createSdkForServer({ server, fetch: fetcher, directory, throwOnError: true }),
    directory: "/repo",
  })
  return { api, requests }
}

describe("createCompatibleApi", () => {
  /*
  test("routes V1 archive through the legacy session update", async () => {
    const { api, requests } = setup("v1")
    await api.session.archive({ sessionID: "ses_1", directory: "/repo" })

    const url = new URL(requests[0]!.url)
    expect(url.pathname).toBe("/session/ses_1")
    expect(requests[0]!.headers.get("x-opencode-directory")).toBe("%2Frepo")
    expect(requests[0]!.method).toBe("PATCH")
    expect(await requests[0]!.json()).toMatchObject({ time: { archived: expect.any(Number) } })
  })
  */

  test("converts current prompts to the V1 prompt contract", async () => {
    const { api, requests } = setup("v1")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "hello @src/index.ts",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      files: [
        { uri: "file:///repo/src/index.ts", name: "index.ts", mention: { text: "@src/index.ts", start: 6, end: 19 } },
        { uri: "data:text/plain;base64,aGVsbG8=", name: "notes.txt" },
      ],
    })

    expect(new URL(requests[0]!.url).pathname).toBe("/session/ses_1/prompt_async")
    const body = await requests[0]!.json()
    expect(body).toMatchObject({
      messageID: "msg_1",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      parts: [
        { type: "text", text: "hello @src/index.ts" },
        {
          type: "file",
          mime: "text/plain",
          url: "file:///repo/src/index.ts",
          filename: "index.ts",
          source: {
            type: "file",
            text: { value: "@src/index.ts", start: 6, end: 19 },
            path: "file:///repo/src/index.ts",
          },
        },
        {
          type: "file",
          mime: "text/plain",
          url: "data:text/plain;base64,aGVsbG8=",
          filename: "notes.txt",
        },
      ],
    })
    expect(body.parts[2]).not.toHaveProperty("source")
  })

  test("preserves original parts for V1 optimistic reconciliation", async () => {
    const { api, requests } = setup("v1")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "look",
      files: [{ uri: "data:image/png;base64,AAAA", name: "image.png" }],
      legacyParts: [
        { id: "prt_text", type: "text", text: "look" },
        { id: "prt_image", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "image.png" },
      ],
    })

    expect((await requests[0]!.json()).parts).toEqual([
      { id: "prt_text", type: "text", text: "look" },
      { id: "prt_image", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "image.png" },
    ])
  })

  test("resolves protocol detection once across implementation methods", async () => {
    let detections = 0
    const resolved = Promise.resolve<"v1" | "v2">("v2")
    const protocol = new Proxy(resolved, {
      get(target, property) {
        if (property !== "then") return Reflect.get(target, property, target)
        detections++
        return target.then.bind(target)
      },
    })
    const { api } = setup(protocol)

    await api.session.list()
    await api.session.list()

    expect(detections).toBe(1)
  })

  /*
  test("keeps V2 session actions on the current API", async () => {
    const { api, requests } = setup("v2")
    await api.session.archive({ sessionID: "ses_1" })

    expect(new URL(requests[0]!.url).pathname).toBe("/api/session/ses_1/archive")
    expect(requests[0]!.method).toBe("POST")
  })
  */

  test("uses the global V1 session search endpoint", async () => {
    const { api, requests } = setup("v1")
    await api.session.list({ parentID: null, search: "session", limit: 50 })

    expect(new URL(requests[0]!.url).pathname).toBe("/experimental/session")
  })

  /*
  test("projects the V1 default branch", async () => {
    const { api } = setup("v1", { vcs: { branch: "feature", default_branch: "dev" } })

    expect(await api.vcs.get({ location: { directory: "/repo" } })).toMatchObject({
      data: { branch: "feature", defaultBranch: "dev" },
    })
  })
  */

  test("translates current file searches to the V1 dirs parameter", async () => {
    const { api, requests } = setup("v1")
    await api.file.find({ location: { directory: "/repo" }, query: "src", type: "file", limit: 20 })

    const url = new URL(requests[0]!.url)
    expect(url.pathname).toBe("/find/file")
    expect(url.searchParams.get("dirs")).toBe("false")
    expect(url.searchParams.get("limit")).toBe("20")
  })

  test("routes V1 permission replies through the requested directory", async () => {
    const { api, requests } = setup("v1")
    await api.permission.reply({
      sessionID: "ses_1",
      requestID: "permission_1",
      reply: "once",
      location: { directory: "/other" },
    })

    expect(new URL(requests[0]!.url).pathname).toBe("/session/ses_1/permissions/permission_1")
    expect(new URL(requests[0]!.url).searchParams.get("directory")).toBe("/other")
  })

  test("disposes the V1 instance after connecting a provider", async () => {
    const { api, requests } = setup("v1")

    await api.integration.connect.key({
      integrationID: "openrouter",
      key: "secret",
      location: { directory: "/repo" },
    })

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/auth/openrouter",
      "/instance/dispose",
      "/instance/dispose",
    ])
    expect(requests[1]!.headers.get("x-opencode-directory")).toBe("%2Frepo")
    expect(requests[2]!.headers.get("x-opencode-directory")).toBeNull()
  })

  test("disposes the V1 instance after completing provider OAuth", async () => {
    const { api, requests } = setup("v1")

    await api.integration.oauth.complete({
      integrationID: "openrouter",
      attemptID: "openrouter:0",
      code: "code",
      location: { directory: "/repo" },
    })

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/provider/openrouter/oauth/callback",
      "/instance/dispose",
      "/instance/dispose",
    ])
    expect(requests[1]!.headers.get("x-opencode-directory")).toBe("%2Frepo")
    expect(requests[2]!.headers.get("x-opencode-directory")).toBeNull()
  })

  test("converts current prompts to the V2 prompt contract", async () => {
    const { api, requests } = setup("v2")
    const result = await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "hello @src/index.ts",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      files: [
        { uri: "file:///repo/src/index.ts", name: "index.ts", mention: { text: "@src/index.ts", start: 6, end: 19 } },
        { uri: "data:text/plain;base64,aGVsbG8=", name: "notes.txt" },
      ],
      agents: [{ name: "reviewer", mention: { text: "@reviewer", start: 0, end: 9 } }],
      delivery: "steer",
    })

    expect(new URL(requests[0]!.url).pathname).toBe("/api/session/ses_1/prompt")
    const body = await requests[0]!.json()
    expect(body).toMatchObject({
      id: "msg_1",
      prompt: {
        text: "hello @src/index.ts",
        files: [
          {
            uri: "file:///repo/src/index.ts",
            name: "index.ts",
            source: { start: 6, end: 19, text: "@src/index.ts" },
          },
          { uri: "data:text/plain;base64,aGVsbG8=", name: "notes.txt" },
        ],
        agents: [{ name: "reviewer", source: { start: 0, end: 9, text: "@reviewer" } }],
      },
      delivery: "steer",
    })
    // v2 prompt body must NOT carry v1-style `parts` or top-level `text/files/agents`
    expect(body).not.toHaveProperty("parts")
    expect(body).not.toHaveProperty("text")
    expect(body).not.toHaveProperty("files")
    expect(body).not.toHaveProperty("agents")
    // response is mapped back to SessionPromptOutput shape
    expect(result).toMatchObject({
      admittedSeq: 1,
      id: "msg_1",
      sessionID: "ses_1",
      timeCreated: 1,
      type: "user",
      data: { text: "hello @src/index.ts" },
      delivery: "steer",
    })
  })

  test("maps legacyParts back to V2 prompt fields when provided", async () => {
    const { api, requests } = setup("v2")
    const result = await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "look",
      legacyParts: [
        { id: "prt_text", type: "text", text: "look at this" },
        {
          id: "prt_file",
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,AAAA",
          filename: "image.png",
          source: { type: "file", text: { value: "@image.png", start: 5, end: 14 }, path: "data:image/png;base64,AAAA" },
        },
        {
          id: "prt_agent",
          type: "agent",
          name: "coder",
          source: { value: "@coder", start: 0, end: 6 },
        },
      ],
    })

    expect(new URL(requests[0]!.url).pathname).toBe("/api/session/ses_1/prompt")
    const body = await requests[0]!.json()
    expect(body.prompt).toEqual({
      text: "look at this",
      files: [
        {
          uri: "data:image/png;base64,AAAA",
          name: "image.png",
          source: { start: 5, end: 14, text: "@image.png" },
        },
      ],
      agents: [{ name: "coder", source: { start: 0, end: 6, text: "@coder" } }],
    })
    // legacyParts must NOT be passed through
    expect(body).not.toHaveProperty("parts")
    expect(body).not.toHaveProperty("legacyParts")
    // returned data.text must reflect the actual prompt text (from legacyParts), not value.text
    expect(result.data.text).toBe("look at this")
  })
})

describe("toV2PromptInput", () => {
  test("maps plain text to prompt.text", () => {
    const result = toV2PromptInput({
      sessionID: "ses_1",
      text: "hello world",
    })
    expect(result).toEqual({
      sessionID: "ses_1",
      prompt: { text: "hello world" },
    })
    expect(result).not.toHaveProperty("id")
    expect(result).not.toHaveProperty("delivery")
    expect(result).not.toHaveProperty("resume")
  })

  test("maps files with mention to prompt.files[].source", () => {
    const result = toV2PromptInput({
      sessionID: "ses_1",
      text: "hello",
      files: [
        { uri: "file:///repo/src/index.ts", name: "index.ts", mention: { text: "@src/index.ts", start: 6, end: 19 } },
        { uri: "data:text/plain;base64,aGVsbG8=", name: "notes.txt" },
      ],
    })
    expect(result.prompt.files).toEqual([
      { uri: "file:///repo/src/index.ts", name: "index.ts", source: { start: 6, end: 19, text: "@src/index.ts" } },
      { uri: "data:text/plain;base64,aGVsbG8=", name: "notes.txt" },
    ])
  })

  test("maps agents with mention to prompt.agents[].source", () => {
    const result = toV2PromptInput({
      sessionID: "ses_1",
      text: "hello",
      agents: [{ name: "reviewer" }, { name: "coder", mention: { text: "@coder", start: 0, end: 6 } }],
    })
    expect(result.prompt.agents).toEqual([
      { name: "reviewer" },
      { name: "coder", source: { start: 0, end: 6, text: "@coder" } },
    ])
  })

  test("maps legacyParts back to v2 fields, ignoring top-level text/files/agents", () => {
    const result = toV2PromptInput({
      sessionID: "ses_1",
      id: "msg_1",
      text: "ignored-when-legacyParts-present",
      delivery: "queue",
      resume: true,
      legacyParts: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
        {
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,AAAA",
          filename: "image.png",
          source: { type: "file", text: { value: "@img", start: 0, end: 4 }, path: "data:image/png;base64,AAAA" },
        },
        { type: "agent", name: "coder", source: { value: "@coder", start: 0, end: 6 } },
      ],
      // these should be ignored because legacyParts takes precedence
      files: [{ uri: "file:///should-be-ignored", name: "ignored.ts" }],
      agents: [{ name: "ignored-agent" }],
    })
    expect(result.prompt).toEqual({
      text: "first\nsecond",
      files: [{ uri: "data:image/png;base64,AAAA", name: "image.png", source: { start: 0, end: 4, text: "@img" } }],
      agents: [{ name: "coder", source: { start: 0, end: 6, text: "@coder" } }],
    })
    expect(result.id).toBe("msg_1")
    expect(result.delivery).toBe("queue")
    expect(result.resume).toBe(true)
  })

  test("handles empty values without crashing", () => {
    const result = toV2PromptInput({
      sessionID: "ses_1",
      text: "",
    })
    expect(result.prompt).toEqual({ text: "" })
    expect(result.prompt).not.toHaveProperty("files")
    expect(result.prompt).not.toHaveProperty("agents")
  })

  test("omits optional fields when not provided", () => {
    const result = toV2PromptInput({
      sessionID: "ses_1",
      text: "hello",
    })
    expect(result).not.toHaveProperty("id")
    expect(result).not.toHaveProperty("delivery")
    expect(result).not.toHaveProperty("resume")
    expect(result.prompt).not.toHaveProperty("files")
    expect(result.prompt).not.toHaveProperty("agents")
  })

  test("passes through id, delivery, resume when provided", () => {
    const result = toV2PromptInput({
      sessionID: "ses_1",
      id: "msg_42",
      text: "hello",
      delivery: "queue",
      resume: false,
    })
    expect(result.id).toBe("msg_42")
    expect(result.delivery).toBe("queue")
    expect(result.resume).toBe(false)
  })
})
