using System;
using System.IO;
using System.Threading.Tasks;
using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace McpUnity.Tools
{
    internal static class CaptureGameViewUtility
    {
        private const float DefaultMaxWaitSeconds = 2f;
        private const int PollIntervalMs = 50;

        public static async Task<JObject> CaptureAsync(JObject parameters)
        {
            string requestedPath = parameters?["outputPath"]?.ToObject<string>();
            int superSize = Mathf.Clamp(parameters?["superSize"]?.ToObject<int?>() ?? 1, 1, 8);
            float maxWaitSeconds = Mathf.Clamp(parameters?["waitSeconds"]?.ToObject<float?>() ?? DefaultMaxWaitSeconds, 0.1f, 30f);

            string absolutePath = ResolveOutputPath(requestedPath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath) ?? Directory.GetCurrentDirectory());

            if (File.Exists(absolutePath))
            {
                File.Delete(absolutePath);
            }

            bool inPlayMode = Application.isPlaying;
            if (!inPlayMode)
            {
                McpLogger.LogWarning("[MCP Unity] capture_game_view called outside Play Mode. Capture may fail if the Game view is not rendering.");
            }

            ScreenCapture.CaptureScreenshot(absolutePath, superSize);

            bool fileReady = await WaitForStableFileAsync(absolutePath, maxWaitSeconds);
            if (!fileReady)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"Game view screenshot file was not written within {maxWaitSeconds:0.##}s. Path: {absolutePath}. Make sure the Game view is open and rendering.",
                    "screenshot_timeout"
                );
            }

            var fileInfo = new FileInfo(absolutePath);
            Scene activeScene = SceneManager.GetActiveScene();

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = $"Game view screenshot captured at {absolutePath}",
                ["path"] = absolutePath,
                ["sizeBytes"] = fileInfo.Length,
                ["superSize"] = superSize,
                ["playMode"] = inPlayMode,
                ["screenWidth"] = Screen.width,
                ["screenHeight"] = Screen.height,
                ["activeScene"] = new JObject
                {
                    ["name"] = activeScene.name,
                    ["path"] = activeScene.path,
                    ["buildIndex"] = activeScene.buildIndex
                }
            };
        }

        public static string ResolveOutputPath(string requested)
        {
            string path;
            if (string.IsNullOrWhiteSpace(requested))
            {
                string fileName = $"game_view_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}.png";
                path = Path.Combine(Directory.GetCurrentDirectory(), "Temp", "mcp-screenshots", fileName);
            }
            else if (Path.IsPathRooted(requested))
            {
                path = requested;
            }
            else
            {
                path = Path.Combine(Directory.GetCurrentDirectory(), requested);
            }

            if (!path.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            {
                path += ".png";
            }

            return Path.GetFullPath(path);
        }

        private static async Task<bool> WaitForStableFileAsync(string path, float maxWaitSeconds)
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(maxWaitSeconds);
            long lastSize = -1;
            int stableSamples = 0;

            while (DateTime.UtcNow < deadline)
            {
                await Task.Delay(PollIntervalMs);
                if (!File.Exists(path))
                {
                    continue;
                }

                long size = new FileInfo(path).Length;
                if (size > 0 && size == lastSize)
                {
                    if (++stableSamples >= 2)
                    {
                        return true;
                    }
                }
                else
                {
                    stableSamples = 0;
                    lastSize = size;
                }
            }

            return File.Exists(path) && new FileInfo(path).Length > 0;
        }
    }
}
