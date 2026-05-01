using System;
using System.Collections.Generic;
using System.Reflection;
using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Events;

namespace McpUnity.Tools
{
    /// <summary>
    /// Tool for invoking a UnityEvent on a component (e.g. Button.onClick, Toggle.onValueChanged).
    /// Finds the target GameObject by hierarchy path (including inactive objects), scans all components
    /// for a public field or property with the given event name that derives from UnityEventBase, and calls Invoke.
    /// </summary>
    public class InvokeUIEventTool : McpToolBase
    {
        private const BindingFlags MemberFlags =
            BindingFlags.Public | BindingFlags.Instance | BindingFlags.FlattenHierarchy;

        public InvokeUIEventTool()
        {
            Name = "invoke_ui_event";
            Description =
                "Invokes a UnityEvent on a GameObject's component (e.g. Button.onClick, Toggle.onValueChanged). " +
                "Fires registered listeners but does not update component state (e.g. Toggle.isOn). " +
                "Note: goes through UnityEvent.Invoke directly, bypassing the EventSystem pointer lifecycle.";
        }

        public override JObject Execute(JObject parameters)
        {
            string objectPath = parameters["objectPath"]?.ToObject<string>();
            string eventName = parameters["eventName"]?.ToObject<string>();
            JToken valueToken = parameters["value"];

            if (string.IsNullOrEmpty(objectPath))
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    "Missing required parameter: objectPath",
                    "validation_error"
                );
            }

            if (string.IsNullOrEmpty(eventName))
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    "Missing required parameter: eventName",
                    "validation_error"
                );
            }

            GameObject go = GameObjectResolver.FindInLoadedScenes(objectPath);
            if (go == null)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"GameObject not found at path '{objectPath}'. The lookup searches loaded scenes and includes inactive objects.",
                    "not_found_error"
                );
            }

            var components = go.GetComponents<Component>();
            var triedComponents = new List<string>(components.Length);

            foreach (var comp in components)
            {
                if (comp == null) continue;

                triedComponents.Add(comp.GetType().Name);

                if (!TryGetUnityEvent(comp, eventName, out UnityEventBase unityEvent, out string memberLocation))
                {
                    continue;
                }

                MethodInfo invokeMethod = unityEvent.GetType().GetMethod("Invoke");
                if (invokeMethod == null)
                {
                    return McpUnitySocketHandler.CreateErrorResponse(
                        $"Event '{eventName}' on '{memberLocation}' has no Invoke method.",
                        "invoke_error"
                    );
                }

                try
                {
                    object[] args = BuildInvokeArgs(invokeMethod, valueToken, out string coercionNote);
                    invokeMethod.Invoke(unityEvent, args);

                    McpLogger.LogInfo($"[MCP Unity] Invoked {memberLocation} on '{objectPath}'");

                    return new JObject
                    {
                        ["success"] = true,
                        ["type"] = "text",
                        ["message"] = $"Invoked {memberLocation} on '{objectPath}'" +
                                      (string.IsNullOrEmpty(coercionNote) ? string.Empty : $" ({coercionNote})"),
                        ["component"] = comp.GetType().Name,
                        ["eventName"] = eventName,
                        ["paramCount"] = invokeMethod.GetParameters().Length
                    };
                }
                catch (TargetInvocationException tie)
                {
                    Exception inner = tie.InnerException ?? tie;
                    return McpUnitySocketHandler.CreateErrorResponse(
                        $"Listener threw while invoking {memberLocation}: {inner.Message}",
                        "listener_exception"
                    );
                }
                catch (Exception ex)
                {
                    return McpUnitySocketHandler.CreateErrorResponse(
                        $"Failed to invoke {memberLocation}: {ex.Message}",
                        "invoke_error"
                    );
                }
            }

            return McpUnitySocketHandler.CreateErrorResponse(
                $"No UnityEvent named '{eventName}' found on any component of '{objectPath}'. Components tried: {string.Join(", ", triedComponents)}",
                "event_not_found"
            );
        }

        private static bool TryGetUnityEvent(Component component, string eventName, out UnityEventBase unityEvent, out string memberLocation)
        {
            unityEvent = null;
            memberLocation = null;
            Type type = component.GetType();

            FieldInfo field = type.GetField(eventName, MemberFlags);
            if (field != null && typeof(UnityEventBase).IsAssignableFrom(field.FieldType))
            {
                unityEvent = field.GetValue(component) as UnityEventBase;
                memberLocation = $"{type.Name}.{field.Name}";
                return unityEvent != null;
            }

            PropertyInfo prop = type.GetProperty(eventName, MemberFlags);
            if (prop != null && prop.CanRead && typeof(UnityEventBase).IsAssignableFrom(prop.PropertyType))
            {
                unityEvent = prop.GetValue(component) as UnityEventBase;
                memberLocation = $"{type.Name}.{prop.Name}";
                return unityEvent != null;
            }

            return false;
        }

        private static object[] BuildInvokeArgs(MethodInfo invokeMethod, JToken valueToken, out string coercionNote)
        {
            coercionNote = null;
            ParameterInfo[] parameters = invokeMethod.GetParameters();

            if (parameters.Length == 0)
            {
                if (valueToken != null && valueToken.Type != JTokenType.Null)
                {
                    coercionNote = "value parameter ignored for UnityEvent with no args";
                }
                return Array.Empty<object>();
            }

            // UnityEvent<T0..T3> — use the first parameter only. Remaining params get defaults.
            var args = new object[parameters.Length];
            for (int i = 0; i < parameters.Length; i++)
            {
                Type paramType = parameters[i].ParameterType;
                if (i == 0 && valueToken != null && valueToken.Type != JTokenType.Null)
                {
                    args[i] = CoerceValue(valueToken, paramType);
                }
                else
                {
                    args[i] = paramType.IsValueType ? Activator.CreateInstance(paramType) : null;
                }
            }

            if ((valueToken == null || valueToken.Type == JTokenType.Null) && parameters.Length > 0)
            {
                coercionNote = $"no value provided, using default for {parameters[0].ParameterType.Name}";
            }

            return args;
        }

        private static object CoerceValue(JToken token, Type targetType)
        {
            if (targetType == typeof(string)) return token.ToObject<string>();
            if (targetType == typeof(bool)) return token.ToObject<bool>();
            if (targetType == typeof(int)) return token.ToObject<int>();
            if (targetType == typeof(long)) return token.ToObject<long>();
            if (targetType == typeof(float)) return token.ToObject<float>();
            if (targetType == typeof(double)) return token.ToObject<double>();
            return token.ToObject(targetType);
        }
    }
}
