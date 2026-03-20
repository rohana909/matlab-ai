// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'
import { parseMlx } from './LiveScriptDocument'
import { LiveScriptPreviewPanel } from './LiveScriptPreviewPanel'

/**
 * Custom read-only editor provider for .mlx files.
 * Registered as `matlab.mlxPreview` in package.json.
 */
export class MlxEditorProvider implements vscode.CustomReadonlyEditorProvider {
    static readonly viewType = 'matlab.mlxPreview'

    constructor (private readonly _context: vscode.ExtensionContext) {}

    openCustomDocument (uri: vscode.Uri): vscode.CustomDocument {
        return {
            uri,
            dispose: () => {}
        }
    }

    async resolveCustomEditor (
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const bytes = await vscode.workspace.fs.readFile(document.uri)
            const doc = await parseMlx(bytes)
            LiveScriptPreviewPanel.attachToPanel(webviewPanel, doc, this._context)
        } catch (e) {
            webviewPanel.webview.html = `<!DOCTYPE html><html><body style="padding:16px;font-family:sans-serif;color:red;">
                <h3>Failed to load .mlx file</h3><pre>${String(e)}</pre>
            </body></html>`
        }
    }
}
