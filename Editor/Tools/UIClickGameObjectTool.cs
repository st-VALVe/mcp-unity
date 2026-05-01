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
    /// Tool for performing an "honest" pointer click on a GameObject through Unity's EventSystem.
    /// Unlike <see cref="InvokeUIEventTool"/>, which calls onClick.Invoke() directly, this tool fires the full
    /// pointer lifecycle (Enter / Down / Up / Click / Exit) at the GameObject's screen-space center,
    /// going through GraphicRaycaster / PhysicsRaycaster. Visual transitions and hover states play normally,
    /// and occlusion by other UI is detected and reported as an error.
    /// Requires Play Mode and an active EventSystem.
    /// </summary>
    public class UIClickGameObjectTool : McpToolBase
    {
        public UIClickGameObjectTool()
        {
            Name = "ui_click_gameobject";
            Description =
                "Performs a pointer click on a GameObject through the EventSystem. Computes the screen-space center " +
                "of the target's RectTransform (or transform position for 3D), raycasts, and fires the full " +
                "PointerEnter/Down/Up/Click/Exit sequence on the topmost hit. Detects occlusion by other UI. " +
                "Requires Play Mode and an active EventSystem.";
        }

        public override JObject Execute(JObject parameters)
        {
            string objectPath = parameters["objectPath"]?.ToObject<string>();

            if (string.IsNullOrEmpty(objectPath))
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    "Missing required parameter: objectPath",
                    "validation_error"
                );
            }

            if (!Application.isPlaying)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    "ui_click_gameobject requires Play Mode. Use enter_play_mode first.",
                    "not_in_play_mode"
                );
            }

            EventSystem eventSystem = EventSystem.current;
            if (eventSystem == null)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    "No active EventSystem in the scene. UGUI clicks cannot be dispatched.",
                    "no_event_system"
                );
            }

            GameObject target = GameObjectResolver.FindInLoadedScenes(objectPath);
            if (target == null)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"GameObject not found at path '{objectPath}'.",
                    "not_found_error"
                );
            }

            if (!target.activeInHierarchy)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"GameObject '{objectPath}' is not active in the hierarchy and cannot receive clicks.",
                    "not_active"
                );
            }

            if (!IsCanvasGroupInteractable(target.transform, out string blockingGroup))
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"GameObject '{objectPath}' is blocked by CanvasGroup on '{blockingGroup}' (interactable=false or blocksRaycasts=false).",
                    "not_interactable"
                );
            }

            // Compute screen-space position for the click.
            if (!TryGetScreenPoint(target, out Vector2 screenPos, out string positionError))
            {
                return McpUnitySocketHandler.CreateErrorResponse(positionError, "screen_position_error");
            }

            // Raycast through the EventSystem to find what's actually under the pointer.
            var pointerData = new PointerEventData(eventSystem)
            {
                position = screenPos,
                button = PointerEventData.InputButton.Left
            };

            var results = new List<RaycastResult>();
            eventSystem.RaycastAll(pointerData, results);

            if (results.Count == 0)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"No raycaster hit at screen position ({screenPos.x:F0}, {screenPos.y:F0}). " +
                    "Either the GameObject is off-screen, behind the camera, or its Canvas has no GraphicRaycaster.",
                    "no_raycast_hit"
                );
            }

            RaycastResult topHit = results[0];
            GameObject hitObject = topHit.gameObject;

            if (!IsTargetOrDescendant(hitObject.transform, target.transform))
            {
                string topPath = GameObjectResolver.GetHierarchyPath(hitObject);
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"Target '{objectPath}' is occluded by '{topPath}' at screen ({screenPos.x:F0}, {screenPos.y:F0}). " +
                    "Click was not dispatched.",
                    "occluded"
                );
            }

            // Wire raycast results into pointerData so handlers see a realistic event.
            pointerData.pointerCurrentRaycast = topHit;
            pointerData.pointerPressRaycast = topHit;

            // Mirror StandaloneInputModule's dispatch order. ExecuteHierarchy walks up to find a handler,
            // so child Images on a Button will still fire the Button's handlers.
            ExecuteEvents.ExecuteHierarchy(hitObject, pointerData, ExecuteEvents.pointerEnterHandler);

            GameObject pressed = ExecuteEvents.ExecuteHierarchy(hitObject, pointerData, ExecuteEvents.pointerDownHandler);
            if (pressed == null)
            {
                pressed = ExecuteEvents.GetEventHandler<IPointerClickHandler>(hitObject);
            }

            ExecuteEvents.Execute(pressed, pointerData, ExecuteEvents.pointerUpHandler);
            GameObject clickHandler = ExecuteEvents.ExecuteHierarchy(
                pressed ?? hitObject, pointerData, ExecuteEvents.pointerClickHandler);

            ExecuteEvents.ExecuteHierarchy(hitObject, pointerData, ExecuteEvents.pointerExitHandler);

            string handlerPath = clickHandler != null
                ? GameObjectResolver.GetHierarchyPath(clickHandler)
                : GameObjectResolver.GetHierarchyPath(hitObject);

            McpLogger.LogInfo(
                $"[MCP Unity] Clicked '{objectPath}' at ({screenPos.x:F0}, {screenPos.y:F0}); " +
                $"handler='{handlerPath}', hit='{GameObjectResolver.GetHierarchyPath(hitObject)}'");

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = $"Clicked '{objectPath}' at screen ({screenPos.x:F0}, {screenPos.y:F0}). " +
                              $"Handler: '{handlerPath}'.",
                ["target"] = objectPath,
                ["hitObject"] = GameObjectResolver.GetHierarchyPath(hitObject),
                ["clickHandler"] = handlerPath,
                ["screenPosition"] = new JObject
                {
                    ["x"] = screenPos.x,
                    ["y"] = screenPos.y
                }
            };
        }

        /// <summary>
        /// Resolve a screen-space click position for the target.
        /// For UI: use the RectTransform world position projected through the Canvas's render camera.
        /// For 3D / non-UI: project transform.position through Camera.main.
        /// </summary>
        private static bool TryGetScreenPoint(GameObject target, out Vector2 screenPos, out string error)
        {
            screenPos = default;
            error = null;

            var rect = target.transform as RectTransform;
            if (rect != null)
            {
                Canvas canvas = rect.GetComponentInParent<Canvas>();
                if (canvas == null)
                {
                    error = $"RectTransform on '{target.name}' has no parent Canvas; cannot project to screen space.";
                    return false;
                }

                Camera cam = canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : canvas.worldCamera;
                Vector3 worldCenter = rect.TransformPoint(rect.rect.center);
                screenPos = RectTransformUtility.WorldToScreenPoint(cam, worldCenter);
                return true;
            }

            Camera mainCam = Camera.main;
            if (mainCam == null)
            {
                error = $"GameObject '{target.name}' is not UI and Camera.main is null; cannot project to screen space.";
                return false;
            }

            Vector3 screen3D = mainCam.WorldToScreenPoint(target.transform.position);
            if (screen3D.z < 0f)
            {
                error = $"GameObject '{target.name}' is behind Camera.main (screen z={screen3D.z:F2}).";
                return false;
            }

            screenPos = new Vector2(screen3D.x, screen3D.y);
            return true;
        }

        /// <summary>
        /// Walk up from a candidate transform; return true if it equals the target or one of its descendants.
        /// </summary>
        private static bool IsTargetOrDescendant(Transform candidate, Transform target)
        {
            while (candidate != null)
            {
                if (candidate == target) return true;
                candidate = candidate.parent;
            }
            return false;
        }

        /// <summary>
        /// Walk up the transform chain checking every CanvasGroup. Returns false if any group has
        /// interactable=false or blocksRaycasts=false (and ignoreParentGroups stops the walk early).
        /// </summary>
        private static bool IsCanvasGroupInteractable(Transform start, out string blockingGroupPath)
        {
            blockingGroupPath = null;
            Transform current = start;
            while (current != null)
            {
                CanvasGroup group = current.GetComponent<CanvasGroup>();
                if (group != null)
                {
                    if (!group.interactable || !group.blocksRaycasts)
                    {
                        blockingGroupPath = GameObjectResolver.GetHierarchyPath(current.gameObject);
                        return false;
                    }
                    if (group.ignoreParentGroups) break;
                }
                current = current.parent;
            }
            return true;
        }
    }
}
