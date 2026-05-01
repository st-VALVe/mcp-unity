using System;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using McpUnity.Resources;
using McpUnity.Services;
using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace McpUnity.Tools
{
    /// <summary>
    /// Tool for writing screenshot, console log, hierarchy, and metadata artifacts for a UI/test failure.
    /// </summary>
    public class CaptureDiagnosticsTool : McpToolBase
    {
        private readonly IConsoleLogsService _consoleLogsService;

        public CaptureDiagnosticsTool(IConsoleLogsService consoleLogsService)
        {
            _consoleLogsService = consoleLogsService;
            Name = "capture_diagnostics";
            Description = "Captures a diagnostic artifact bundle for UI/test failures: Game view screenshot, console logs, scene hierarchy, and metadata. Returns file paths instead of huge JSON payloads.";
            IsAsync = true;
        }

        public override async void ExecuteAsync(JObject parameters, TaskCompletionSource<JObject> tcs)
        {
            try
            {
                JObject result = await DiagnosticsCaptureUtility.CaptureAsync(parameters, _consoleLogsService);
                tcs.SetResult(result);
            }
            catch (Exception ex)
            {
                McpLogger.LogError($"[MCP Unity] capture_diagnostics failed: {ex.Message}\n{ex.StackTrace}");
                tcs.SetResult(McpUnitySocketHandler.CreateErrorResponse(
                    $"Diagnostic capture failed: {ex.Message}",
                    "diagnostics_error"
                ));
            }
        }
    }

    internal static class DiagnosticsCaptureUtility
    {
        private const int DefaultLogLimit = 50;

        public static async Task<JObject> CaptureAsync(JObject parameters, IConsoleLogsService consoleLogsService)
        {
            string label = SanitizeLabel(parameters?["label"]?.ToObject<string>());
            string outputDir = ResolveOutputDirectory(parameters?["outputDir"]?.ToObject<string>(), label);
            Directory.CreateDirectory(outputDir);

            bool includeScreenshot = parameters?["includeScreenshot"]?.ToObject<bool?>() ?? true;
            bool includeConsoleLogs = parameters?["includeConsoleLogs"]?.ToObject<bool?>() ?? true;
            bool includeHierarchy = parameters?["includeHierarchy"]?.ToObject<bool?>() ?? true;
            int logLimit = Math.Max(1, Math.Min(1000, parameters?["logLimit"]?.ToObject<int?>() ?? DefaultLogLimit));
            bool includeStackTrace = parameters?["includeStackTrace"]?.ToObject<bool?>() ?? false;
            string logType = parameters?["logType"]?.ToObject<string>();
            int superSize = Math.Max(1, Math.Min(8, parameters?["superSize"]?.ToObject<int?>() ?? 1));

            var artifacts = new JObject();
            var warnings = new JArray();

            JObject metadata = BuildMetadata(label);
            string metadataPath = Path.Combine(outputDir, "metadata.json");
            WriteJson(metadataPath, metadata);
            artifacts["metadata"] = metadataPath;

            if (includeScreenshot)
            {
                string screenshotPath = Path.Combine(outputDir, "game_view.png");
                JObject screenshot = await CaptureGameViewUtility.CaptureAsync(new JObject
                {
                    ["outputPath"] = screenshotPath,
                    ["superSize"] = superSize,
                    ["waitSeconds"] = parameters?["waitSeconds"]?.ToObject<float?>() ?? 2f
                });

                if (screenshot["success"]?.ToObject<bool?>() == true)
                {
                    artifacts["screenshot"] = screenshot["path"]?.ToString();
                    metadata["screenshot"] = screenshot;
                    WriteJson(metadataPath, metadata);
                }
                else
                {
                    string message = screenshot["error"]?["message"]?.ToString() ?? screenshot["message"]?.ToString() ?? "Game view screenshot capture failed.";
                    warnings.Add(message);
                }
            }

            if (includeConsoleLogs && consoleLogsService != null)
            {
                JObject logs = consoleLogsService.GetLogsAsJson(logType, 0, logLimit, includeStackTrace);
                logs["success"] = true;
                int returnedCount = logs["_returnedCount"]?.ToObject<int>() ?? 0;
                logs["message"] = $"Captured latest {returnedCount} console logs.";
                string logsPath = Path.Combine(outputDir, "console_logs.json");
                WriteJson(logsPath, logs);
                artifacts["consoleLogs"] = logsPath;
            }

            if (includeHierarchy)
            {
                JObject hierarchy = new GetScenesHierarchyResource().Fetch(new JObject());
                string hierarchyPath = Path.Combine(outputDir, "scene_hierarchy.json");
                WriteJson(hierarchyPath, hierarchy);
                artifacts["sceneHierarchy"] = hierarchyPath;
            }

            bool anyArtifact = artifacts.Count > 0;
            return new JObject
            {
                ["success"] = anyArtifact,
                ["type"] = "text",
                ["message"] = anyArtifact
                    ? $"Diagnostics captured at {outputDir}"
                    : $"No diagnostics were captured at {outputDir}",
                ["directory"] = outputDir,
                ["label"] = label,
                ["artifacts"] = artifacts,
                ["warnings"] = warnings
            };
        }

        private static JObject BuildMetadata(string label)
        {
            Scene activeScene = SceneManager.GetActiveScene();
            return new JObject
            {
                ["label"] = label,
                ["capturedAtUtc"] = DateTime.UtcNow.ToString("O"),
                ["unityVersion"] = Application.unityVersion,
                ["platform"] = Application.platform.ToString(),
                ["isPlaying"] = Application.isPlaying,
                ["isPaused"] = EditorApplication.isPaused,
                ["screen"] = new JObject
                {
                    ["width"] = Screen.width,
                    ["height"] = Screen.height,
                    ["dpi"] = Screen.dpi
                },
                ["activeScene"] = new JObject
                {
                    ["name"] = activeScene.name,
                    ["path"] = activeScene.path,
                    ["buildIndex"] = activeScene.buildIndex,
                    ["isDirty"] = activeScene.isDirty
                }
            };
        }

        private static string ResolveOutputDirectory(string requested, string label)
        {
            string folderName = $"{label}_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}";
            string path;

            if (string.IsNullOrWhiteSpace(requested))
            {
                path = Path.Combine(Directory.GetCurrentDirectory(), "Temp", "mcp-diagnostics", folderName);
            }
            else if (Path.IsPathRooted(requested))
            {
                path = Path.Combine(requested, folderName);
            }
            else
            {
                path = Path.Combine(Directory.GetCurrentDirectory(), requested, folderName);
            }

            return Path.GetFullPath(path);
        }

        private static string SanitizeLabel(string label)
        {
            if (string.IsNullOrWhiteSpace(label))
            {
                label = "diagnostic";
            }

            string sanitized = Regex.Replace(label.Trim(), @"[^A-Za-z0-9_.-]+", "_").Trim('_');
            return string.IsNullOrWhiteSpace(sanitized) ? "diagnostic" : sanitized;
        }

        private static void WriteJson(string path, JToken token)
        {
            File.WriteAllText(path, token.ToString(Formatting.Indented));
        }
    }
}
