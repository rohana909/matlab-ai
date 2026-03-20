// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'
import { LiveScriptDocument } from './LiveScriptDocument'

/**
 * Manages a WebviewPanel that renders a MATLAB Live Script as formatted HTML.
 * Used both for .mlx files (via MlxEditorProvider) and .m live scripts (via command).
 */
export class LiveScriptPreviewPanel {
    private constructor (
        private readonly _panel: vscode.WebviewPanel,
        private readonly _context: vscode.ExtensionContext
    ) {}

    /**
     * Creates a new panel — used for the `matlab.previewLiveScript` command path.
     */
    static create (
        context: vscode.ExtensionContext,
        uri: vscode.Uri,
        doc: LiveScriptDocument
    ): LiveScriptPreviewPanel {
        const fileName = uri.path.split('/').pop() ?? 'Live Script'
        const panel = vscode.window.createWebviewPanel(
            'matlabLiveScriptPreview',
            `Preview: ${fileName}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'livescript')]
            }
        )
        const instance = new LiveScriptPreviewPanel(panel, context)
        panel.webview.html = instance._getWebviewContent(panel.webview, doc)
        return instance
    }

    /**
     * Configures a VS Code-provided panel — used for the .mlx custom editor path.
     */
    static attachToPanel (
        panel: vscode.WebviewPanel,
        doc: LiveScriptDocument,
        context: vscode.ExtensionContext
    ): LiveScriptPreviewPanel {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'livescript')]
        }
        const instance = new LiveScriptPreviewPanel(panel, context)
        panel.webview.html = instance._getWebviewContent(panel.webview, doc)
        return instance
    }

    dispose (): void {
        this._panel.dispose()
    }

    private _getWebviewContent (webview: vscode.Webview, doc: LiveScriptDocument): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'out', 'livescript', 'liveScriptWebview.js')
        )
        const nonce = this._getNonce()
        const cspSource = webview.cspSource
        // Embed the document as a JSON literal so the webview needs no async message handshake.
        const docJson = JSON.stringify(doc).replace(/</g, '\\u003c')
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: ${cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MATLAB Live Script Preview</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}">window.__LIVESCRIPT_DOC__ = ${docJson};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
    }

    private _getNonce (): string {
        let text = ''
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length))
        }
        return text
    }
}
