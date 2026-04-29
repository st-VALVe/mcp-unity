using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using McpUnity.Unity;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace McpUnity.Tools
{
    internal static class UiToolUtils
    {
        private const BindingFlags PublicInstance = BindingFlags.Public | BindingFlags.Instance;
        private const BindingFlags PublicAndPrivateInstance = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;

        public static JObject FindTarget(JObject parameters, out GameObject gameObject, out string identifierInfo)
        {
            int? instanceId = parameters["instanceId"]?.ToObject<int?>();
            string objectPath = parameters["objectPath"]?.ToObject<string>();
            return GameObjectToolUtils.FindGameObject(instanceId, objectPath, out gameObject, out identifierInfo);
        }

        public static EventSystem EnsureEventSystem()
        {
            EventSystem eventSystem = EventSystem.current ?? UnityEngine.Object.FindObjectOfType<EventSystem>();
            if (eventSystem != null)
            {
                return eventSystem;
            }

            GameObject eventSystemObject = new GameObject("EventSystem");
            if (!Application.isPlaying)
            {
                Undo.RegisterCreatedObjectUndo(eventSystemObject, "Create EventSystem");
            }

            eventSystem = eventSystemObject.AddComponent<EventSystem>();
            eventSystemObject.AddComponent<StandaloneInputModule>();
            return eventSystem;
        }

        public static Vector2 ResolveScreenPosition(GameObject targetObject, JObject parameters)
        {
            JObject screenPosition = parameters["screenPosition"] as JObject;
            if (screenPosition != null)
            {
                return new Vector2(
                    screenPosition["x"]?.ToObject<float>() ?? 0f,
                    screenPosition["y"]?.ToObject<float>() ?? 0f
                );
            }

            RectTransform rectTransform = targetObject.GetComponent<RectTransform>();
            if (rectTransform != null)
            {
                Vector3[] corners = new Vector3[4];
                rectTransform.GetWorldCorners(corners);
                Vector3 worldCenter = (corners[0] + corners[2]) * 0.5f;

                Canvas canvas = targetObject.GetComponentInParent<Canvas>();
                Camera camera = canvas != null && canvas.renderMode != RenderMode.ScreenSpaceOverlay
                    ? canvas.worldCamera
                    : null;

                return RectTransformUtility.WorldToScreenPoint(camera, worldCenter);
            }

            Camera mainCamera = Camera.main;
            if (mainCamera != null)
            {
                return mainCamera.WorldToScreenPoint(targetObject.transform.position);
            }

            return Vector2.zero;
        }

        public static PointerEventData CreatePointerData(EventSystem eventSystem, GameObject targetObject, JObject parameters)
        {
            PointerEventData pointerData = new PointerEventData(eventSystem)
            {
                pointerId = -1,
                button = ParseInputButton(parameters["button"]?.ToObject<string>()),
                clickCount = Math.Max(1, parameters["clickCount"]?.ToObject<int?>() ?? 1),
                position = ResolveScreenPosition(targetObject, parameters),
                pressPosition = ResolveScreenPosition(targetObject, parameters),
                rawPointerPress = targetObject
            };

            return pointerData;
        }

        private static PointerEventData.InputButton ParseInputButton(string buttonName)
        {
            if (string.IsNullOrWhiteSpace(buttonName))
            {
                return PointerEventData.InputButton.Left;
            }

            if (Enum.TryParse(buttonName, true, out PointerEventData.InputButton parsed))
            {
                return parsed;
            }

            return PointerEventData.InputButton.Left;
        }

        public static Component FindComponent(GameObject targetObject, string componentName, bool searchParents = false, bool searchChildren = false)
        {
            if (targetObject == null || string.IsNullOrWhiteSpace(componentName))
            {
                return null;
            }

            Component component = targetObject.GetComponent(componentName);
            if (component != null)
            {
                return component;
            }

            component = FindMatchingComponent(targetObject.GetComponents<Component>(), componentName);
            if (component != null)
            {
                return component;
            }

            if (searchParents)
            {
                component = FindMatchingComponent(targetObject.GetComponentsInParent<Component>(true), componentName);
                if (component != null)
                {
                    return component;
                }
            }

            if (searchChildren)
            {
                component = FindMatchingComponent(targetObject.GetComponentsInChildren<Component>(true), componentName);
            }

            return component;
        }

        public static T FindComponent<T>(GameObject targetObject, bool searchParents, bool searchChildren) where T : Component
        {
            T component = targetObject.GetComponent<T>();
            if (component != null)
            {
                return component;
            }

            if (searchParents)
            {
                component = targetObject.GetComponentInParent<T>(true);
                if (component != null)
                {
                    return component;
                }
            }

            if (searchChildren)
            {
                component = targetObject.GetComponentInChildren<T>(true);
            }

            return component;
        }

        private static Component FindMatchingComponent(IEnumerable<Component> components, string componentName)
        {
            foreach (Component component in components)
            {
                if (component == null)
                {
                    continue;
                }

                Type type = component.GetType();
                if (string.Equals(type.Name, componentName, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(type.FullName, componentName, StringComparison.OrdinalIgnoreCase))
                {
                    return component;
                }
            }

            return null;
        }

        public static bool TryConvertArgument(JToken token, Type targetType, out object value, out string errorMessage)
        {
            value = null;
            errorMessage = null;

            if (targetType == typeof(JToken) || targetType == typeof(JObject) || targetType == typeof(JArray))
            {
                value = token;
                return true;
            }

            Type nullableType = Nullable.GetUnderlyingType(targetType);
            if (nullableType != null)
            {
                if (token == null || token.Type == JTokenType.Null)
                {
                    value = null;
                    return true;
                }

                targetType = nullableType;
            }

            if (token == null || token.Type == JTokenType.Null)
            {
                if (!targetType.IsValueType)
                {
                    value = null;
                    return true;
                }

                errorMessage = $"Cannot convert null to value type {targetType.Name}.";
                return false;
            }

            try
            {
                if (targetType == typeof(string))
                {
                    value = token.ToObject<string>();
                    return true;
                }

                if (targetType == typeof(DateTime))
                {
                    return TryConvertDateTime(token, out value, out errorMessage);
                }

                if (targetType == typeof(Vector2) && token.Type == JTokenType.Object)
                {
                    JObject vector = (JObject)token;
                    value = new Vector2(vector["x"]?.ToObject<float>() ?? 0f, vector["y"]?.ToObject<float>() ?? 0f);
                    return true;
                }

                if (targetType == typeof(Vector3) && token.Type == JTokenType.Object)
                {
                    JObject vector = (JObject)token;
                    value = new Vector3(
                        vector["x"]?.ToObject<float>() ?? 0f,
                        vector["y"]?.ToObject<float>() ?? 0f,
                        vector["z"]?.ToObject<float>() ?? 0f
                    );
                    return true;
                }

                if (targetType == typeof(Vector4) && token.Type == JTokenType.Object)
                {
                    JObject vector = (JObject)token;
                    value = new Vector4(
                        vector["x"]?.ToObject<float>() ?? 0f,
                        vector["y"]?.ToObject<float>() ?? 0f,
                        vector["z"]?.ToObject<float>() ?? 0f,
                        vector["w"]?.ToObject<float>() ?? 0f
                    );
                    return true;
                }

                if (targetType == typeof(Quaternion) && token.Type == JTokenType.Object)
                {
                    JObject quaternion = (JObject)token;
                    value = new Quaternion(
                        quaternion["x"]?.ToObject<float>() ?? 0f,
                        quaternion["y"]?.ToObject<float>() ?? 0f,
                        quaternion["z"]?.ToObject<float>() ?? 0f,
                        quaternion["w"]?.ToObject<float>() ?? 1f
                    );
                    return true;
                }

                if (targetType == typeof(Color) && token.Type == JTokenType.Object)
                {
                    JObject color = (JObject)token;
                    value = new Color(
                        color["r"]?.ToObject<float>() ?? 0f,
                        color["g"]?.ToObject<float>() ?? 0f,
                        color["b"]?.ToObject<float>() ?? 0f,
                        color["a"]?.ToObject<float>() ?? 1f
                    );
                    return true;
                }

                if (targetType == typeof(Rect) && token.Type == JTokenType.Object)
                {
                    JObject rect = (JObject)token;
                    value = new Rect(
                        rect["x"]?.ToObject<float>() ?? 0f,
                        rect["y"]?.ToObject<float>() ?? 0f,
                        rect["width"]?.ToObject<float>() ?? 0f,
                        rect["height"]?.ToObject<float>() ?? 0f
                    );
                    return true;
                }

                if (typeof(UnityEngine.Object).IsAssignableFrom(targetType))
                {
                    return TryConvertUnityObject(token, targetType, out value, out errorMessage);
                }

                if (targetType.IsEnum)
                {
                    return TryConvertEnum(token, targetType, out value, out errorMessage);
                }

                value = token.ToObject(targetType);
                return true;
            }
            catch (Exception ex)
            {
                errorMessage = $"Cannot convert argument to {targetType.Name}: {ex.Message}";
                return false;
            }
        }

        private static bool TryConvertDateTime(JToken token, out object value, out string errorMessage)
        {
            value = null;
            errorMessage = null;

            if (token.Type == JTokenType.String)
            {
                string text = token.ToObject<string>();
                string[] formats =
                {
                    "O",
                    "yyyy-MM-ddTHH:mm:ss",
                    "yyyy-MM-dd",
                    "MM/dd/yyyy",
                    "dd/MM/yyyy",
                    "dd.MM.yyyy",
                    "MM.dd.yyyy"
                };

                if (DateTime.TryParseExact(text, formats, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out DateTime exactDateTime) ||
                    DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out exactDateTime))
                {
                    value = exactDateTime;
                    return true;
                }

                errorMessage = $"Cannot parse '{text}' as DateTime.";
                return false;
            }

            if (token.Type == JTokenType.Object)
            {
                JObject date = (JObject)token;
                int year = date["year"]?.ToObject<int>() ?? 1;
                int month = date["month"]?.ToObject<int>() ?? 1;
                int day = date["day"]?.ToObject<int>() ?? 1;
                value = new DateTime(year, month, day);
                return true;
            }

            errorMessage = $"Cannot convert token type {token.Type} to DateTime.";
            return false;
        }

        private static bool TryConvertEnum(JToken token, Type targetType, out object value, out string errorMessage)
        {
            value = null;
            errorMessage = null;

            if (token.Type == JTokenType.String)
            {
                string enumName = token.ToObject<string>();
                if (Enum.TryParse(targetType, enumName, true, out object parsedEnum))
                {
                    value = parsedEnum;
                    return true;
                }

                if (int.TryParse(enumName, out int numericEnumValue))
                {
                    value = Enum.ToObject(targetType, numericEnumValue);
                    return true;
                }
            }

            if (token.Type == JTokenType.Integer)
            {
                value = Enum.ToObject(targetType, token.ToObject<int>());
                return true;
            }

            errorMessage = $"Cannot convert token type {token.Type} to enum {targetType.Name}.";
            return false;
        }

        private static bool TryConvertUnityObject(JToken token, Type targetType, out object value, out string errorMessage)
        {
            value = null;
            errorMessage = null;

            if (token.Type == JTokenType.Integer)
            {
                UnityEngine.Object unityObject = EditorUtility.InstanceIDToObject(token.ToObject<int>());
                if (unityObject == null || !targetType.IsInstanceOfType(unityObject))
                {
                    errorMessage = $"Instance ID does not reference a {targetType.Name}.";
                    return false;
                }

                value = unityObject;
                return true;
            }

            if (token.Type == JTokenType.Object)
            {
                JObject objectRef = (JObject)token;
                int? instanceId = objectRef["instanceId"]?.ToObject<int?>();
                string objectPath = objectRef["objectPath"]?.ToObject<string>();

                JObject error = GameObjectToolUtils.FindGameObject(instanceId, objectPath, out GameObject gameObject, out _);
                if (error != null)
                {
                    errorMessage = error["error"]?["message"]?.ToObject<string>() ?? "Could not resolve Unity object reference.";
                    return false;
                }

                if (targetType == typeof(GameObject))
                {
                    value = gameObject;
                    return true;
                }

                Component component = gameObject.GetComponent(targetType);
                if (component != null)
                {
                    value = component;
                    return true;
                }
            }

            errorMessage = $"Cannot convert token type {token.Type} to Unity object {targetType.Name}.";
            return false;
        }

        public static object GetMemberValue(object source, string memberName)
        {
            if (source == null)
            {
                return null;
            }

            Type type = source.GetType();
            PropertyInfo propertyInfo = type.GetProperty(memberName, PublicAndPrivateInstance);
            if (propertyInfo != null)
            {
                return propertyInfo.GetValue(source);
            }

            FieldInfo fieldInfo = type.GetField(memberName, PublicAndPrivateInstance);
            return fieldInfo?.GetValue(source);
        }

        public static void InvokeStringUnityEvent(object unityEvent, string text)
        {
            MethodInfo invokeMethod = unityEvent?.GetType().GetMethod("Invoke", PublicInstance, null, new[] { typeof(string) }, null);
            invokeMethod?.Invoke(unityEvent, new object[] { text });
        }
    }

    /// <summary>
    /// Tool for clicking Unity UI objects through EventSystem events.
    /// </summary>
    public class ClickUiTool : McpToolBase
    {
        public ClickUiTool()
        {
            Name = "click_ui";
            Description = "Clicks a Unity UI GameObject by hierarchy path or instance ID using EventSystem pointer events.";
            IsAsync = false;
        }

        public override JObject Execute(JObject parameters)
        {
            JObject error = UiToolUtils.FindTarget(parameters, out GameObject targetObject, out string identifierInfo);
            if (error != null) return error;

            bool forceButtonInvoke = parameters["forceButtonInvoke"]?.ToObject<bool?>() ?? true;
            bool sendSubmit = parameters["sendSubmit"]?.ToObject<bool?>() ?? false;

            EventSystem eventSystem = UiToolUtils.EnsureEventSystem();
            PointerEventData pointerData = UiToolUtils.CreatePointerData(eventSystem, targetObject, parameters);

            eventSystem.SetSelectedGameObject(targetObject);

            GameObject enterHandler = ExecuteEvents.ExecuteHierarchy(targetObject, pointerData, ExecuteEvents.pointerEnterHandler);
            GameObject downHandler = ExecuteEvents.ExecuteHierarchy(targetObject, pointerData, ExecuteEvents.pointerDownHandler);
            pointerData.pointerPress = downHandler;
            GameObject upHandler = ExecuteEvents.ExecuteHierarchy(targetObject, pointerData, ExecuteEvents.pointerUpHandler);
            GameObject clickHandler = ExecuteEvents.ExecuteHierarchy(targetObject, pointerData, ExecuteEvents.pointerClickHandler);

            bool fallbackInvoked = false;
            if (clickHandler == null && forceButtonInvoke)
            {
                Button button = targetObject.GetComponent<Button>() ?? targetObject.GetComponentInParent<Button>(true);
                if (button != null && button.IsActive() && button.IsInteractable())
                {
                    button.onClick.Invoke();
                    fallbackInvoked = true;
                }
            }

            GameObject submitHandler = null;
            if (sendSubmit)
            {
                submitHandler = ExecuteEvents.ExecuteHierarchy(targetObject, pointerData, ExecuteEvents.submitHandler);
            }

            Canvas.ForceUpdateCanvases();

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = $"Clicked UI GameObject '{targetObject.name}' using {identifierInfo}.",
                ["target"] = new JObject
                {
                    ["instanceId"] = targetObject.GetInstanceID(),
                    ["name"] = targetObject.name,
                    ["path"] = GameObjectToolUtils.GetGameObjectPath(targetObject)
                },
                ["screenPosition"] = new JObject
                {
                    ["x"] = pointerData.position.x,
                    ["y"] = pointerData.position.y
                },
                ["handled"] = new JObject
                {
                    ["pointerEnter"] = enterHandler != null,
                    ["pointerDown"] = downHandler != null,
                    ["pointerUp"] = upHandler != null,
                    ["pointerClick"] = clickHandler != null,
                    ["buttonFallback"] = fallbackInvoked,
                    ["submit"] = submitHandler != null
                }
            };
        }
    }

    /// <summary>
    /// Tool for scrolling Unity ScrollRect components or dispatching scroll events.
    /// </summary>
    public class ScrollUiTool : McpToolBase
    {
        public ScrollUiTool()
        {
            Name = "scroll_ui";
            Description = "Scrolls a Unity UI ScrollRect by normalized position/delta and can dispatch an EventSystem scroll event.";
            IsAsync = false;
        }

        public override JObject Execute(JObject parameters)
        {
            JObject error = UiToolUtils.FindTarget(parameters, out GameObject targetObject, out string identifierInfo);
            if (error != null) return error;

            bool searchParents = parameters["searchParents"]?.ToObject<bool?>() ?? true;
            bool searchChildren = parameters["searchChildren"]?.ToObject<bool?>() ?? false;
            bool clamp = parameters["clamp"]?.ToObject<bool?>() ?? true;
            bool dispatchScrollEvent = parameters["dispatchScrollEvent"]?.ToObject<bool?>() ?? true;

            ScrollRect scrollRect = UiToolUtils.FindComponent<ScrollRect>(targetObject, searchParents, searchChildren);
            if (scrollRect == null)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"ScrollRect not found on or near GameObject '{targetObject.name}'.",
                    "component_error"
                );
            }

            Vector2 before = scrollRect.normalizedPosition;
            float horizontal = scrollRect.horizontalNormalizedPosition;
            float vertical = scrollRect.verticalNormalizedPosition;

            if (parameters["horizontalNormalizedPosition"] != null)
            {
                horizontal = parameters["horizontalNormalizedPosition"].ToObject<float>();
            }

            if (parameters["verticalNormalizedPosition"] != null)
            {
                vertical = parameters["verticalNormalizedPosition"].ToObject<float>();
            }

            horizontal += parameters["horizontalDelta"]?.ToObject<float?>() ?? 0f;
            vertical += parameters["verticalDelta"]?.ToObject<float?>() ?? 0f;

            if (clamp)
            {
                horizontal = Mathf.Clamp01(horizontal);
                vertical = Mathf.Clamp01(vertical);
            }

            Undo.RecordObject(scrollRect, "Scroll UI");
            scrollRect.horizontalNormalizedPosition = horizontal;
            scrollRect.verticalNormalizedPosition = vertical;
            scrollRect.onValueChanged.Invoke(scrollRect.normalizedPosition);

            GameObject scrollHandler = null;
            if (dispatchScrollEvent)
            {
                EventSystem eventSystem = UiToolUtils.EnsureEventSystem();
                PointerEventData pointerData = UiToolUtils.CreatePointerData(eventSystem, targetObject, parameters);
                pointerData.scrollDelta = new Vector2(
                    parameters["horizontalWheelDelta"]?.ToObject<float?>() ?? parameters["horizontalDelta"]?.ToObject<float?>() ?? 0f,
                    parameters["verticalWheelDelta"]?.ToObject<float?>() ?? parameters["verticalDelta"]?.ToObject<float?>() ?? 0f
                );
                scrollHandler = ExecuteEvents.ExecuteHierarchy(targetObject, pointerData, ExecuteEvents.scrollHandler);
            }

            Canvas.ForceUpdateCanvases();
            EditorUtility.SetDirty(scrollRect);

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = $"Scrolled UI GameObject '{targetObject.name}' using {identifierInfo}.",
                ["target"] = new JObject
                {
                    ["instanceId"] = targetObject.GetInstanceID(),
                    ["name"] = targetObject.name,
                    ["path"] = GameObjectToolUtils.GetGameObjectPath(targetObject)
                },
                ["scrollRect"] = new JObject
                {
                    ["instanceId"] = scrollRect.gameObject.GetInstanceID(),
                    ["name"] = scrollRect.gameObject.name,
                    ["path"] = GameObjectToolUtils.GetGameObjectPath(scrollRect.gameObject)
                },
                ["before"] = new JObject
                {
                    ["x"] = before.x,
                    ["y"] = before.y
                },
                ["after"] = new JObject
                {
                    ["x"] = scrollRect.normalizedPosition.x,
                    ["y"] = scrollRect.normalizedPosition.y
                },
                ["scrollEventHandled"] = scrollHandler != null
            };
        }
    }

    /// <summary>
    /// Tool for setting common Unity UI text/input components.
    /// </summary>
    public class SetUiInputTextTool : McpToolBase
    {
        public SetUiInputTextTool()
        {
            Name = "set_ui_input_text";
            Description = "Sets text on Unity UI InputField, TMP_InputField, Text, and TMP_Text components.";
            IsAsync = false;
        }

        public override JObject Execute(JObject parameters)
        {
            JObject error = UiToolUtils.FindTarget(parameters, out GameObject targetObject, out string identifierInfo);
            if (error != null) return error;

            if (parameters["text"] == null)
            {
                return McpUnitySocketHandler.CreateErrorResponse("Required parameter 'text' not provided.", "validation_error");
            }

            string text = parameters["text"].ToObject<string>() ?? string.Empty;
            bool notify = parameters["notify"]?.ToObject<bool?>() ?? true;
            bool submit = parameters["submit"]?.ToObject<bool?>() ?? false;
            bool searchChildren = parameters["searchChildren"]?.ToObject<bool?>() ?? false;
            bool searchParents = parameters["searchParents"]?.ToObject<bool?>() ?? false;

            List<string> appliedTo = new List<string>();

            InputField inputField = UiToolUtils.FindComponent<InputField>(targetObject, searchParents, searchChildren);
            if (inputField != null)
            {
                Undo.RecordObject(inputField, "Set UI Input Text");
                if (notify)
                {
                    inputField.text = text;
                }
                else
                {
                    inputField.SetTextWithoutNotify(text);
                }

                if (submit)
                {
                    inputField.onEndEdit.Invoke(text);
                }

                EditorUtility.SetDirty(inputField);
                appliedTo.Add(inputField.GetType().FullName);
            }

            Component tmpInputField = FindTextLikeComponent(targetObject, "TMP_InputField", searchParents, searchChildren);
            if (tmpInputField != null && TrySetReflectedText(tmpInputField, text, notify, submit, out string tmpInputAppliedTo))
            {
                appliedTo.Add(tmpInputAppliedTo);
            }

            Text uiText = UiToolUtils.FindComponent<Text>(targetObject, searchParents, searchChildren);
            if (uiText != null)
            {
                Undo.RecordObject(uiText, "Set UI Text");
                uiText.text = text;
                EditorUtility.SetDirty(uiText);
                appliedTo.Add(uiText.GetType().FullName);
            }

            Component tmpText = FindTextLikeComponent(targetObject, "TMP_Text", searchParents, searchChildren);
            if (tmpText != null && TrySetReflectedText(tmpText, text, notify: false, submit: false, out string tmpTextAppliedTo))
            {
                appliedTo.Add(tmpTextAppliedTo);
            }

            if (appliedTo.Count == 0)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"No supported text or input component found on or near GameObject '{targetObject.name}'.",
                    "component_error"
                );
            }

            Canvas.ForceUpdateCanvases();

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = $"Set UI text on GameObject '{targetObject.name}' using {identifierInfo}.",
                ["target"] = new JObject
                {
                    ["instanceId"] = targetObject.GetInstanceID(),
                    ["name"] = targetObject.name,
                    ["path"] = GameObjectToolUtils.GetGameObjectPath(targetObject)
                },
                ["appliedTo"] = new JArray(appliedTo),
                ["text"] = text
            };
        }

        private static Component FindTextLikeComponent(GameObject targetObject, string typeName, bool searchParents, bool searchChildren)
        {
            Component component = UiToolUtils.FindComponent(targetObject, typeName, searchParents, searchChildren);
            if (component != null)
            {
                return component;
            }

            IEnumerable<Component> components = targetObject.GetComponents<Component>();
            if (searchParents)
            {
                components = components.Concat(targetObject.GetComponentsInParent<Component>(true));
            }

            if (searchChildren)
            {
                components = components.Concat(targetObject.GetComponentsInChildren<Component>(true));
            }

            foreach (Component candidate in components)
            {
                if (candidate == null)
                {
                    continue;
                }

                Type type = candidate.GetType();
                if (type.Name == typeName || IsSubclassNamed(type, typeName))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static bool IsSubclassNamed(Type type, string typeName)
        {
            while (type != null)
            {
                if (type.Name == typeName)
                {
                    return true;
                }

                type = type.BaseType;
            }

            return false;
        }

        private static bool TrySetReflectedText(Component component, string text, bool notify, bool submit, out string appliedTo)
        {
            appliedTo = null;
            if (component == null)
            {
                return false;
            }

            Type type = component.GetType();
            Undo.RecordObject(component, "Set UI Text");

            MethodInfo setWithoutNotify = type.GetMethod(
                "SetTextWithoutNotify",
                BindingFlags.Public | BindingFlags.Instance,
                null,
                new[] { typeof(string) },
                null
            );

            if (!notify && setWithoutNotify != null)
            {
                setWithoutNotify.Invoke(component, new object[] { text });
            }
            else
            {
                PropertyInfo textProperty = type.GetProperty("text", BindingFlags.Public | BindingFlags.Instance);
                if (textProperty == null || !textProperty.CanWrite)
                {
                    return false;
                }

                textProperty.SetValue(component, text);
            }

            if (submit)
            {
                UiToolUtils.InvokeStringUnityEvent(UiToolUtils.GetMemberValue(component, "onEndEdit"), text);
                UiToolUtils.InvokeStringUnityEvent(UiToolUtils.GetMemberValue(component, "onSubmit"), text);
            }

            EditorUtility.SetDirty(component);
            appliedTo = type.FullName;
            return true;
        }
    }

    /// <summary>
    /// Tool for invoking a component method on a GameObject.
    /// </summary>
    public class InvokeComponentMethodTool : McpToolBase
    {
        public InvokeComponentMethodTool()
        {
            Name = "invoke_component_method";
            Description = "Invokes a method on a component attached to a GameObject, with optional non-public method access.";
            IsAsync = false;
        }

        public override JObject Execute(JObject parameters)
        {
            JObject error = UiToolUtils.FindTarget(parameters, out GameObject targetObject, out string identifierInfo);
            if (error != null) return error;

            string componentName = parameters["componentName"]?.ToObject<string>();
            string methodName = parameters["methodName"]?.ToObject<string>();
            bool includeNonPublic = parameters["includeNonPublic"]?.ToObject<bool?>() ?? false;
            bool searchParents = parameters["searchParents"]?.ToObject<bool?>() ?? false;
            bool searchChildren = parameters["searchChildren"]?.ToObject<bool?>() ?? false;
            JArray arguments = parameters["arguments"] as JArray ?? new JArray();

            if (string.IsNullOrWhiteSpace(componentName))
            {
                return McpUnitySocketHandler.CreateErrorResponse("Required parameter 'componentName' not provided.", "validation_error");
            }

            if (string.IsNullOrWhiteSpace(methodName))
            {
                return McpUnitySocketHandler.CreateErrorResponse("Required parameter 'methodName' not provided.", "validation_error");
            }

            Component component = UiToolUtils.FindComponent(targetObject, componentName, searchParents, searchChildren);
            if (component == null)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"Component '{componentName}' not found on or near GameObject '{targetObject.name}'.",
                    "component_error"
                );
            }

            if (!TryFindMethod(component.GetType(), methodName, arguments, includeNonPublic, out MethodInfo methodInfo, out object[] convertedArguments, out string methodError))
            {
                return McpUnitySocketHandler.CreateErrorResponse(methodError, "method_error");
            }

            Undo.RecordObject(component, $"Invoke {methodName}");
            object returnValue = methodInfo.Invoke(component, convertedArguments);
            EditorUtility.SetDirty(component);

            JObject response = new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = $"Invoked '{methodInfo.Name}' on component '{component.GetType().Name}' using {identifierInfo}.",
                ["target"] = new JObject
                {
                    ["instanceId"] = targetObject.GetInstanceID(),
                    ["name"] = targetObject.name,
                    ["path"] = GameObjectToolUtils.GetGameObjectPath(targetObject)
                },
                ["component"] = component.GetType().FullName,
                ["method"] = methodInfo.Name
            };

            if (methodInfo.ReturnType != typeof(void))
            {
                response["returnValue"] = JToken.FromObject(returnValue ?? string.Empty);
            }

            return response;
        }

        private static bool TryFindMethod(Type componentType, string methodName, JArray arguments, bool includeNonPublic, out MethodInfo methodInfo, out object[] convertedArguments, out string errorMessage)
        {
            methodInfo = null;
            convertedArguments = null;
            errorMessage = null;

            BindingFlags bindingFlags = BindingFlags.Instance | BindingFlags.Public;
            if (includeNonPublic)
            {
                bindingFlags |= BindingFlags.NonPublic;
            }

            MethodInfo[] candidates = componentType
                .GetMethods(bindingFlags)
                .Where(method => string.Equals(method.Name, methodName, StringComparison.Ordinal))
                .ToArray();

            if (candidates.Length == 0)
            {
                errorMessage = $"Method '{methodName}' not found on component '{componentType.Name}'.";
                return false;
            }

            List<string> conversionErrors = new List<string>();
            foreach (MethodInfo candidate in candidates)
            {
                ParameterInfo[] parameterInfos = candidate.GetParameters();
                if (parameterInfos.Length != arguments.Count)
                {
                    continue;
                }

                object[] candidateArguments = new object[arguments.Count];
                bool conversionSucceeded = true;

                for (int i = 0; i < parameterInfos.Length; i++)
                {
                    if (!UiToolUtils.TryConvertArgument(arguments[i], parameterInfos[i].ParameterType, out object convertedValue, out string argumentError))
                    {
                        conversionErrors.Add($"Argument {i}: {argumentError}");
                        conversionSucceeded = false;
                        break;
                    }

                    candidateArguments[i] = convertedValue;
                }

                if (conversionSucceeded)
                {
                    methodInfo = candidate;
                    convertedArguments = candidateArguments;
                    return true;
                }
            }

            errorMessage = conversionErrors.Count > 0
                ? $"No overload for '{methodName}' accepted the provided arguments. {string.Join(" ", conversionErrors)}"
                : $"No overload for '{methodName}' accepts {arguments.Count} argument(s).";
            return false;
        }
    }
}
