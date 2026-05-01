using System;
using System.Threading.Tasks;
using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json.Linq;

namespace McpUnity.Tools
{
    /// <summary>
    /// Tool for capturing a PNG screenshot of the Unity Game view.
    /// </summary>
    public class CaptureGameViewTool : McpToolBase
    {
        public CaptureGameViewTool()
        {
            Name = "capture_game_view";
            Description = "Captures a PNG screenshot of the Unity Game view and returns the absolute file path plus scene/play-mode metadata. Most reliable in Play Mode with the Game view rendering.";
            IsAsync = true;
        }

        public override async void ExecuteAsync(JObject parameters, TaskCompletionSource<JObject> tcs)
        {
            try
            {
                JObject result = await CaptureGameViewUtility.CaptureAsync(parameters);
                if (result["success"]?.ToObject<bool?>() == true)
                {
                    McpLogger.LogInfo($"[MCP Unity] Game view screenshot captured: {result["path"]}");
                }

                tcs.SetResult(result);
            }
            catch (Exception ex)
            {
                McpLogger.LogError($"[MCP Unity] capture_game_view failed: {ex.Message}\n{ex.StackTrace}");
                tcs.SetResult(McpUnitySocketHandler.CreateErrorResponse(
                    $"Game view capture failed: {ex.Message}",
                    "screenshot_error"
                ));
            }
        }
    }
}
