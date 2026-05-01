using System;
using System.Reflection;
using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

namespace McpUnity.Tools
{
    /// <summary>
    /// Tool for setting the text of a uGUI InputField or TextMeshPro TMP_InputField,
    /// optionally triggering the onEndEdit event after the assignment.
    /// TMP support is via reflection so the package has no hard dependency on TextMeshPro.
    /// </summary>
    public class SetInputFieldTool : McpToolBase
    {
        private const string TmpInputFieldTypeName = "TMPro.TMP_InputField, Unity.TextMeshPro";
        private const BindingFlags MemberFlags = BindingFlags.Public | BindingFlags.Instance | BindingFlags.FlattenHierarchy;

        private static readonly Type TmpInputFieldType = Type.GetType(TmpInputFieldTypeName);

        public SetInputFieldTool()
        {
            Name = "set_input_field";
            Description =
                "Sets the text on an InputField or TMP_InputField on the target GameObject. " +
                "Records Undo and optionally fires onEndEdit(text) after assignment.";
        }

        public override JObject Execute(JObject parameters)
        {
            string objectPath = parameters["objectPath"]?.ToObject<string>();
            string text = parameters["text"]?.ToObject<string>() ?? string.Empty;
            bool triggerEndEdit = parameters["triggerEndEdit"]?.ToObject<bool?>() ?? true;

            if (string.IsNullOrEmpty(objectPath))
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    "Missing required parameter: objectPath",
                    "validation_error"
                );
            }

            GameObject go = GameObjectResolver.FindInLoadedScenes(objectPath);
            if (go == null)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"GameObject not found at path '{objectPath}'.",
                    "not_found_error"
                );
            }

            // Try TMP_InputField first — it is the modern default.
            if (TmpInputFieldType != null)
            {
                var tmpComponent = go.GetComponent(TmpInputFieldType);
                if (tmpComponent != null)
                {
                    return ApplyToTmp(tmpComponent, text, triggerEndEdit, objectPath);
                }
            }

            var legacy = go.GetComponent<InputField>();
            if (legacy != null)
            {
                return ApplyToLegacy(legacy, text, triggerEndEdit, objectPath);
            }

            return McpUnitySocketHandler.CreateErrorResponse(
                $"No InputField or TMP_InputField found on '{objectPath}'.",
                "component_not_found"
            );
        }

        private static JObject ApplyToLegacy(InputField field, string text, bool triggerEndEdit, string path)
        {
            Undo.RecordObject(field, "Set InputField text");
            field.text = text;

            if (triggerEndEdit)
            {
                field.onEndEdit?.Invoke(text);
            }

            McpLogger.LogInfo($"[MCP Unity] Set InputField text on '{path}' (triggerEndEdit={triggerEndEdit})");

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = $"Set InputField.text on '{path}' to '{Truncate(text, 80)}'",
                ["component"] = nameof(InputField),
                ["triggerEndEdit"] = triggerEndEdit
            };
        }

        private static JObject ApplyToTmp(Component tmpComponent, string text, bool triggerEndEdit, string path)
        {
            Type t = tmpComponent.GetType();

            PropertyInfo textProp = t.GetProperty("text", MemberFlags);
            if (textProp == null || !textProp.CanWrite)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"TMP_InputField on '{path}' has no writable 'text' property.",
                    "reflection_error"
                );
            }

            Undo.RecordObject(tmpComponent, "Set TMP_InputField text");
            textProp.SetValue(tmpComponent, text);

            bool endEditFired = false;
            if (triggerEndEdit)
            {
                FieldInfo endEditField = t.GetField("onEndEdit", MemberFlags);
                if (endEditField != null && endEditField.GetValue(tmpComponent) is UnityEventBase unityEvent)
                {
                    MethodInfo invoke = unityEvent.GetType().GetMethod("Invoke", new[] { typeof(string) });
                    if (invoke != null)
                    {
                        invoke.Invoke(unityEvent, new object[] { text });
                        endEditFired = true;
                    }
                }
            }

            McpLogger.LogInfo($"[MCP Unity] Set TMP_InputField text on '{path}' (endEditFired={endEditFired})");

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = $"Set TMP_InputField.text on '{path}' to '{Truncate(text, 80)}'",
                ["component"] = "TMP_InputField",
                ["triggerEndEdit"] = triggerEndEdit,
                ["endEditFired"] = endEditFired
            };
        }

        private static string Truncate(string input, int maxLength)
        {
            if (string.IsNullOrEmpty(input) || input.Length <= maxLength) return input ?? string.Empty;
            return input.Substring(0, maxLength) + "…";
        }
    }
}
