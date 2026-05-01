using McpUnity.Unity;
using UnityEditor;
using UnityEngine;

namespace McpUnity.Utils
{
    /// <summary>
    /// Watchdog that keeps the MCP WebSocket server alive.
    ///
    /// Why this exists: startup can fail silently (port in use during a fast reload, early
    /// init race, ephemeral exception) and without supervision the server stays down until
    /// the developer clicks "Start MCP Server" in the editor window. That breaks headless
    /// automation. This supervisor detects the down state and calls StartServer again on
    /// the main thread — StartServer is idempotent (no-ops if already listening) and
    /// already handles the Multiplayer Play Mode clone case internally, so calling it is
    /// safe even when we're not sure of the state.
    ///
    /// Intentionally minimal:
    /// - Skips in batch mode (Unity Cloud Build, CI) — same policy as the server itself.
    /// - Skips while Unity is compiling or updating the asset database to avoid racing
    ///   the domain reload teardown. StartServer is called after the reload completes via
    ///   the server's own [DidReloadScripts] hook; the supervisor is a safety net, not
    ///   the primary startup path.
    /// - Skips when the user has explicitly disabled AutoStartServer (respect user intent).
    /// - 5 s cooldown between restart attempts to avoid hammering a port that's really
    ///   stuck (e.g. another editor instance owns it).
    /// </summary>
    [InitializeOnLoad]
    internal static class McpUnitySupervisor
    {
        private const double CheckIntervalSeconds = 2.0;
        private const double RestartCooldownSeconds = 5.0;

        private static double _nextCheckTime;
        private static double _lastRestartAttemptTime;

        static McpUnitySupervisor()
        {
            if (Application.isBatchMode)
            {
                return;
            }

            EditorApplication.update -= Tick;
            EditorApplication.update += Tick;
        }

        private static void Tick()
        {
            double now = EditorApplication.timeSinceStartup;
            if (now < _nextCheckTime)
            {
                return;
            }
            _nextCheckTime = now + CheckIntervalSeconds;

            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                return;
            }

            McpUnitySettings settings = McpUnitySettings.Instance;
            if (settings == null || !settings.AutoStartServer)
            {
                return;
            }

            McpUnityServer server = McpUnityServer.Instance;
            if (server == null)
            {
                // Batch mode or still bootstrapping — nothing to do.
                return;
            }

            if (server.IsListening)
            {
                return;
            }

            if (now - _lastRestartAttemptTime < RestartCooldownSeconds)
            {
                return;
            }

            _lastRestartAttemptTime = now;
            McpLogger.LogInfo("[MCP Unity] Supervisor detected server is down. Attempting restart.");
            server.StartServer();
        }
    }
}
