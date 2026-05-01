using System.Collections.Generic;
using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace McpUnity.Tools
{
    /// <summary>
    /// Diagnostic tool: given a screen-space point (top-left origin by default, matching screenshot
    /// coordinates), report what would be hit by an EventSystem raycast. Returns up to 5 hits in
    /// front-to-back order, each annotated with whether it's clickable and which raycaster found it.
    /// Useful for "is this button reachable?" / "what's covering this region?" diagnostics.
    /// </summary>
    public class GetInteractableAtPositionTool : McpToolBase
    {
        private const int MaxHitsReported = 5;

        public GetInteractableAtPositionTool()
        {
            Name = "get_interactable_at_position";
            Description =
                "Returns the GameObjects under a screen-space point in front-to-back order, with " +
                "clickable / selectable / raycaster info. Coordinates default to top-left origin (matching " +
                "screenshot pixel coords); pass origin='bottom-left' for Unity's native convention. " +
                "Requires Play Mode and an active EventSystem.";
        }

        public override JObject Execute(JObject parameters)
        {
            int? xRaw = parameters?["x"]?.ToObject<int?>();
            int? yRaw = parameters?["y"]?.ToObject<int?>();
            string origin = parameters?["origin"]?.ToObject<string>() ?? "top-left";

            if (!xRaw.HasValue || !yRaw.HasValue)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    "Missing required parameters: x and y must both be provided.",
                    "validation_error");
            }

            if (!Application.isPlaying)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    "get_interactable_at_position requires Play Mode.",
                    "not_in_play_mode");
            }

            EventSystem eventSystem = EventSystem.current;
            if (eventSystem == null)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    "No active EventSystem in the scene.",
                    "no_event_system");
            }

            int screenWidth = Screen.width;
            int screenHeight = Screen.height;

            // Convert input to Unity screen coordinates (bottom-left origin).
            float unityX = xRaw.Value;
            float unityY = origin.Equals("bottom-left", System.StringComparison.OrdinalIgnoreCase)
                ? yRaw.Value
                : screenHeight - yRaw.Value;

            var pointerData = new PointerEventData(eventSystem)
            {
                position = new Vector2(unityX, unityY),
                button = PointerEventData.InputButton.Left
            };

            var results = new List<RaycastResult>();
            eventSystem.RaycastAll(pointerData, results);

            var hits = new JArray();
            int reportCount = Mathf.Min(results.Count, MaxHitsReported);
            for (int i = 0; i < reportCount; i++)
            {
                RaycastResult r = results[i];
                if (r.gameObject == null) continue;

                hits.Add(BuildHitInfo(r, i));
            }

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = results.Count == 0
                    ? $"No raycaster hit at ({xRaw.Value}, {yRaw.Value}, origin={origin})."
                    : $"{results.Count} hit(s) at ({xRaw.Value}, {yRaw.Value}, origin={origin}); top: " +
                      GameObjectResolver.GetHierarchyPath(results[0].gameObject),
                ["screenSize"] = new JObject
                {
                    ["width"] = screenWidth,
                    ["height"] = screenHeight
                },
                ["queryPosition"] = new JObject
                {
                    ["x"] = xRaw.Value,
                    ["y"] = yRaw.Value,
                    ["origin"] = origin,
                    ["unityX"] = unityX,
                    ["unityY"] = unityY
                },
                ["hitCount"] = results.Count,
                ["hits"] = hits
            };
        }

        private static JObject BuildHitInfo(RaycastResult hit, int depth)
        {
            GameObject go = hit.gameObject;
            GameObject clickHandler = ExecuteEvents.GetEventHandler<IPointerClickHandler>(go);
            Selectable selectable = go.GetComponentInParent<Selectable>();

            var info = new JObject
            {
                ["depth"] = depth,
                ["path"] = GameObjectResolver.GetHierarchyPath(go),
                ["isClickable"] = clickHandler != null,
                ["clickHandlerPath"] = clickHandler != null
                    ? GameObjectResolver.GetHierarchyPath(clickHandler)
                    : null,
                ["selectablePath"] = selectable != null
                    ? GameObjectResolver.GetHierarchyPath(selectable.gameObject)
                    : null,
                ["selectableInteractable"] = selectable != null ? selectable.IsInteractable() : (bool?)null,
                ["raycaster"] = hit.module != null ? hit.module.GetType().Name : null,
                ["sortingOrder"] = hit.sortingOrder,
                ["distance"] = hit.distance
            };

            RectTransform rect = go.transform as RectTransform;
            if (rect != null)
            {
                Canvas canvas = rect.GetComponentInParent<Canvas>();
                Camera cam = canvas != null && canvas.renderMode != RenderMode.ScreenSpaceOverlay
                    ? canvas.worldCamera
                    : null;

                Vector3[] corners = new Vector3[4];
                rect.GetWorldCorners(corners);
                Vector2 bottomLeft = RectTransformUtility.WorldToScreenPoint(cam, corners[0]);
                Vector2 topRight = RectTransformUtility.WorldToScreenPoint(cam, corners[2]);

                info["screenRect"] = new JObject
                {
                    ["x"] = Mathf.Min(bottomLeft.x, topRight.x),
                    ["y"] = Mathf.Min(bottomLeft.y, topRight.y),
                    ["width"] = Mathf.Abs(topRight.x - bottomLeft.x),
                    ["height"] = Mathf.Abs(topRight.y - bottomLeft.y)
                };
            }

            return info;
        }
    }
}
