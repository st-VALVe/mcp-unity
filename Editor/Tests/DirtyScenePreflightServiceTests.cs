using System;
using System.Collections.Generic;
using System.Linq;
using McpUnity.Services;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace McpUnity.Tests
{
    public class DirtyScenePreflightServiceTests
    {
        private const string ParentFolder = "Assets/Tests";
        private const string TempFolder = "Assets/Tests/_PreflightTmp";

        private readonly List<string> _createdScenePaths = new List<string>();
        private DirtyScenePreflightService _service;

        [OneTimeSetUp]
        public void OneTimeSetUp()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EnsureTempFolder(reset: true);
        }

        [SetUp]
        public void SetUp()
        {
            _service = new DirtyScenePreflightService();
            _createdScenePaths.Clear();
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EnsureTempFolder(reset: false);
        }

        [TearDown]
        public void TearDown()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            foreach (string path in _createdScenePaths)
            {
                AssetDatabase.DeleteAsset(path);
            }

            _createdScenePaths.Clear();
        }

        [OneTimeTearDown]
        public void OneTimeTearDown()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            AssetDatabase.DeleteAsset(TempFolder);
        }

        [TestCase("fail", null)]
        [TestCase("report", null)]
        [TestCase("save", null)]
        [TestCase("discard", "active")]
        public void CleanActiveScene_WithPolicy_ProceedsWithoutWarnings(string policy, string scope)
        {
            CreateCleanSavedScene("CleanScene", NewSceneMode.Single);
            JObject parameters = Parameters(policy, scope);

            DirtyScenePreflightOutcome outcome = _service.Apply(parameters, out JObject errorResponse, out JObject report);

            Assert.AreEqual(DirtyScenePreflightOutcome.Proceed, outcome);
            Assert.IsNull(errorResponse);
            Assert.AreEqual(0, ((JArray)report["scenesActedOn"]).Count);
            Assert.AreEqual(0, ((JArray)report["warnings"]).Count);
        }

        [Test]
        public void DirtyActiveScene_WithFailPolicy_RefusesWithDirtyScenesPayload()
        {
            Scene scene = CreateDirtySavedScene("FailScene", NewSceneMode.Single);
            string expectedName = scene.name;

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("fail"), out JObject errorResponse, out _);

            Assert.AreEqual(DirtyScenePreflightOutcome.Refused, outcome);
            Assert.AreEqual("dirty_scenes_blocked", errorResponse["error"]["errcode"]?.ToString());
            JArray dirtyScenes = (JArray)errorResponse["error"]["dirtyScenes"];
            Assert.AreEqual(1, dirtyScenes.Count);
            Assert.AreEqual(expectedName, dirtyScenes[0]["name"]?.ToString());
            Assert.IsTrue(dirtyScenes[0]["isActive"]?.ToObject<bool>() ?? false);
        }

        [Test]
        public void DirtyActiveScene_WithReportPolicy_ProceedsAndLeavesSceneDirty()
        {
            Scene scene = CreateDirtySavedScene("ReportScene", NewSceneMode.Single);

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("report"), out JObject errorResponse, out JObject report);

            Assert.AreEqual(DirtyScenePreflightOutcome.Proceed, outcome);
            Assert.IsNull(errorResponse);
            Assert.IsTrue(scene.isDirty);
            Assert.AreEqual(0, ((JArray)report["scenesActedOn"]).Count);
            Assert.AreEqual(1, ((JArray)report["warnings"]).Count);
            StringAssert.Contains("proceeded without action", report["warnings"][0]?.ToString());
        }

        [Test]
        public void DirtyActiveScene_WithSavePolicy_SavesScene()
        {
            Scene scene = CreateDirtySavedScene("SaveScene", NewSceneMode.Single);

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("save"), out JObject errorResponse, out JObject report);

            Assert.AreEqual(DirtyScenePreflightOutcome.Proceed, outcome);
            Assert.IsNull(errorResponse);
            Assert.IsFalse(scene.isDirty);
            JArray scenesActedOn = (JArray)report["scenesActedOn"];
            Assert.AreEqual(1, scenesActedOn.Count);
            Assert.AreEqual("saved", scenesActedOn[0]["action"]?.ToString());
        }

        [Test]
        public void DirtyActiveSceneWithoutPath_WithSavePolicy_Refuses()
        {
            CreateDirtyUnsavedScene("UnsavedSaveScene", NewSceneMode.Single);

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("save"), out JObject errorResponse, out _);

            Assert.AreEqual(DirtyScenePreflightOutcome.Refused, outcome);
            Assert.AreEqual("cannot_save_unsaved_scene", errorResponse["error"]["errcode"]?.ToString());
        }

        [Test]
        public void DirtyActiveScene_WithDiscardPolicyWithoutScope_Refuses()
        {
            CreateDirtySavedScene("DiscardNoScopeScene", NewSceneMode.Single);

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("discard"), out JObject errorResponse, out _);

            Assert.AreEqual(DirtyScenePreflightOutcome.Refused, outcome);
            Assert.AreEqual("discard_requires_scope", errorResponse["error"]["errcode"]?.ToString());
        }

        [Test]
        public void CleanActiveScene_WithDiscardPolicyWithoutScope_StillRefuses()
        {
            // Regression: scope validation must happen BEFORE the dirty-scene check.
            // Otherwise caller misconfiguration (`discard` without `scope`) is silently
            // accepted on a clean state and only surfaces later when dirtiness appears,
            // masking the original mistake.
            CreateCleanSavedScene("CleanDiscardNoScopeScene", NewSceneMode.Single);

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("discard"), out JObject errorResponse, out _);

            Assert.AreEqual(DirtyScenePreflightOutcome.Refused, outcome);
            Assert.AreEqual("discard_requires_scope", errorResponse["error"]["errcode"]?.ToString());
        }

        [Test]
        public void CleanActiveScene_WithDiscardPolicyAndUnknownScope_StillRefuses()
        {
            CreateCleanSavedScene("CleanDiscardUnknownScopeScene", NewSceneMode.Single);

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("discard", "everything"), out JObject errorResponse, out _);

            Assert.AreEqual(DirtyScenePreflightOutcome.Refused, outcome);
            Assert.AreEqual("unknown_dirty_scene_policy_scope", errorResponse["error"]["errcode"]?.ToString());
        }

        [Test]
        public void DirtyActiveScene_WithDiscardActiveScope_ReloadsScene()
        {
            Scene scene = CreateDirtySavedScene("DiscardActiveScene", NewSceneMode.Single);
            string path = scene.path;

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("discard", "active"), out JObject errorResponse, out JObject report);

            Assert.AreEqual(DirtyScenePreflightOutcome.Proceed, outcome);
            Assert.IsNull(errorResponse);
            Scene activeScene = SceneManager.GetActiveScene();
            Assert.AreEqual(path, activeScene.path);
            Assert.IsFalse(activeScene.isDirty);
            Assert.AreEqual("discarded", report["scenesActedOn"][0]["action"]?.ToString());
        }

        [Test]
        public void DirtyActiveSceneWithoutPath_WithDiscardActiveScope_Refuses()
        {
            CreateDirtyUnsavedScene("UnsavedDiscardScene", NewSceneMode.Single);

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("discard", "active"), out JObject errorResponse, out _);

            Assert.AreEqual(DirtyScenePreflightOutcome.Refused, outcome);
            Assert.AreEqual("cannot_discard_unsaved_scene", errorResponse["error"]["errcode"]?.ToString());
        }

        [Test]
        public void MultipleLoadedDirtyScenes_WithFailPolicy_ReturnsBothScenes()
        {
            Scene activeScene = CreateDirtySavedScene("ActiveDirtyScene", NewSceneMode.Single);
            string activeName = activeScene.name;
            SceneManager.SetActiveScene(activeScene);
            Scene additiveScene = CreateDirtySavedScene("AdditiveDirtyScene", NewSceneMode.Additive);
            string additiveName = additiveScene.name;
            SceneManager.SetActiveScene(activeScene);

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("fail"), out JObject errorResponse, out _);

            Assert.AreEqual(DirtyScenePreflightOutcome.Refused, outcome);
            JArray dirtyScenes = (JArray)errorResponse["error"]["dirtyScenes"];
            Assert.AreEqual(2, dirtyScenes.Count);
            Assert.IsTrue(dirtyScenes.Any(scene => scene["name"]?.ToString() == activeName && (scene["isActive"]?.ToObject<bool>() ?? false)));
            Assert.IsTrue(dirtyScenes.Any(scene => scene["name"]?.ToString() == additiveName && !(scene["isActive"]?.ToObject<bool>() ?? true)));
        }

        [Test]
        public void MultipleLoadedScenes_WithUnsavedAdditiveAndDiscardLoadedScope_Refuses()
        {
            Scene activeScene = CreateDirtySavedScene("LoadedActiveScene", NewSceneMode.Single);
            SceneManager.SetActiveScene(activeScene);
            CreateDirtyUnsavedScene("UnsavedAdditiveScene", NewSceneMode.Additive);
            SceneManager.SetActiveScene(activeScene);

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("discard", "loaded"), out JObject errorResponse, out _);

            Assert.AreEqual(DirtyScenePreflightOutcome.Refused, outcome);
            Assert.AreEqual("cannot_discard_unsaved_scene", errorResponse["error"]["errcode"]?.ToString());
        }

        [Test]
        public void UnknownPolicy_RefusesWithValidationError()
        {
            CreateCleanSavedScene("UnknownPolicyScene", NewSceneMode.Single);

            DirtyScenePreflightOutcome outcome = _service.Apply(Parameters("refuse"), out JObject errorResponse, out _);

            Assert.AreEqual(DirtyScenePreflightOutcome.Refused, outcome);
            Assert.AreEqual("validation_error", errorResponse["error"]["type"]?.ToString());
            Assert.AreEqual("unknown_dirty_scene_policy", errorResponse["error"]["errcode"]?.ToString());
        }

        private static JObject Parameters(string policy, string scope = null)
        {
            var parameters = new JObject
            {
                ["dirtyScenePolicy"] = policy
            };

            if (scope != null)
            {
                parameters["dirtyScenePolicyScope"] = scope;
            }

            return parameters;
        }

        private Scene CreateCleanSavedScene(string name, NewSceneMode mode)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, mode);
            string path = $"{TempFolder}/{name}_{Guid.NewGuid():N}.unity";
            Assert.IsTrue(EditorSceneManager.SaveScene(scene, path), $"Failed to save test scene at {path}");
            _createdScenePaths.Add(path);
            return scene;
        }

        private Scene CreateDirtySavedScene(string name, NewSceneMode mode)
        {
            Scene scene = CreateCleanSavedScene(name, mode);
            AddMarker(scene, $"{name}_Marker");
            Assert.IsTrue(scene.isDirty, "Expected saved test scene to become dirty after marker creation.");
            return scene;
        }

        private static Scene CreateDirtyUnsavedScene(string name, NewSceneMode mode)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, mode);
            AddMarker(scene, $"{name}_Marker");
            Assert.IsTrue(scene.isDirty, "Expected unsaved test scene to be dirty after marker creation.");
            return scene;
        }

        private static void AddMarker(Scene scene, string name)
        {
            var marker = new GameObject(name);
            SceneManager.MoveGameObjectToScene(marker, scene);
            EditorSceneManager.MarkSceneDirty(scene);
        }

        private static void EnsureTempFolder(bool reset)
        {
            if (!AssetDatabase.IsValidFolder(ParentFolder))
            {
                AssetDatabase.CreateFolder("Assets", "Tests");
            }

            if (reset && AssetDatabase.IsValidFolder(TempFolder))
            {
                AssetDatabase.DeleteAsset(TempFolder);
            }

            if (!AssetDatabase.IsValidFolder(TempFolder))
            {
                AssetDatabase.CreateFolder(ParentFolder, "_PreflightTmp");
            }
        }
    }
}
