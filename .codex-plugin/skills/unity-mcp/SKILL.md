---
name: unity-mcp
description: Use when the user asks to inspect, test, or control a Unity Editor project through MCP Unity, including scene objects, menu items, tests, components, and Unity UI tutorials.
---

# Unity MCP

Use MCP Unity when Unity Editor is open for the target project and the user asks to inspect or manipulate the Unity scene, run Unity tests, execute Unity menu items, or interact with in-game UI.

Prefer direct MCP tools over OS-level clicking. For UI flows, use:

- `get_scene_info` and `get_gameobject` to locate active canvases, popups, buttons, inputs, and ScrollRects.
- `set_ui_input_text` for uGUI/TMP input and text components.
- `scroll_ui` for ScrollRect-backed pickers and lists.
- `click_ui` for Button, Toggle, and other EventSystem-clickable targets.
- `invoke_component_method` only when a UI control is custom and the public event path is not enough.

For date-of-birth pickers, first look for an input/text receiver component or ScrollRect selectors. Set the value with `set_ui_input_text` or `invoke_component_method` if the component owns a date-selection callback, then use `click_ui` on the continue/confirm button.

After changing project scripts or MCP package files, run `recompile_scripts` and check `get_console_logs` for compile errors.
