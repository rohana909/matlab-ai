# MATLAB Figure Panel — Docked Figures in VS Code

Renders interactive MATLAB figures directly inside a VS Code editor tab using the MathWorks `<matlab-canvas>` web component and VS Code's Webview API.

## How It Works

### Architecture

```
┌─────────────┐      extractWebCanvasCommands()      ┌──────────────────┐
│   MATLAB    │ ──────────────────────────────────▶   │  base64 JSON     │
│  (figure)   │   internal web canvas protocol       │  (canvas cmds)   │
└─────────────┘                                      └────────┬─────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  VS Code Webview Panel  (vscode.window.createWebviewPanel)              │
│                                                                         │
│   ┌───────────────────────────────────────────────────────────────┐     │
│   │  <matlab-canvas src="data:application/json;base64,{data}">   │     │
│   │                                                               │     │
│   │   CDN: embed-ui.mathworks.com/resources/webcanvas/R2026a/    │     │
│   │   → Registers custom element                                  │     │
│   │   → Parses web canvas commands                                │     │
│   │   → Renders via WebGL (hardware-accelerated)                  │     │
│   └───────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Question | Answer |
|----------|--------|
| Does it use `exportgraphics`? | **No.** `exportgraphics` produces static raster/vector images (PNG, PDF, SVG). This approach uses MATLAB's internal **web canvas protocol** instead. |
| Does it use VS Code Webview? | **Yes.** `vscode.window.createWebviewPanel` creates a docked tab alongside the editor. |
| What renders the figure? | The `<matlab-canvas>` custom element, loaded from the MathWorks CDN (`embed-ui.mathworks.com`). It uses WebGL for hardware-accelerated rendering. |
| Is the figure interactive? | **Yes.** Pan, zoom, rotate, and data tips all work — same interactions as MATLAB's web figure window. |
| What MATLAB version is required? | **R2026a+** — the `extractWebCanvasCommands` internal API and the CDN bundle are version-specific. |

### Data Flow (Step by Step)

1. **Extract figure data in MATLAB:**
   ```matlab
   % Create a figure
   figure; membrane;

   % Extract the web canvas rendering commands (internal API)
   cmds = matlab.graphics.internal.extractWebCanvasCommands(gcf);

   % Encode as base64 for transport
   b64 = matlab.net.base64encode(jsonencode(cmds));
   ```

2. **Pass base64 data to the extension** (via file, command, or message).

3. **Extension creates a Webview Panel** docked beside the editor:
   ```typescript
   const panel = vscode.window.createWebviewPanel(
       'matlabFigurePoc',
       'MATLAB Figure',
       vscode.ViewColumn.Beside,
       { enableScripts: true, retainContextWhenHidden: true }
   );
   ```

4. **Webview loads the `<matlab-canvas>` web component** from CDN and feeds it the base64 data via the `src` attribute:
   ```html
   <matlab-canvas
       src="data:application/json;base64,{b64Data}"
       style="height: 100%; width: 100%">
   </matlab-canvas>
   ```

5. **WebGL renders the figure** — fully interactive, resolution-independent, docked as a VS Code tab.

### Why Not `exportgraphics`?

| | `exportgraphics` | Web Canvas Protocol |
|---|---|---|
| Output | Static image (PNG/SVG/PDF) | Interactive WebGL scene |
| Interactivity | None | Pan, zoom, rotate, datatips |
| Resolution | Fixed at export time | Adapts to panel size |
| Rendering | Server-side (MATLAB) | Client-side (browser/WebGL) |
| Bandwidth | Full image every update | Incremental command stream |

### File Structure

```
figurepanel/
├── FigurePanelProvider.ts   # Main provider class — creates & manages Webview
├── README.md                # This file
testdata/
└── membrane_b64.txt         # Pre-extracted web canvas commands for `membrane` plot
```

### Content Security Policy

The webview uses a carefully configured CSP to allow:
- Scripts from `embed-ui.mathworks.com` (the `<matlab-canvas>` bundle)
- Styles from the same CDN
- `data:` and `blob:` URIs for WebGL textures and workers
- Inline styles for layout

### Diagnostics

The webview includes a diagnostic overlay (green text, top-left) that reports:
1. HTML loaded
2. WebGL availability and version
3. `<matlab-canvas>` element presence
4. CDN bundle load success/failure
5. Custom element registration
6. Shadow DOM and inner canvas creation

This overlay is useful during development and can be removed for production.

## Status

**Work in Progress** — This is a proof-of-concept demonstrating that MATLAB's web canvas protocol can render figures inside VS Code webviews. Current limitations:

- Uses pre-extracted test data (no live MATLAB connection yet)
- Single figure only (no multi-figure management)
- No figure update/refresh from running MATLAB code
- Diagnostic overlay always visible

## Future Work

- Connect to live MATLAB session to extract figures on-the-fly
- Support multiple simultaneous figure panels
- Auto-detect new figures after MATLAB command execution
- Remove diagnostic overlay (or make it togglable)
- Support figure export (save as PNG/SVG from the panel)
