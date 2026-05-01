#if UNITY_EDITOR_WIN
using System;
using System.Runtime.InteropServices;
using System.Threading;
using UnityEditor;
using UnityEngine;
using Process = System.Diagnostics.Process;

namespace McpUnity.Utils
{
    // Local fork addition: posts WM_NULL to the Unity Editor's top-level
    // windows from a background thread so the Editor main loop keeps
    // ticking even when the window has no OS focus or is minimized.
    //
    // Without this, MCP requests routed over WebSocket (notably
    // recompile_scripts) sit in the queue until a developer clicks back
    // into the Editor, because Windows throttles message delivery to
    // background processes.
    //
    // Windows-only and skipped in -batchmode.
    [InitializeOnLoad]
    internal static class BackgroundWakeUpPump
    {
        private const int PumpIntervalMs = 200;
        private const uint WM_NULL = 0x0000;

        private static Thread _thread;
        private static volatile bool _stop;

        static BackgroundWakeUpPump()
        {
            if (Application.isBatchMode) return;

            EditorApplication.quitting += Stop;
            AssemblyReloadEvents.beforeAssemblyReload += Stop;

            Start();
        }

        private static void Start()
        {
            if (_thread != null && _thread.IsAlive) return;

            _stop = false;
            _thread = new Thread(PumpLoop)
            {
                IsBackground = true,
                Name = "McpUnity.WakeUpPump"
            };
            _thread.Start();
        }

        private static void Stop()
        {
            _stop = true;
            _thread = null;
        }

        private static void PumpLoop()
        {
            uint pid = (uint)Process.GetCurrentProcess().Id;
            var enumProc = new EnumWindowsProc((hWnd, _) =>
            {
                GetWindowThreadProcessId(hWnd, out uint windowPid);
                if (windowPid == pid)
                {
                    PostMessage(hWnd, WM_NULL, IntPtr.Zero, IntPtr.Zero);
                }
                return true;
            });

            while (!_stop)
            {
                try
                {
                    EnumWindows(enumProc, IntPtr.Zero);
                }
                catch (Exception ex)
                {
                    Debug.LogWarning($"[McpUnity] WakeUpPump error: {ex.Message}");
                    return;
                }

                Thread.Sleep(PumpIntervalMs);
            }
        }

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    }
}
#endif
