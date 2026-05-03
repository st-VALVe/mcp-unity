using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

namespace McpUnity.Services
{
    public enum DirtyScenePreflightOutcome
    {
        Proceed,
        Refused
    }

    public class DirtyScenePreflightService
    {
        private static readonly string[] AvailablePolicies = { "fail", "report", "save", "discard" };
        private static readonly string[] DiscardScopes = { "active", "loaded" };

        public DirtyScenePreflightOutcome Apply(
            JObject parameters,
            out JObject errorResponse,
            out JObject preflightReport)
        {
            errorResponse = null;

            string policy = parameters?["dirtyScenePolicy"]?.ToObject<string>() ?? "report";
            string scope = parameters?["dirtyScenePolicyScope"]?.ToObject<string>();

            preflightReport = CreatePreflightReport(policy, scope);

            if (!AvailablePolicies.Contains(policy))
            {
                errorResponse = CreateRefusal(
                    "validation_error",
                    "unknown_dirty_scene_policy",
                    $"Unknown dirtyScenePolicy '{policy}'. Expected one of: fail, report, save, discard.",
                    new JProperty("availablePolicies", new JArray(AvailablePolicies)));
                return DirtyScenePreflightOutcome.Refused;
            }

            var loadedScenes = GetLoadedScenes();
            var dirtyScenes = loadedScenes.Where(scene => scene.IsDirty).ToList();

            if (dirtyScenes.Count == 0)
            {
                return DirtyScenePreflightOutcome.Proceed;
            }

            switch (policy)
            {
                case "fail":
                    errorResponse = CreateDirtyScenesBlockedResponse(dirtyScenes);
                    return DirtyScenePreflightOutcome.Refused;

                case "report":
                    AddWarning(
                        preflightReport,
                        $"{dirtyScenes.Count} dirty scene(s) proceeded without action: {string.Join(", ", dirtyScenes.Select(scene => scene.Name))}.");
                    return DirtyScenePreflightOutcome.Proceed;

                case "save":
                    return SaveDirtyScenes(dirtyScenes, preflightReport, out errorResponse);

                case "discard":
                    return DiscardDirtyScenes(loadedScenes, dirtyScenes, scope, preflightReport, out errorResponse);

                default:
                    errorResponse = CreateRefusal(
                        "validation_error",
                        "unknown_dirty_scene_policy",
                        $"Unknown dirtyScenePolicy '{policy}'. Expected one of: fail, report, save, discard.",
                        new JProperty("availablePolicies", new JArray(AvailablePolicies)));
                    return DirtyScenePreflightOutcome.Refused;
            }
        }

        private static DirtyScenePreflightOutcome SaveDirtyScenes(
            IReadOnlyList<SceneSnapshot> dirtyScenes,
            JObject preflightReport,
            out JObject errorResponse)
        {
            errorResponse = null;

            SceneSnapshot unsavedScene = dirtyScenes.FirstOrDefault(scene => !scene.HasPath);
            if (unsavedScene != null)
            {
                errorResponse = CreateUnsavedSceneResponse("cannot_save_unsaved_scene", unsavedScene);
                return DirtyScenePreflightOutcome.Refused;
            }

            foreach (SceneSnapshot dirtyScene in dirtyScenes)
            {
                bool saved = EditorSceneManager.SaveScene(dirtyScene.Scene);
                if (!saved)
                {
                    errorResponse = CreateRefusal(
                        "dirty_scene_preflight_refused",
                        "save_scene_failed",
                        $"Failed to save dirty scene '{dirtyScene.Name}' at '{dirtyScene.Path}'.",
                        new JProperty("scene", dirtyScene.ToJObject()));
                    return DirtyScenePreflightOutcome.Refused;
                }

                AddActedOn(preflightReport, dirtyScene, "saved");
            }

            return DirtyScenePreflightOutcome.Proceed;
        }

        private static DirtyScenePreflightOutcome DiscardDirtyScenes(
            IReadOnlyList<SceneSnapshot> loadedScenes,
            IReadOnlyList<SceneSnapshot> dirtyScenes,
            string scope,
            JObject preflightReport,
            out JObject errorResponse)
        {
            errorResponse = null;

            if (string.IsNullOrEmpty(scope))
            {
                errorResponse = CreateRefusal(
                    "dirty_scene_preflight_refused",
                    "discard_requires_scope",
                    "dirtyScenePolicy='discard' requires dirtyScenePolicyScope='active' or 'loaded' (no default; explicit choice required to avoid data loss).",
                    new JProperty("discardScopes", new JArray(DiscardScopes)));
                return DirtyScenePreflightOutcome.Refused;
            }

            if (!DiscardScopes.Contains(scope))
            {
                errorResponse = CreateRefusal(
                    "validation_error",
                    "unknown_dirty_scene_policy_scope",
                    $"Unknown dirtyScenePolicyScope '{scope}'. Expected 'active' or 'loaded'.",
                    new JProperty("discardScopes", new JArray(DiscardScopes)));
                return DirtyScenePreflightOutcome.Refused;
            }

            SceneSnapshot activeScene = loadedScenes.FirstOrDefault(scene => scene.IsActive);
            if (activeScene == null)
            {
                errorResponse = CreateRefusal(
                    "validation_error",
                    "no_active_scene",
                    "No valid active scene is loaded.",
                    new JProperty("discardScopes", new JArray(DiscardScopes)));
                return DirtyScenePreflightOutcome.Refused;
            }

            if (scope == "active")
            {
                return DiscardActiveScene(loadedScenes, dirtyScenes, activeScene, preflightReport, out errorResponse);
            }

            return DiscardLoadedScenes(loadedScenes, dirtyScenes, activeScene, preflightReport, out errorResponse);
        }

        private static DirtyScenePreflightOutcome DiscardActiveScene(
            IReadOnlyList<SceneSnapshot> loadedScenes,
            IReadOnlyList<SceneSnapshot> dirtyScenes,
            SceneSnapshot activeScene,
            JObject preflightReport,
            out JObject errorResponse)
        {
            errorResponse = null;

            if (!activeScene.HasPath)
            {
                errorResponse = CreateUnsavedSceneResponse("cannot_discard_unsaved_scene", activeScene);
                return DirtyScenePreflightOutcome.Refused;
            }

            SceneSnapshot dirtyUnsavedAdditive = dirtyScenes.FirstOrDefault(scene => !scene.IsActive && !scene.HasPath);
            if (dirtyUnsavedAdditive != null)
            {
                errorResponse = CreateUnsavedSceneResponse("cannot_discard_unsaved_scene", dirtyUnsavedAdditive);
                return DirtyScenePreflightOutcome.Refused;
            }

            var detachedScenes = loadedScenes.Where(scene => !scene.IsActive).ToList();

            EditorSceneManager.OpenScene(activeScene.Path, OpenSceneMode.Single);

            if (dirtyScenes.Any(scene => scene.IsActive))
            {
                AddActedOn(preflightReport, activeScene, "discarded");
            }

            if (detachedScenes.Count > 0)
            {
                AddWarning(
                    preflightReport,
                    $"{detachedScenes.Count} additive scene(s) detached while discarding active scene: {string.Join(", ", detachedScenes.Select(scene => scene.Name))}.");
            }

            foreach (SceneSnapshot dirtyScene in dirtyScenes.Where(scene => !scene.IsActive))
            {
                AddActedOn(preflightReport, dirtyScene, "detached");
            }

            return DirtyScenePreflightOutcome.Proceed;
        }

        private static DirtyScenePreflightOutcome DiscardLoadedScenes(
            IReadOnlyList<SceneSnapshot> loadedScenes,
            IReadOnlyList<SceneSnapshot> dirtyScenes,
            SceneSnapshot activeScene,
            JObject preflightReport,
            out JObject errorResponse)
        {
            errorResponse = null;

            SceneSnapshot sceneWithoutPath = loadedScenes.FirstOrDefault(scene => !scene.HasPath);
            if (sceneWithoutPath != null)
            {
                errorResponse = CreateUnsavedSceneResponse("cannot_discard_unsaved_scene", sceneWithoutPath);
                return DirtyScenePreflightOutcome.Refused;
            }

            var additiveScenes = loadedScenes.Where(scene => !scene.IsActive).ToList();

            EditorSceneManager.OpenScene(activeScene.Path, OpenSceneMode.Single);
            foreach (SceneSnapshot additiveScene in additiveScenes)
            {
                EditorSceneManager.OpenScene(additiveScene.Path, OpenSceneMode.Additive);
            }

            foreach (SceneSnapshot dirtyScene in dirtyScenes)
            {
                AddActedOn(preflightReport, dirtyScene, "discarded");
            }

            return DirtyScenePreflightOutcome.Proceed;
        }

        private static List<SceneSnapshot> GetLoadedScenes()
        {
            var scenes = new List<SceneSnapshot>();
            Scene activeScene = SceneManager.GetActiveScene();

            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                Scene scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                scenes.Add(new SceneSnapshot(scene, scene == activeScene));
            }

            return scenes;
        }

        private static JObject CreatePreflightReport(string policy, string scope)
        {
            return new JObject
            {
                ["dirtyScenePolicy"] = policy,
                ["dirtyScenePolicyScope"] = scope == null ? JValue.CreateNull() : new JValue(scope),
                ["scenesActedOn"] = new JArray(),
                ["warnings"] = new JArray()
            };
        }

        private static JObject CreateDirtyScenesBlockedResponse(IReadOnlyList<SceneSnapshot> dirtyScenes)
        {
            return CreateRefusal(
                "dirty_scene_preflight_refused",
                "dirty_scenes_blocked",
                $"Refused to proceed: {dirtyScenes.Count} dirty scene(s). Use dirtyScenePolicy='save' to persist or 'discard' (with dirtyScenePolicyScope) to reload.",
                new JProperty("dirtyScenes", new JArray(dirtyScenes.Select(scene => scene.ToJObject()))),
                new JProperty("availablePolicies", new JArray(AvailablePolicies)),
                new JProperty("discardScopes", new JArray(DiscardScopes)));
        }

        private static JObject CreateUnsavedSceneResponse(string errcode, SceneSnapshot scene)
        {
            string action = errcode == "cannot_save_unsaved_scene" ? "saved" : "discarded";
            return CreateRefusal(
                "dirty_scene_preflight_refused",
                errcode,
                $"Scene '{scene.Name}' has no asset path and cannot be {action}. Save it manually first via the editor, or use dirtyScenePolicy='fail'/'report' to surface the situation without acting.",
                new JProperty("scene", scene.ToJObject()));
        }

        private static JObject CreateRefusal(string type, string errcode, string message, params JProperty[] extraFields)
        {
            var error = new JObject
            {
                ["type"] = type,
                ["errcode"] = errcode,
                ["message"] = message
            };

            foreach (JProperty field in extraFields)
            {
                error[field.Name] = field.Value.DeepClone();
            }

            return new JObject
            {
                ["error"] = error
            };
        }

        private static void AddWarning(JObject preflightReport, string warning)
        {
            ((JArray)preflightReport["warnings"]).Add(warning);
        }

        private static void AddActedOn(JObject preflightReport, SceneSnapshot scene, string action)
        {
            JObject sceneInfo = scene.ToJObject();
            sceneInfo["action"] = action;
            ((JArray)preflightReport["scenesActedOn"]).Add(sceneInfo);
        }

        private class SceneSnapshot
        {
            public SceneSnapshot(Scene scene, bool isActive)
            {
                Scene = scene;
                Name = string.IsNullOrEmpty(scene.name) ? "UntitledScene" : scene.name;
                Path = scene.path ?? string.Empty;
                IsActive = isActive;
                IsDirty = scene.isDirty;
            }

            public Scene Scene { get; }
            public string Name { get; }
            public string Path { get; }
            public bool IsActive { get; }
            public bool IsDirty { get; }
            public bool HasPath => !string.IsNullOrEmpty(Path);

            public JObject ToJObject()
            {
                return new JObject
                {
                    ["name"] = Name,
                    ["path"] = Path,
                    ["isActive"] = IsActive,
                    ["hasPath"] = HasPath
                };
            }
        }
    }
}
