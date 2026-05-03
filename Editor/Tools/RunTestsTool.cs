using System;
using System.Threading.Tasks;
using McpUnity.Unity;
using UnityEngine;
using Newtonsoft.Json.Linq;
using UnityEditor.TestTools.TestRunner.Api;
using McpUnity.Services;
using McpUnity.Utils;

namespace McpUnity.Tools
{
    /// <summary>
    /// Tool for running Unity Test Runner tests
    /// </summary>
    public class RunTestsTool : McpToolBase
    {
        private readonly ITestRunnerService _testRunnerService;
        private readonly IConsoleLogsService _consoleLogsService;

        public RunTestsTool(ITestRunnerService testRunnerService, IConsoleLogsService consoleLogsService)
        {
            Name = "run_tests";
            Description = "Runs tests using Unity's Test Runner. Can optionally capture screenshot/log/hierarchy diagnostics when failures occur.";
            IsAsync = true;
            _testRunnerService = testRunnerService;
            _consoleLogsService = consoleLogsService;
        }
        
        /// <summary>
        /// Executes the RunTests tool asynchronously on the main thread.
        /// </summary>
        /// <param name="parameters">Tool parameters, including optional 'testMode' and 'testFilter'.</param>
        /// <param name="tcs">TaskCompletionSource to set the result or exception.</param>
        public override async void ExecuteAsync(JObject parameters, TaskCompletionSource<JObject> tcs)
        {
            var preflightService = new DirtyScenePreflightService();
            if (preflightService.Apply(parameters, out JObject errorResponse, out JObject preflightReport) ==
                DirtyScenePreflightOutcome.Refused)
            {
                tcs.SetResult(errorResponse);
                return;
            }

            // Parse parameters
            string testModeStr = parameters?["testMode"]?.ToObject<string>() ?? "EditMode";
            string testFilter = parameters?["testFilter"]?.ToObject<string>(); // Optional
            bool returnOnlyFailures = parameters?["returnOnlyFailures"]?.ToObject<bool>() ?? false; // Optional
            bool returnWithLogs = parameters?["returnWithLogs"]?.ToObject<bool>() ?? false; // Optional
            bool captureOnFailure = parameters?["captureOnFailure"]?.ToObject<bool>() ?? false; // Optional
            string diagnosticsOutputDir = parameters?["diagnosticsOutputDir"]?.ToObject<string>(); // Optional
            string diagnosticsLabel = parameters?["diagnosticsLabel"]?.ToObject<string>(); // Optional

            TestMode testMode = TestMode.EditMode;
            
            if (Enum.TryParse(testModeStr, true, out TestMode parsedMode))
            {
                testMode = parsedMode;
            }

            McpLogger.LogInfo($"Executing RunTestsTool: Mode={testMode}, Filter={testFilter ?? "(none)"}");

            // Call the service to run tests
            JObject result = await _testRunnerService.ExecuteTestsAsync(testMode, returnOnlyFailures, returnWithLogs, testFilter);
            result["preflight"] = preflightReport;
            if (captureOnFailure && HasFailures(result))
            {
                result["diagnostics"] = await DiagnosticsCaptureUtility.CaptureAsync(new JObject
                {
                    ["label"] = string.IsNullOrWhiteSpace(diagnosticsLabel)
                        ? BuildDefaultDiagnosticsLabel(testMode, testFilter)
                        : diagnosticsLabel,
                    ["outputDir"] = diagnosticsOutputDir,
                    ["includeScreenshot"] = parameters?["includeScreenshot"]?.ToObject<bool?>() ?? true,
                    ["includeConsoleLogs"] = parameters?["includeConsoleLogs"]?.ToObject<bool?>() ?? true,
                    ["includeHierarchy"] = parameters?["includeHierarchy"]?.ToObject<bool?>() ?? true,
                    ["includeStackTrace"] = parameters?["includeStackTrace"]?.ToObject<bool?>() ?? false,
                    ["logType"] = parameters?["logType"]?.ToObject<string>() ?? "error",
                    ["logLimit"] = parameters?["logLimit"]?.ToObject<int?>() ?? 50,
                    ["superSize"] = parameters?["superSize"]?.ToObject<int?>() ?? 1,
                    ["waitSeconds"] = parameters?["waitSeconds"]?.ToObject<float?>() ?? 2f
                }, _consoleLogsService);
            }

            tcs.SetResult(result);
        }

        private static bool HasFailures(JObject result)
        {
            if (result == null || result["error"] != null)
            {
                return true;
            }

            int failCount = result["failCount"]?.ToObject<int?>() ?? 0;
            if (failCount > 0)
            {
                return true;
            }

            string resultState = result["resultState"]?.ToObject<string>();
            return !string.IsNullOrWhiteSpace(resultState) &&
                   resultState.IndexOf("failed", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static string BuildDefaultDiagnosticsLabel(TestMode testMode, string testFilter)
        {
            string suffix = string.IsNullOrWhiteSpace(testFilter) ? "all" : testFilter;
            foreach (char invalid in System.IO.Path.GetInvalidFileNameChars())
            {
                suffix = suffix.Replace(invalid, '_');
            }

            return $"test_failure_{testMode}_{suffix}";
        }
    }
}
