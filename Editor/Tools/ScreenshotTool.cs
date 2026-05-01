using System;
using System.Threading.Tasks;
using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json.Linq;

namespace McpUnity.Tools
{
    /// <summary>
    /// Backwards-compatible alias for capture_game_view.
    /// </summary>
    public class ScreenshotTool : McpToolBase
    {
        public ScreenshotTool()
        {
            Name = "screenshot";
            Description = "Legacy alias for capture_game_view. Captures a PNG screenshot of the Unity Game view and returns the absolute file path.";
            IsAsync = true;
        }

        public override async void ExecuteAsync(JObject parameters, TaskCompletionSource<JObject> tcs)
        {
            try
            {
                tcs.SetResult(await CaptureGameViewUtility.CaptureAsync(parameters));
            }
            catch (Exception ex)
            {
                McpLogger.LogError($"[MCP Unity] Screenshot failed: {ex.Message}\n{ex.StackTrace}");
                tcs.SetResult(McpUnitySocketHandler.CreateErrorResponse(
                    $"Screenshot failed: {ex.Message}",
                    "screenshot_error"
                ));
            }
        }
    }
}
