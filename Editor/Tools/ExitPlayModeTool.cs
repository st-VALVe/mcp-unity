using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace McpUnity.Tools
{
    /// <summary>
    /// Tool for exiting Unity Play Mode. Returns immediately after requesting the transition.
    /// The MCP WebSocket server restarts after the editor returns to Edit Mode.
    /// </summary>
    public class ExitPlayModeTool : McpToolBase
    {
        public ExitPlayModeTool()
        {
            Name = "exit_play_mode";
            Description =
                "Exits Unity Play Mode and returns to Edit Mode. No-op if not currently playing.";
        }

        public override JObject Execute(JObject parameters)
        {
            if (!EditorApplication.isPlaying)
            {
                return new JObject
                {
                    ["success"] = true,
                    ["type"] = "text",
                    ["message"] = "Not in Play Mode. No action taken.",
                    ["wasPlaying"] = false
                };
            }

            McpLogger.LogInfo("[MCP Unity] Scheduling Play Mode exit on next editor update.");

            // Defer ExitPlaymode to the next editor update so this response flushes through the
            // WebSocket before the domain reload tears the connection down. Frame-driven rather
            // than delayCall (idle-driven) for reliability — see EnterPlayModeTool for rationale.
            EditorApplication.CallbackFunction handler = null;
            handler = () =>
            {
                EditorApplication.update -= handler;
                if (EditorApplication.isPlaying)
                {
                    EditorApplication.ExitPlaymode();
                }
            };
            EditorApplication.update += handler;

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = "Requested Play Mode exit. The editor will return to Edit Mode on the next update.",
                ["wasPlaying"] = true,
                ["transitionInProgress"] = true
            };
        }
    }
}
