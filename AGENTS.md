## MCP Unity — AI Agent Guide (MCP Package)

### Purpose (what this repo is)
**MCP Unity** exposes Unity Editor capabilities to MCP-enabled clients by running:
- **Unity-side “client” (C# Editor scripts)**: a WebSocket server inside the Unity Editor that executes tools/resources.
- **Node-side “server” (TypeScript)**: an MCP stdio server that registers MCP tools/resources and forwards requests to Unity over WebSocket.

### How it works (high-level data flow)
- **MCP client** ⇄ (stdio / MCP SDK) ⇄ **Node server** (`Server~/src/index.ts`)
- **Node server** ⇄ (WebSocket JSON-RPC-ish) ⇄ **Unity Editor** (`Editor/UnityBridge/McpUnityServer.cs` + `McpUnitySocketHandler.cs`)
- **Tool/Resource names must match exactly** across Node and Unity (typically `lower_snake_case`).

### Key defaults & invariants
- **Unity WebSocket endpoint**: `ws://localhost:8090/McpUnity` by default.
- **Config file**: `ProjectSettings/McpUnitySettings.json` (written/read by Unity; read opportunistically by Node).
- **Execution thread**: Tool/resource execution is dispatched via `EditorCoroutineUtility` and runs on the **Unity main thread**. Keep synchronous work short; use async patterns for long work.

### Repo layout (where to change what)
```
/
├── Editor/                       # Unity Editor package code (C#)
│   ├── Tools/                    # Tools (inherit McpToolBase)
│   ├── Resources/                # Resources (inherit McpResourceBase)
│   ├── UnityBridge/              # WebSocket server + message routing
│   ├── Services/                 # Test/log services used by tools/resources
│   └── Utils/                    # Shared helpers (config, logging, workspace integration)
├── Server~/                      # Node MCP server (TypeScript, ESM)
│   ├── src/index.ts              # Registers tools/resources/prompts with MCP SDK
│   ├── src/tools/                # MCP tool definitions (zod schema + handler)
│   ├── src/resources/            # MCP resource definitions
│   └── src/unity/mcpUnity.ts      # WebSocket client that talks to Unity
└── server.json                   # MCP registry metadata (name/version/package)
```

### Quickstart (local dev)
- **Unity side**
  - Open the Unity project that has this package installed.
  - Ensure the server is running (auto-start is controlled by `McpUnitySettings.AutoStartServer`).
  - Settings persist in `ProjectSettings/McpUnitySettings.json`.

- **Node side (build)**
  - `cd Server~ && npm run build`
  - The MCP entrypoint is `Server~/build/index.js` (published as an MCP stdio server).

- **Node side (debug/inspect)**
  - `cd Server~ && npm run inspector` to use the MCP Inspector.

### Configuration (Unity ↔ Node bridge)
The Unity settings file is the shared contract:
- **Path**: `ProjectSettings/McpUnitySettings.json`
- **Fields**
  - **Port** (default **8090**): Unity WebSocket server port.
  - **RequestTimeoutSeconds** (default **30**): Node request timeout (Node reads this if the settings file is discoverable).
  - **AllowRemoteConnections** (default **false**): Unity binds to `0.0.0.0` when enabled; otherwise `localhost`.
  - **EnableInfoLogs**: Unity console logging verbosity.
  - **NpmExecutablePath**: optional npm path for Unity-driven install/build.

Node reads config from `../ProjectSettings/McpUnitySettings.json` relative to **its current working directory**. If not found, Node falls back to:
- **host**: `localhost`
- **port**: `8090`
- **timeout**: `30s`

**Remote connection note**:
- If Unity is on another machine, set `AllowRemoteConnections=true` in Unity and set `UNITY_HOST=<unity_machine_ip_or_hostname>` for the Node process.

### Adding a new capability

### Add a tool
1. **Unity (C#)**
   - Add `Editor/Tools/<YourTool>Tool.cs` inheriting `McpToolBase`.
   - Set `Name` to the MCP tool name (recommended: `lower_snake_case`).
   - Implement:
     - `Execute(JObject parameters)` for synchronous work, or
     - set `IsAsync = true` and implement `ExecuteAsync(JObject parameters, TaskCompletionSource<JObject> tcs)` for long-running operations.
   - Register it in `Editor/UnityBridge/McpUnityServer.cs` (`RegisterTools()`).

2. **Node (TypeScript)**
   - Add `Server~/src/tools/<yourTool>Tool.ts`.
   - Register the tool in `Server~/src/index.ts`.
   - Use a zod schema for params; forward to Unity using the same `method` string:
     - `mcpUnity.sendRequest({ method: toolName, params: {...} })`

3. **Build**
   - `cd Server~ && npm run build`

### Add a resource
1. **Unity (C#)**
   - Add `Editor/Resources/<YourResource>Resource.cs` inheriting `McpResourceBase`.
   - Set `Name` (method string) and `Uri` (e.g. `unity://...`).
   - Implement `Fetch(...)` or `FetchAsync(...)`.
   - Register in `Editor/UnityBridge/McpUnityServer.cs` (`RegisterResources()`).

2. **Node (TypeScript)**
   - Add `Server~/src/resources/<yourResource>.ts`, register in `Server~/src/index.ts`.
   - Forward to Unity via `mcpUnity.sendRequest({ method: resourceName, params: {} })`.

### Logging & debugging
- **Unity**
  - Uses `McpUnity.Utils.McpLogger` (info logs gated by `EnableInfoLogs`).
  - Connection lifecycle is managed in `Editor/UnityBridge/McpUnityServer.cs` (domain reload & playmode transitions stop/restart the server).

- **Node**
  - Logging is controlled by env vars:
    - `LOGGING=true` enables console logging.
    - `LOGGING_FILE=true` writes `log.txt` in the Node process working directory.

### Common pitfalls
- **Port mismatch**: Unity default is **8090**; update docs/config if you change it.
- **Name mismatch**: Node `toolName`/`resourceName` must equal Unity `Name` exactly, or Unity responds `unknown_method`.
- **Long main-thread work**: synchronous `Execute()` blocks the Unity editor; use async patterns for heavy operations.
- **Remote connections**: Unity must bind `0.0.0.0` (`AllowRemoteConnections=true`) and Node must target the correct host (`UNITY_HOST`).
- **Unity domain reload**: the server stops during script reloads and may restart; avoid relying on persistent in-memory state across reloads.
- **Multiplayer Play Mode**: Clone instances automatically skip server startup; only the main editor hosts the MCP server.
- **Schema compatibility across clients**: avoid reusing the same nested Zod object instance for multiple sibling fields (for example `position`, `rotation`, `scale`). Some MCP clients fail on local refs like `#/properties/position`; prefer creating a fresh nested schema per field.

### Release/version bump checklist
- Update versions consistently:
  - Unity package `package.json` (`version`)
  - Node server `Server~/package.json` (`version`)
  - MCP registry `server.json` (`version` + npm identifier/version)
- Rebuild Node output: `cd Server~ && npm run build`

### Available tools (current)
- `execute_menu_item` — Execute Unity menu items
- `select_gameobject` — Select GameObjects in hierarchy
- `update_gameobject` — Update or create GameObject properties
- `update_component` — Update or add components on GameObjects
- `add_package` — Install packages via Package Manager
- `run_tests` — Run Unity Test Runner tests (supports dirty scene preflight)
- `capture_game_view` — Capture a PNG screenshot of the Unity Game view
- `capture_diagnostics` — Save screenshot, console log, scene hierarchy, and metadata artifacts
- `send_console_log` — Send logs to Unity console
- `add_asset_to_scene` — Add assets to scene
- `create_prefab` — Create prefabs with optional scripts
- `create_scene` — Create and save new scenes
- `load_scene` — Load scenes (single or additive)
- `delete_scene` — Delete scenes and remove from Build Settings
- `save_scene` — Save current scene (with optional Save As)
- `get_scene_info` — Get active scene info and loaded scenes list
- `unload_scene` — Unload scene from hierarchy
- `get_gameobject` — Get detailed GameObject info
- `get_console_logs` — Retrieve Unity console logs
- `recompile_scripts` — Recompile all project scripts
- `duplicate_gameobject` — Duplicate GameObjects with optional rename/reparent
- `delete_gameobject` — Delete GameObjects from scene
- `reparent_gameobject` — Change GameObject parent in hierarchy
- `create_material` — Create materials with specified shader
- `assign_material` — Assign materials to Renderer components
- `modify_material` — Modify material properties (colors, floats, textures)
- `get_material_info` — Get material details including all properties
- `enter_play_mode` — Enter Unity Play Mode (supports dirty scene preflight)
- `detect_unity_modal` — Detect a native Win32 modal dialog blocking Unity main thread (Windows-only, out-of-process via PowerShell). Read-only.
- `dismiss_unity_modal` — Dismiss a native Win32 modal dialog by exact button name (Windows-only, idempotent, returns `dialog_already_dismissed` when already gone).

#### Dirty scene preflight (enter_play_mode / run_tests only)
`enter_play_mode` and `run_tests` accept `dirtyScenePolicy` with values `fail`, `report`, `save`, or `discard`. Default is `report`: proceed and return warnings in `preflight.warnings` without saving or discarding user work. CI/headless callers should pass `dirtyScenePolicy="fail"` explicitly. `discard` requires `dirtyScenePolicyScope` (`active` or `loaded`) when dirty scenes are present; unsaved scenes without an asset path refuse with `cannot_discard_unsaved_scene`.

#### Modal dialog tools (Windows-only)
The `detect_unity_modal` / `dismiss_unity_modal` tools live entirely on the Node side because a blocked Unity main thread cannot answer WebSocket calls. They spawn `powershell.exe` to enumerate Unity processes via WMI and inspect/click `#32770` native dialogs via UIAutomation. Resolution priority for the target Unity process: explicit `targetPid` → explicit `projectPath` → cwd-fallback (when `cwd/ProjectSettings` exists) → `UNITY_PID` env hint → single-Unity heuristic. Ambiguity returns `multiple_unity_processes_require_explicit_target`. IMGUI / non-#32770 modals return `unsupported_dialog_kind` (out of MVP scope).

Real UIAutomation interaction with native dialogs cannot run in standard headless CI (session 0). Unit tests mock `child_process.spawn` via DI; the live PowerShell path requires a manual run on an interactive Windows runner.

#### Optional env vars (Node side)
- `MCP_UNITY_DETECT_MODALS_ON_TIMEOUT=true` — enables read-only modal diagnostics on Unity request timeouts. On timeout, the bridge spawns the modal helper for ≤500ms and attaches `details.modalDiagnostics` to the rejected error. Failure-tolerant: detection failure never masks the original timeout. Default off until measured. Settings-file flag is intentionally NOT exposed yet — Unity-side `JsonUtility` round-trips would drop unknown fields.

### Available resources (current)
- `unity://menu-items` — List of available menu items
- `unity://scenes-hierarchy` — Current scene hierarchy
- `unity://gameobject/{id}` — GameObject details by ID or path
- `unity://logs` — Unity console logs
- `unity://packages` — Installed and available packages
- `unity://assets` — Asset database information
- `unity://tests/{testMode}` — Test Runner test information

### Update policy (for agents)
- Update this file when:
  - tools/resources/prompts are added/removed/renamed,
  - config shape or default ports/paths change,
  - the bridge protocol changes (request/response contract).
- Keep it **high-signal**: where to edit code, how to run/build/debug, and the invariants that prevent subtle breakage.
