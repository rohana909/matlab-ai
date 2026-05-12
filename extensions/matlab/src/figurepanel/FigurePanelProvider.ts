import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Provides a VS Code Webview Panel that renders MATLAB figures using the
 * MathWorks <matlab-canvas> web component.
 *
 * Architecture:
 *   MATLAB → extractWebCanvasCommands() → base64 JSON → VS Code Webview → <matlab-canvas> → WebGL render
 *
 * This does NOT use exportgraphics or image-based rendering. Instead it uses
 * MATLAB's internal web canvas protocol — the same protocol that powers
 * MATLAB's own web-based figure windows — to render fully interactive,
 * hardware-accelerated figures directly in a VS Code tab.
 */
export class FigurePanelProvider {
    private panel: vscode.WebviewPanel | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Show a MATLAB figure in a docked webview panel.
     * @param b64Data - Base64-encoded JSON web canvas commands extracted from MATLAB
     */
    public show(b64Data: string): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'matlabFigurePoc',
                'MATLAB Figure POC - Membrane',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
        }

        this.panel.webview.html = this.getHtml(b64Data);
    }

    /**
     * Load pre-extracted test data and show it.
     */
    public showMembrane(): void {
        const b64Path = path.join(this.context.extensionPath, 'testdata', 'membrane_b64.txt');
        const b64Data = fs.readFileSync(b64Path, 'utf-8').trim();
        this.show(b64Data);
        vscode.window.showInformationMessage(
            'MATLAB Figure POC: Webview panel opened. Look for the "MATLAB Figure POC - Membrane" tab.'
        );
    }

    private getHtml(b64Data: string): string {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   script-src 'nonce-${nonce}' 'unsafe-eval' 'unsafe-inline' https://embed-ui.mathworks.com https://*.mathworks.com;
                   style-src 'unsafe-inline' https://embed-ui.mathworks.com https://*.mathworks.com;
                   connect-src https://embed-ui.mathworks.com https://*.mathworks.com data: blob:;
                   img-src data: blob: https://embed-ui.mathworks.com https://*.mathworks.com;
                   font-src data: https://embed-ui.mathworks.com https://*.mathworks.com;
                   worker-src blob: data:;
                   child-src blob:;
                   frame-src blob: data:;">
    <link rel="stylesheet" href="https://embed-ui.mathworks.com/resources/webcanvas/R2026a/index-css.css" type="text/css"/>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #1e1e1e;
            height: 100vh;
            overflow: hidden;
        }
        matlab-canvas {
            display: block;
            width: 100%;
            height: 100%;
        }
        #diag {
            display: none;
        }
    </style>
</head>
<body>
    <div id="diag">STEP 1: HTML loaded, waiting for CDN bundle...</div>
    <matlab-canvas
        id="figure-canvas"
        src="data:application/json;base64,${b64Data}"
        style="height: 100%; width: 100%; margin: 0; display: block">
    </matlab-canvas>
    <script nonce="${nonce}">
        var diag = document.getElementById('diag');
        var logs = ['STEP 1: HTML loaded, waiting for CDN bundle...'];

        function log(msg) {
            logs.push(msg);
            diag.textContent = logs.join('\\n');
        }

        // Capture ALL errors
        window.addEventListener('error', function(e) {
            log('ERROR: ' + (e.message || e) + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : ''));
        });
        window.addEventListener('unhandledrejection', function(e) {
            log('PROMISE ERROR: ' + (e.reason ? (e.reason.message || e.reason) : 'unknown'));
        });

        // Check WebGL
        try {
            var tc = document.createElement('canvas');
            var gl = tc.getContext('webgl2') || tc.getContext('webgl');
            log('STEP 2: WebGL = ' + (gl ? gl.getParameter(gl.VERSION) : 'NOT AVAILABLE'));
        } catch(e) {
            log('STEP 2: WebGL check failed: ' + e);
        }

        // Check canvas element
        var canvasEl = document.getElementById('figure-canvas');
        log('STEP 3: matlab-canvas element exists = ' + !!canvasEl);
        log('STEP 3: src length = ' + (canvasEl ? canvasEl.getAttribute('src').length : 0) + ' chars');

        // Load the CDN bundle dynamically so we can track success/failure
        var script = document.createElement('script');
        script.src = 'https://embed-ui.mathworks.com/resources/webcanvas/R2026a/bundle.index.js';
        script.onload = function() {
            log('STEP 4: CDN bundle loaded successfully');
            checkCustomElement();
        };
        script.onerror = function(e) {
            log('STEP 4 FAILED: CDN bundle failed to load! CSP or network issue.');
            log('Check: is https://embed-ui.mathworks.com reachable?');
        };
        document.head.appendChild(script);

        function checkCustomElement() {
            var defined = customElements.get('matlab-canvas');
            if (defined) {
                log('STEP 5: matlab-canvas custom element REGISTERED');
                log('STEP 6: Checking if canvas rendered...');
                setTimeout(function() {
                    var el = document.getElementById('figure-canvas');
                    var shadow = el ? el.shadowRoot : null;
                    log('STEP 6: shadowRoot = ' + !!shadow);
                    if (shadow) {
                        var innerCanvas = shadow.querySelector('canvas');
                        log('STEP 6: inner <canvas> = ' + !!innerCanvas);
                        if (innerCanvas) {
                            log('STEP 6: canvas size = ' + innerCanvas.width + 'x' + innerCanvas.height);
                            log('SUCCESS: Figure should be visible!');
                        } else {
                            log('STEP 6: No inner canvas found. Children: ' + shadow.childElementCount);
                            var children = shadow.children;
                            for (var i = 0; i < Math.min(children.length, 5); i++) {
                                log('  child[' + i + ']: <' + children[i].tagName + '> class=' + children[i].className);
                            }
                        }
                    } else {
                        log('STEP 6: No shadow DOM — element may not have initialized');
                        log('  element tagName: ' + (el ? el.tagName : 'null'));
                        log('  element children: ' + (el ? el.childElementCount : 'N/A'));
                    }
                }, 3000);
            } else {
                log('STEP 5: matlab-canvas NOT YET registered, retrying...');
                setTimeout(checkCustomElement, 500);
            }
        }
    </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
