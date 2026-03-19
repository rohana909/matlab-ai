// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'
import { ExtensionToWebviewMessage, VariableMetadata, WebviewToExtensionMessage } from './protocol'
import { VariableDataService } from './VariableDataService'

/**
 * Wraps a single VS Code WebviewPanel for displaying and editing one MATLAB workspace variable.
 */
export class VariableEditorPanel {
    private readonly _panel: vscode.WebviewPanel
    private readonly _dataService: VariableDataService
    private _variable: VariableMetadata
    private readonly _context: vscode.ExtensionContext

    private constructor (
        panel: vscode.WebviewPanel,
        dataService: VariableDataService,
        variable: VariableMetadata,
        context: vscode.ExtensionContext
    ) {
        this._panel = panel
        this._dataService = dataService
        this._variable = variable
        this._context = context

        this._panel.webview.html = this._getWebviewContent(this._panel.webview, this._context)

        this._panel.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
            void this._handleMessage(msg)
        })
    }

    /**
     * Creates a new VariableEditorPanel for the given variable.
     */
    static create (
        context: vscode.ExtensionContext,
        dataService: VariableDataService,
        variable: VariableMetadata
    ): VariableEditorPanel {
        const panel = vscode.window.createWebviewPanel(
            'matlabVariableEditor',
            `Variable: ${variable.name}`,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'variableeditor')]
            }
        )
        return new VariableEditorPanel(panel, dataService, variable, context)
    }

    /**
     * Brings the panel to the foreground.
     */
    reveal (): void {
        this._panel.reveal()
    }

    /**
     * Sends updated variable metadata to the webview.
     */
    refresh (metadata: VariableMetadata): void {
        this._variable = metadata
        this._post({ type: 'refresh', variable: metadata })
    }

    /**
     * Posts an arbitrary ExtensionToWebviewMessage to the webview.
     */
    postMessage (msg: ExtensionToWebviewMessage): void {
        this._post(msg)
    }

    /**
     * Registers a callback to be invoked when the panel is disposed.
     */
    onDidDispose (callback: () => void): void {
        this._panel.onDidDispose(callback)
    }

    /**
     * Disposes the panel and releases its resources.
     */
    dispose (): void {
        this._panel.dispose()
    }

    private _post (msg: ExtensionToWebviewMessage): void {
        void this._panel.webview.postMessage(msg)
    }

    private async _handleMessage (msg: WebviewToExtensionMessage): Promise<void> {
        switch (msg.type) {
            case 'ready':
                this._post({ type: 'init', variable: this._variable })
                break
            case 'requestPage': {
                try {
                    const page = await this._dataService.getPage(
                        this._variable.name,
                        msg.startRow,
                        msg.startCol,
                        msg.rowCount,
                        msg.colCount
                    )
                    this._post({ type: 'dataPage', requestId: msg.requestId, page })
                } catch (e) {
                    this._post({
                        type: 'dataPage',
                        requestId: msg.requestId,
                        page: { startRow: msg.startRow, startCol: msg.startCol, rows: [] }
                    })
                }
                break
            }
            case 'writeCell': {
                try {
                    await this._dataService.writeCell(this._variable.name, msg.row, msg.col, msg.value)
                    this._post({ type: 'writeAck', requestId: msg.requestId, success: true })
                } catch (e) {
                    this._post({ type: 'writeAck', requestId: msg.requestId, success: false, error: String(e) })
                }
                break
            }
            case 'writeRange': {
                try {
                    await this._dataService.writeRange(this._variable.name, msg.startRow, msg.startCol, msg.values)
                    this._post({ type: 'writeAck', requestId: msg.requestId, success: true })
                } catch (e) {
                    this._post({ type: 'writeAck', requestId: msg.requestId, success: false, error: String(e) })
                }
                break
            }
            case 'requestCellDrill': {
                try {
                    const data = await this._dataService.getCellContent(this._variable.name, msg.row, msg.col)
                    this._post({ type: 'cellData', requestId: msg.requestId, data })
                } catch (e) {
                    // ignore drill failures silently
                }
                break
            }
            case 'insertRow': {
                try {
                    await this._dataService.insertRow(this._variable.name, msg.afterRow)
                    this._post({ type: 'structuralAck', requestId: msg.requestId, success: true })
                } catch (e) {
                    this._post({ type: 'structuralAck', requestId: msg.requestId, success: false, error: String(e) })
                }
                break
            }
            case 'deleteRow': {
                try {
                    await this._dataService.deleteRow(this._variable.name, msg.rowIndex)
                    this._post({ type: 'structuralAck', requestId: msg.requestId, success: true })
                } catch (e) {
                    this._post({ type: 'structuralAck', requestId: msg.requestId, success: false, error: String(e) })
                }
                break
            }
            case 'insertCol': {
                try {
                    await this._dataService.insertCol(this._variable.name, msg.afterCol)
                    this._post({ type: 'structuralAck', requestId: msg.requestId, success: true })
                } catch (e) {
                    this._post({ type: 'structuralAck', requestId: msg.requestId, success: false, error: String(e) })
                }
                break
            }
            case 'deleteCol': {
                try {
                    await this._dataService.deleteCol(this._variable.name, msg.colIndex)
                    this._post({ type: 'structuralAck', requestId: msg.requestId, success: true })
                } catch (e) {
                    this._post({ type: 'structuralAck', requestId: msg.requestId, success: false, error: String(e) })
                }
                break
            }
        }
    }

    private _getWebviewContent (webview: vscode.Webview, context: vscode.ExtensionContext): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'out', 'variableeditor', 'variableEditorWebview.js')
        )
        const nonce = this._getNonce()
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Variable Editor</title>
    <style>
        /* VS Code theme variables */
        body {
            margin: 0; padding: 0;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        #info-bar {
            padding: 4px 8px;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-editorGroup-border);
            font-size: 12px;
            flex-shrink: 0;
        }
        #toolbar {
            padding: 2px 4px;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-editorGroup-border);
            display: flex;
            gap: 4px;
            flex-shrink: 0;
        }
        #grid-root {
            flex: 1;
            overflow: hidden;
            position: relative;
        }
        #disconnected-overlay {
            display: none;
            position: absolute;
            inset: 0;
            background: rgba(0,0,0,0.5);
            align-items: center;
            justify-content: center;
            z-index: 100;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div id="info-bar">Loading...</div>
    <div id="toolbar"></div>
    <div id="grid-root">
        <div id="disconnected-overlay">MATLAB is not connected</div>
    </div>
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
