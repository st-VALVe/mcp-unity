using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace McpUnity.Tools
{
    /// <summary>
    /// Tool for entering Unity Play Mode. Returns immediately after requesting the transition;
    /// the transition itself (and the subsequent domain reload) happens asynchronously in the editor.
    /// The MCP WebSocket server stops and restarts around the domain reload — the caller should
    /// expect a brief disconnect and reconnect.
    /// </summary>
    public class EnterPlayModeTool : McpToolBase
    {
        public EnterPlayModeTool()
        {
            Name = "enter_play_mode";
            Description =
                "Enters Unity Play Mode. The editor reloads the domain, so the MCP connection will briefly drop and reconnect. No-op if already in Play Mode.";
        }

        public override JObject Execute(JObject parameters)
        {
            if (EditorApplication.isPlaying)
            {
                return new JObject
                {
                    ["success"] = true,
                    ["type"] = "text",
                    ["message"] = "Already in Play Mode. No action taken.",
                    ["wasAlreadyPlaying"] = true
                };
            }

            if (EditorApplication.isPlayingOrWillChangePlaymode)
            {
                return new JObject
                {
                    ["success"] = true,
                    ["type"] = "text",
                    ["message"] = "Play Mode transition already in progress.",
                    ["wasAlreadyPlaying"] = false,
                    ["transitionInProgress"] = true
                };
            }

            McpLogger.LogInfo("[MCP Unity] Scheduling Play Mode entry on next editor update.");

            // Defer EnterPlaymode to the next editor update so this response flushes through the
            // WebSocket before the domain reload tears the connection down. Without this the
            // client observes the transition as a "Connection failed" error even though the
            // transition itself succeeded.
            //
            // We use EditorApplication.update (frame-driven) rather than EditorApplication.delayCall
            // (idle-driven) because delayCall can fail to fire when the editor is busy or unfocused,
            // which is exactly our situation during WebSocket tool invocation from a headless client.
            EditorApplication.CallbackFunction handler = null;
            handler = () =>
            {
                EditorApplication.update -= handler;
                if (!EditorApplication.isPlaying && !EditorApplication.isPlayingOrWillChangePlaymode)
                {
                    EditorApplication.EnterPlaymode();
                }
            };
            EditorApplication.update += handler;

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = "Requested Play Mode entry. The editor will transition on the next update; expect a brief MCP disconnect.",
                ["wasAlreadyPlaying"] = false,
                ["transitionInProgress"] = true
            };
        }
    }
}
