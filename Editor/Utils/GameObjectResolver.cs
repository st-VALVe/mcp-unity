using UnityEngine;

namespace McpUnity.Utils
{
    /// <summary>
    /// Helpers for resolving GameObjects by hierarchy path or name, including inactive objects
    /// which GameObject.Find does not return.
    /// </summary>
    public static class GameObjectResolver
    {
        /// <summary>
        /// Find a GameObject by hierarchy path or leaf name. Unlike GameObject.Find, this also
        /// returns inactive objects. Only considers objects in loaded scenes (not prefab assets).
        /// </summary>
        /// <param name="path">Full path like "Canvas/Panel/Button", a partial suffix, or a leaf name.</param>
        /// <returns>The first matching GameObject, or null.</returns>
        public static GameObject FindInLoadedScenes(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;

            // Fast path: active-only lookup.
            GameObject found = GameObject.Find(path);
            if (found != null) return found;

            string[] parts = path.Trim('/').Split('/');
            if (parts.Length == 0) return null;

            string leafName = parts[parts.Length - 1];

            GameObject[] candidates = UnityEngine.Resources.FindObjectsOfTypeAll<GameObject>();
            foreach (var candidate in candidates)
            {
                if (candidate == null) continue;
                if (candidate.hideFlags != HideFlags.None) continue;
                if (!candidate.scene.IsValid() || !candidate.scene.isLoaded) continue;
                if (candidate.name != leafName) continue;

                if (MatchesHierarchySuffix(candidate.transform, parts))
                {
                    return candidate;
                }
            }

            return null;
        }

        /// <summary>
        /// Build the full hierarchy path of a GameObject from its root.
        /// </summary>
        public static string GetHierarchyPath(GameObject go)
        {
            if (go == null) return string.Empty;

            Transform t = go.transform;
            string path = t.name;
            while (t.parent != null)
            {
                t = t.parent;
                path = $"{t.name}/{path}";
            }
            return path;
        }

        /// <summary>
        /// Check if the transform's hierarchy ends with the given path parts (leaf-first).
        /// </summary>
        private static bool MatchesHierarchySuffix(Transform leaf, string[] parts)
        {
            Transform current = leaf;
            for (int i = parts.Length - 1; i >= 0; i--)
            {
                if (current == null) return false;
                if (current.name != parts[i]) return false;
                current = current.parent;
            }
            return true;
        }
    }
}
