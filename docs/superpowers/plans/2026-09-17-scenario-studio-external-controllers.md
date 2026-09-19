# Scenario Studio External Controllers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let independently managed Python and JavaScript services discover the active Scenario Studio session, subscribe to runtime data, and control multiple agents through a bounded local WebSocket/protobuf gateway.

**Architecture:** A backend-owned `ScenarioGateway` is the sole WebSocket broker. A browser `GatewayBridge` decorates the existing in-process middleware, mirrors advertisements and publications to the gateway, and admits validated external publications back into the local command channels. The standalone production entry point and Vite plugin both host the same gateway implementation; SDKs consume the same root-level protobuf contract.

**Tech Stack:** TypeScript 5.9, Vite 6, Node HTTP, `ws`, Protocol Buffers, browser WebSocket, Python 3, Playwright product verification

**Spec:** `docs/scenario-studio-design.md` — Milestone 6

## Global Constraints

- Keep every `.proto` source under the repository-root `protos/` directory.
- Bind the gateway to localhost by default; non-local binding requires an explicit host configuration.
- Use concrete protobuf messages for lifecycle, tick, agent state, capabilities, vehicle commands, and command status.
- Preserve topic, schema name, schema bytes, encoding, simulation timestamp, sequence, session ID, and run generation across the bridge.
- Coalesce controls and live state under pressure; never coalesce or silently drop lifecycle and command-status events.
- Reject malformed, oversized, unauthorized, unknown-channel, stale-session, stale-generation, and stale-target-step publications with a correlated diagnostic.
- Keep `ScenarioSession` browser-resident and do not spawn external controller processes.
- Every owner exposes idempotent cleanup; disconnect, Reset, scenario replacement, and application shutdown invalidate stale asynchronous work.
- Do not add unit tests. Verify behavior through the real gateway, SDK processes, built product, and existing product verification scripts.

---

### Task 1: Canonical protobuf contract and generated bindings

**Files:**
- Create: `protos/scenario_gateway.proto`
- Create: `scripts/generateScenarioGatewayBindings.mjs`
- Create: `src/scenario-studio/gateway/generated/scenario_gateway.ts`
- Create: `sdk/python/steerlab_scenario/scenario_gateway_pb2.py`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: protobuf messages `Envelope`, `ServerInfo`, `ChannelAdvertisement`, `Subscribe`, `Unsubscribe`, `Publish`, `Status`, `Lifecycle`, `Tick`, `AgentState`, `Capabilities`, `VehicleCommand`, and `CommandStatus`.
- Produces: generated TypeScript encode/decode bindings and generated Python message classes from the same `protos/scenario_gateway.proto` source.

- [ ] **Step 1: Add a failing binding verification command**

Create `scripts/generateScenarioGatewayBindings.mjs` so `--check` regenerates into a temporary directory and byte-compares both committed outputs. The command must exit nonzero while the proto and bindings are absent:

```js
const check = process.argv.includes("--check");
const proto = new URL("../protos/scenario_gateway.proto", import.meta.url);
if (check && !(await exists(proto))) throw new Error("Scenario gateway protobuf contract is missing.");
```

Add the script:

```json
"gateway:proto:check": "node scripts/generateScenarioGatewayBindings.mjs --check"
```

- [ ] **Step 2: Run the check and observe the intended failure**

Run: `npm run gateway:proto:check`

Expected: nonzero exit with `Scenario gateway protobuf contract is missing.`

- [ ] **Step 3: Define the wire contract in the root proto directory**

Define `package steerlab.gateway.v1;` and an `Envelope` `oneof` for control-plane frames and publications. `ChannelAdvertisement` carries numeric channel ID, topic, schema name, serialized `FileDescriptorSet`, and encoding. `Publish` carries channel ID, protobuf payload bytes, `SimulationTime`, sequence, session ID, and generation. `VehicleCommand` includes correlation ID, source, session ID, generation, target step, target agent ID, throttle, steering, and brake.

Use explicit enums for playback state, status severity, and status code. Reserve removed field numbers rather than reusing them.

- [ ] **Step 4: Generate deterministic TypeScript and Python bindings**

Install pinned generator/runtime dependencies, generate both committed outputs from `protos/scenario_gateway.proto`, and make generation deterministic. The generator must use an explicit proto path:

```js
const protoRoot = fileURLToPath(new URL("../protos", import.meta.url));
const protoFile = join(protoRoot, "scenario_gateway.proto");
```

- [ ] **Step 5: Verify generated output and the application build**

Run: `npm run gateway:proto:check && npm run build:check`

Expected: both commands exit zero and no generated file changes after the check.

### Task 2: Bounded backend gateway and reusable host

**Files:**
- Create: `server/scenarioStudio/gateway/GatewayPolicy.ts`
- Create: `server/scenarioStudio/gateway/ClientConnection.ts`
- Create: `server/scenarioStudio/gateway/ScenarioGateway.ts`
- Create: `server/scenarioStudio/gateway/createGatewayServer.ts`
- Create: `server/scenarioGatewayService.ts`
- Modify: `server/scenarioStudioPlugin.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: generated `Envelope` protobuf bindings from Task 1.
- Produces: `ScenarioGateway.attach(server: HttpServer): void`, `ScenarioGateway.status(): GatewayStatus`, and idempotent `ScenarioGateway.dispose(): Promise<void>`.
- Produces: `createGatewayServer(options: GatewayServerOptions): GatewayServer` used by both Vite and the production CLI.

- [ ] **Step 1: Add a failing real-socket gateway probe**

Create a `gateway:verify` mode in `scripts/verifyScenarioGateway.ts` that starts an ephemeral localhost HTTP server, attaches `ScenarioGateway`, connects a real WebSocket client, sends `ClientHello`, and expects `ServerInfo`. Initially fail with:

```ts
throw new Error("ScenarioGateway is not implemented.");
```

- [ ] **Step 2: Run the probe and observe the intended failure**

Run: `npx vite-node scripts/verifyScenarioGateway.ts`

Expected: nonzero exit containing `ScenarioGateway is not implemented.`

- [ ] **Step 3: Implement connection policy and client ownership**

`GatewayPolicy` validates exact allowed origins, optional bearer token, maximum binary frame bytes, maximum queued bytes, maximum queued frames, heartbeat timeout, and localhost defaults. `ClientConnection` owns one socket, subscriptions, queued frames, heartbeat, and cleanup.

Use two outbound lanes:

```ts
interface ClientQueues {
  readonly reliable: readonly Uint8Array[];
  readonly latestByChannel: ReadonlyMap<number, Uint8Array>;
}
```

Lifecycle, advertisements, unadvertisements, command status, and diagnostics enter `reliable`; ticks, agent states, and controls replace `latestByChannel[channelId]` when backpressured.

- [ ] **Step 4: Implement broker routing and stale-publication rejection**

`ScenarioGateway` assigns stable channel IDs for the active browser connection, relays advertisements to external clients, routes subscribed events, and accepts client publishing only on client-publishable control topics. It compares command session/generation to the current browser session before forwarding and emits a correlated `Status` on rejection.

When the browser disconnects, clear the active session and advertisements. When an external client disconnects, clear its subscriptions and queued frames. A reconnect starts with fresh subscriptions and receives a fresh discovery snapshot.

- [ ] **Step 5: Share one host between Vite and production**

Expose an HTTP upgrade hook from `createGatewayServer`. Attach it in `scenarioStudioPlugin.configureServer` and `configurePreviewServer`; close it from the plugin shutdown hook. Add a production script:

```json
"gateway:start": "vite-node server/scenarioGatewayService.ts"
```

The service reads `STEERLAB_GATEWAY_HOST`, `STEERLAB_GATEWAY_PORT`, `STEERLAB_GATEWAY_ORIGINS`, and `STEERLAB_GATEWAY_TOKEN`, with `127.0.0.1` and an ephemeral-safe explicit port default.

- [ ] **Step 6: Extend and pass the socket probe**

Verify origin rejection, authentication rejection, oversized-frame closure, reliable ordering, latest-value coalescing, unsubscribe, reconnect with no retained subscription, and idempotent disposal.

Run: `npx vite-node scripts/verifyScenarioGateway.ts`

Expected: zero exit with observations for every policy case.

### Task 3: Browser runtime-bus bridge

**Files:**
- Create: `src/scenario-studio/gateway/GatewayConnection.ts`
- Create: `src/scenario-studio/gateway/GatewayBridge.ts`
- Modify: `src/scenario-studio/runtime/Middleware.ts`
- Modify: `src/scenario-studio/runtime/messages.ts`
- Modify: `src/scenario-studio/domain/ScenarioSession.ts`
- Modify: `src/scenario-studio/ScenarioStudioApp.ts`

**Interfaces:**
- Consumes: `Middleware`, protobuf bindings, and gateway WebSocket endpoint.
- Produces: `GatewayBridge implements Middleware`, `GatewaySnapshot`, and `subscribeStatus(handler): Disposable`.
- Changes: `ScenarioSession` receives a `Middleware` dependency rather than constructing `InProcessMiddleware` internally.

- [ ] **Step 1: Extend the gateway probe with a failing browser-bridge path**

Start the built app and gateway, connect a browser page, and assert that `simulation/lifecycle`, `simulation/tick`, per-agent state/capabilities, and per-agent vehicle-control channels appear to an external client. The first run must fail because no browser bridge exists.

- [ ] **Step 2: Inject middleware ownership into `ScenarioSession`**

Change the constructor boundary to accept:

```ts
private readonly middleware: Middleware
```

Construct `new GatewayBridge(new InProcessMiddleware(), new GatewayConnection("/api/scenario-studio/gateway"))` in `ScenarioStudioApp` and retain ownership there. `ScenarioSession.dispose()` disposes its advertisements and components; the composition root disposes the bridge after session teardown.

- [ ] **Step 3: Mirror local advertisements and publications**

`GatewayBridge.advertise()` advertises locally first, then sends a protobuf advertisement including the schema descriptor. `publish()` publishes locally and forwards only accepted events with the exact sequence, timestamp, session, and generation produced by the in-process bus. Extend the middleware result so an accepted publish exposes the immutable `MessageEvent` required by the bridge.

- [ ] **Step 4: Admit external control messages through existing channels**

Decode only advertised, client-publishable `VehicleCommand` payloads. Convert them to `VehicleCommandMessage` and publish them to the existing vehicle channel so `VehicleComponent.applyCommand()` remains the single validation and command-status path. Do not create a gateway-specific physics command path.

- [ ] **Step 5: Implement reconnect and run invalidation**

Reconnect with bounded exponential delay while the application is alive. On reconnect, send a new browser hello plus the complete active advertisement set and current session identity. On Reset or a new run, the next `beginRun()` invalidates pending inbound messages from the prior generation before any command can reach a component.

- [ ] **Step 6: Pass the bridge probe and build**

Run: `npx vite-node scripts/verifyScenarioGateway.ts && npm run build:check`

Expected: discovery and round-trip control pass through a real socket, and the TypeScript/Vite build succeeds.

### Task 4: Python and external JavaScript SDKs

**Files:**
- Create: `sdk/python/pyproject.toml`
- Create: `sdk/python/steerlab_scenario/__init__.py`
- Create: `sdk/python/steerlab_scenario/client.py`
- Create: `sdk/python/examples/two_agent_controller.py`
- Create: `sdk/javascript/package.json`
- Create: `sdk/javascript/src/client.ts`
- Create: `sdk/javascript/src/index.ts`
- Create: `sdk/javascript/examples/two-agent-controller.mjs`
- Modify: `scripts/verifyScenarioGateway.ts`

**Interfaces:**
- Consumes: gateway protobuf contract and WebSocket endpoint.
- Produces: Python `ScenarioClient.connect()`, `channels()`, `subscribe(topic, handler)`, `publish_vehicle_command(...)`, and `close()`.
- Produces: equivalent external JavaScript `ScenarioClient` API.

- [ ] **Step 1: Add a failing external Python acceptance phase**

From `verifyScenarioGateway.ts`, spawn the example with an ephemeral gateway URL and token, capture newline-delimited observations, and require it to report two discovered vehicle-capable agents, tick/state subscriptions, and one independent command per agent. It must initially fail because the SDK is absent.

- [ ] **Step 2: Implement the Python client**

Own the socket, receive task, subscription handlers, discovery state, and reconnect generation in one async context manager. `close()` cancels the receive task, closes the socket, clears callbacks, and is safe to call twice. Reconnection restores requested topic subscriptions but never replays commands.

The example selects agents from capability advertisements rather than configured IDs:

```py
agents = [channel.agent_id for channel in client.channels() if channel.has_capability("vehicle")]
for index, agent_id in enumerate(agents[:2]):
    await client.publish_vehicle_command(agent_id, throttle=0.35 + index * 0.1, steering=(-0.2 if index == 0 else 0.2), brake=0.0)
```

- [ ] **Step 3: Implement the JavaScript client**

Mirror the Python lifecycle and typed operations using the generated TypeScript binding. Build ESM output without depending on browser application code. Export only public SDK records and `ScenarioClient` from `src/index.ts`.

- [ ] **Step 4: Verify both SDKs against the real gateway**

Run: `npx vite-node scripts/verifyScenarioGateway.ts`

Expected: Python and JavaScript clients discover channels, receive data, publish accepted commands, reconnect without command replay, and exit with no remaining child process or socket.

### Task 5: Gateway status in Scenario Studio

**Files:**
- Modify: `src/scenario-studio/gateway/GatewayBridge.ts`
- Modify: `src/scenario-studio/ui/ScenarioHudFeature.ts`
- Modify: `src/scenario-studio/ScenarioStudioApp.ts`
- Modify: `scripts/verifyScenarioStudio.ts`

**Interfaces:**
- Consumes: immutable `GatewaySnapshot` values from Task 3.
- Produces: `ScenarioHudFeature.setGatewayStatus(snapshot: GatewaySnapshot): void`.

- [ ] **Step 1: Add failing product assertions**

In the built-client walkthrough, assert the HUD exposes an accessible gateway region and transitions through disconnected, connected, one external client, stale-command diagnostic, and client disconnected states.

Run: `npx vite-node scripts/verifyScenarioStudio.ts`

Expected: failure because the gateway status region does not exist.

- [ ] **Step 2: Add the compact status region**

Add one persistent, accessible status group showing connection state, session ID abbreviation, active external client count, and latest diagnostic. Use existing `HudText` and panel styling; do not add a new modal or scaffolding-only control.

- [ ] **Step 3: Wire immutable status snapshots**

Subscribe in `ScenarioStudioApp`, update the HUD only while the app is alive, and dispose the subscription before disposing the bridge. Diagnostic copy must identify a client or target agent when known.

- [ ] **Step 4: Pass the built-client walkthrough**

Run: `npm run review:build && npx vite-node scripts/verifyScenarioStudio.ts`

Expected: the walkthrough observes every gateway state transition and exits zero.

### Task 6: Full external-controller product acceptance and design status

**Files:**
- Modify: `scripts/verifyScenarioStudio.ts`
- Modify: `docs/scenario-studio-design.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: production gateway, browser bridge, SDKs, and HUD from Tasks 1–5.
- Produces: one reproducible milestone acceptance walkthrough and operator instructions.

- [ ] **Step 1: Exercise the exact milestone acceptance flow**

Extend the walkthrough to place two vehicles, start playback, launch the independently managed Python example, discover both agents without IDs, subscribe to ticks and states, and publish different commands. Record movement proving each command reached only its target.

- [ ] **Step 2: Exercise lifecycle and cleanup**

Pause and assert no ticks or command burst; resume and assert continuity; terminate and reconnect the Python process and assert no stale command survives; Reset and assert old-generation commands are rejected; close the page/server and assert the client, subscriptions, sockets, timers, and child process all terminate.

- [ ] **Step 3: Update operator documentation and milestone state**

Document `npm run gateway:start`, origin/token environment variables, Python setup/example execution, JavaScript SDK usage, root `protos/` generation, and C++ generation from `protos/scenario_gateway.proto`. Mark all Milestone 6 checklist items complete, move progress to 6 of 12, and make Milestone 7 the next milestone only after acceptance passes.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm run gateway:proto:check
npx vite-node scripts/verifyScenarioGateway.ts
npm run build:check
npm run review:build
npx vite-node scripts/verifyScenarioStudio.ts
```

Expected: every command exits zero; the Scenario Studio artifact records discovery, two-agent independent control, disconnect/reconnect, Pause/Resume/Reset, diagnostics, and resource cleanup.

