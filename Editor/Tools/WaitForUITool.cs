using System;
using System.Threading.Tasks;
using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace McpUnity.Tools
{
    /// <summary>
    /// Tool that polls until a target GameObject appears, is active, and (optionally) interactable.
    /// Useful as a synchronization primitive between ui_click_gameobject calls — wait for the next FTUE
    /// step to render before clicking it. Polling runs on EditorApplication.update (frame-driven).
    /// </summary>
    public class WaitForUITool : McpToolBase
    {
        private const int DefaultTimeoutMs = 5000;
        private const int MaxTimeoutMs = 60000;

        public WaitForUITool()
        {
            Name = "wait_for_ui";
            Description =
                "Polls for a GameObject by hierarchy path until it appears and (optionally) is interactable, " +
                "or a timeout elapses. Works in both Edit Mode and Play Mode (hierarchy traversal is mode-agnostic). " +
                "Returns success with elapsedMs when found, or 'timeout' on failure. Default timeout 5000 ms, max 60000 ms.";
            IsAsync = true;
        }

        public override void ExecuteAsync(JObject parameters, TaskCompletionSource<JObject> tcs)
        {
            string objectPath = parameters?["objectPath"]?.ToObject<string>();
            int timeoutMs = parameters?["timeoutMs"]?.ToObject<int?>() ?? DefaultTimeoutMs;
            bool requireInteractable = parameters?["requireInteractable"]?.ToObject<bool?>() ?? true;

            if (string.IsNullOrEmpty(objectPath))
            {
                tcs.TrySetResult(McpUnitySocketHandler.CreateErrorResponse(
                    "Missing required parameter: objectPath",
                    "validation_error"));
                return;
            }

            timeoutMs = Mathf.Clamp(timeoutMs, 0, MaxTimeoutMs);

            // Fast path: target may already be ready before the first editor update tick.
            if (TryMatch(objectPath, requireInteractable, out _))
            {
                tcs.TrySetResult(BuildSuccess(objectPath, 0L));
                return;
            }

            double startTime = EditorApplication.timeSinceStartup;
            EditorApplication.CallbackFunction tick = null;

            tick = () =>
            {
                try
                {
                    long elapsedMs = (long)((EditorApplication.timeSinceStartup - startTime) * 1000.0);

                    if (TryMatch(objectPath, requireInteractable, out _))
                    {
                        EditorApplication.update -= tick;
                        tcs.TrySetResult(BuildSuccess(objectPath, elapsedMs));
                        return;
                    }

                    if (elapsedMs >= timeoutMs)
                    {
                        EditorApplication.update -= tick;
                        tcs.TrySetResult(McpUnitySocketHandler.CreateErrorResponse(
                            $"Timed out after {elapsedMs} ms waiting for '{objectPath}' " +
                            $"(requireInteractable={requireInteractable}).",
                            "timeout"));
                    }
                }
                catch (Exception ex)
                {
                    EditorApplication.update -= tick;
                    McpLogger.LogError($"[MCP Unity] wait_for_ui tick failed: {ex.Message}\n{ex.StackTrace}");
                    tcs.TrySetResult(McpUnitySocketHandler.CreateErrorResponse(
                        $"Internal error during wait: {ex.Message}",
                        "internal_error"));
                }
            };

            EditorApplication.update += tick;
        }

        private static bool TryMatch(string objectPath, bool requireInteractable, out GameObject found)
        {
            found = GameObjectResolver.FindInLoadedScenes(objectPath);
            if (found == null) return false;
            if (!found.activeInHierarchy) return false;
            if (!requireInteractable) return true;
            return IsInteractable(found);
        }

        /// <summary>
        /// True when no CanvasGroup in the chain blocks raycasts/interactivity, and the on-object Selectable
        /// (if any) is interactable.
        /// </summary>
        private static bool IsInteractable(GameObject go)
        {
            Transform current = go.transform;
            while (current != null)
            {
                CanvasGroup group = current.GetComponent<CanvasGroup>();
                if (group != null)
                {
                    if (!group.interactable || !group.blocksRaycasts) return false;
                    if (group.ignoreParentGroups) break;
                }
                current = current.parent;
            }

            Selectable selectable = go.GetComponent<Selectable>();
            return selectable == null || selectable.IsInteractable();
        }

        private static JObject BuildSuccess(string objectPath, long elapsedMs)
        {
            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = $"'{objectPath}' is ready after {elapsedMs} ms.",
                ["objectPath"] = objectPath,
                ["elapsedMs"] = elapsedMs
            };
        }
    }
}
