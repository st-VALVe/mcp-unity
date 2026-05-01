using System;
using System.Collections.Generic;
using McpUnity.Unity;
using McpUnity.Utils;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace McpUnity.Tools
{
    /// <summary>
    /// Tool for finding GameObjects in loaded scenes. Unlike GameObject.Find / GameObject.FindWithTag,
    /// this scans all loaded scene objects including inactive ones. Supports filtering by name substring,
    /// tag, and component type.
    /// </summary>
    public class FindGameObjectsTool : McpToolBase
    {
        private const int DefaultLimit = 50;
        private const int MaxLimit = 500;

        public FindGameObjectsTool()
        {
            Name = "find_gameobjects";
            Description =
                "Searches loaded scenes for GameObjects matching optional name substring, tag, and/or component type filters. " +
                "Includes inactive objects. Returns hierarchy path, name, instanceId and active state.";
        }

        public override JObject Execute(JObject parameters)
        {
            string nameFilter = parameters["name"]?.ToObject<string>();
            string tagFilter = parameters["tag"]?.ToObject<string>();
            string componentTypeName = parameters["componentType"]?.ToObject<string>();
            int limit = Mathf.Clamp(
                parameters["limit"]?.ToObject<int?>() ?? DefaultLimit,
                1,
                MaxLimit
            );

            Type componentType = null;
            if (!string.IsNullOrEmpty(componentTypeName))
            {
                componentType = ResolveComponentType(componentTypeName);
                if (componentType == null)
                {
                    return McpUnitySocketHandler.CreateErrorResponse(
                        $"Component type '{componentTypeName}' not found. Provide a full name like 'UnityEngine.UI.Button' or an assembly-qualified name.",
                        "invalid_component_type"
                    );
                }
            }

            bool anyFilter =
                !string.IsNullOrEmpty(nameFilter) ||
                !string.IsNullOrEmpty(tagFilter) ||
                componentType != null;

            var results = new JArray();
            int matchedCount = 0;

            GameObject[] all = UnityEngine.Resources.FindObjectsOfTypeAll<GameObject>();
            foreach (var go in all)
            {
                if (go == null) continue;
                if (go.hideFlags != HideFlags.None) continue;
                if (!go.scene.IsValid() || !go.scene.isLoaded) continue;

                if (!string.IsNullOrEmpty(nameFilter) &&
                    go.name.IndexOf(nameFilter, StringComparison.OrdinalIgnoreCase) < 0)
                {
                    continue;
                }

                if (!string.IsNullOrEmpty(tagFilter))
                {
                    try
                    {
                        if (!go.CompareTag(tagFilter)) continue;
                    }
                    catch (UnityException)
                    {
                        return McpUnitySocketHandler.CreateErrorResponse(
                            $"Tag '{tagFilter}' is not defined in the project.",
                            "invalid_tag"
                        );
                    }
                }

                if (componentType != null && go.GetComponent(componentType) == null)
                {
                    continue;
                }

                matchedCount++;

                if (results.Count < limit)
                {
                    results.Add(new JObject
                    {
                        ["name"] = go.name,
                        ["path"] = GameObjectResolver.GetHierarchyPath(go),
                        ["instanceId"] = go.GetInstanceID(),
                        ["active"] = go.activeInHierarchy,
                        ["activeSelf"] = go.activeSelf,
                        ["scene"] = go.scene.name
                    });
                }
            }

            string summary = anyFilter
                ? $"Found {matchedCount} GameObject(s) matching filters (returning {results.Count})."
                : $"Returned {results.Count} of {matchedCount} GameObjects in loaded scenes.";

            return new JObject
            {
                ["success"] = true,
                ["type"] = "text",
                ["message"] = summary,
                ["matchedCount"] = matchedCount,
                ["returnedCount"] = results.Count,
                ["limit"] = limit,
                ["results"] = results
            };
        }

        private static Type ResolveComponentType(string typeName)
        {
            Type type = Type.GetType(typeName, throwOnError: false);
            if (type != null) return type;

            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                type = assembly.GetType(typeName, throwOnError: false);
                if (type != null) return type;

                // Fallback: search by simple name on UnityEngine and common namespaces.
                foreach (Type candidate in assembly.GetTypes())
                {
                    if (candidate.Name == typeName && typeof(Component).IsAssignableFrom(candidate))
                    {
                        return candidate;
                    }
                }
            }

            return null;
        }
    }
}
