// Copyright 2025 The MathWorks, Inc.

import * as path from 'path'
import * as vscode from 'vscode'
import { MVM, MatlabMVMConnectionState } from '../commandwindow/MVM'
import { ExtensionToWebviewMessage, MatlabApp, ToolboxInfo, WebviewToExtensionMessage } from './protocol'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MatlabData = any

// MDA (MATLAB Data Array) helpers - mirrors WorkspaceBrowserProvider.ts
const mdaLength = (obj: MatlabData): number => {
    if (obj instanceof Array) return obj.length
    if (obj?.mwsize !== undefined) {
        // mwsize is [rows, cols, ...] — total elements is their product
        return (obj.mwsize as number[]).reduce((a, b) => a * b, 1)
    }
    return 1
}

const mdaUnwrap = (obj: MatlabData, property?: string, index?: number): MatlabData => {
    const handleIndex = (intermediate: MatlabData, idx?: number): MatlabData => {
        if (intermediate instanceof Array) return intermediate[idx ?? 0]
        if (idx !== undefined) {
            if (idx === 0 && intermediate[idx] === undefined) return intermediate
            return intermediate[idx]
        }
        return intermediate
    }
    if (obj?.mwdata !== undefined) {
        if (property !== undefined) return handleIndex(obj.mwdata[property], index)
        return handleIndex(obj.mwdata, index)
    } else {
        if (property !== undefined) return handleIndex(obj[property], index)
        return handleIndex(obj, index)
    }
}

function stemToDisplayName (stem: string): string {
    return stem
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, s => s.toUpperCase())
        .trim()
}

function getNonce (): string {
    let text = ''
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return text
}

export class AppsGalleryViewProvider implements vscode.WebviewViewProvider {
    static readonly viewType = 'matlab.appsGallery'

    private _view?: vscode.WebviewView
    private _cachedApps: MatlabApp[] | null = null
    private _cachedToolboxes: ToolboxInfo[] | null = null

    constructor (
        private readonly _mvm: MVM,
        private readonly _context: vscode.ExtensionContext
    ) {
        _mvm.on(MVM.Events.stateChanged, (_oldState: MatlabMVMConnectionState, newState: MatlabMVMConnectionState) => {
            if (newState === MatlabMVMConnectionState.DISCONNECTED) {
                this._cachedApps = null
                this._cachedToolboxes = null
                this._post({ type: 'disconnected' })
            } else if (newState === MatlabMVMConnectionState.CONNECTED) {
                this._post({ type: 'loading' })
                void this._fetchAndPost()
            }
        })
    }

    resolveWebviewView (
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'out', 'appsgallery')]
        }

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

        webviewView.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
            void this._handleMessage(msg)
        })
    }

    async refresh (): Promise<void> {
        this._cachedApps = null
        this._cachedToolboxes = null
        this._post({ type: 'loading' })
        await this._fetchAndPost()
    }

    private async _handleMessage (msg: WebviewToExtensionMessage): Promise<void> {
        switch (msg.type) {
            case 'ready':
                if (this._cachedApps !== null && this._cachedToolboxes !== null) {
                    this._post({ type: 'galleryData', apps: this._cachedApps, toolboxes: this._cachedToolboxes })
                } else {
                    this._post({ type: 'loading' })
                    await this._fetchAndPost()
                }
                break
            case 'launch':
                if (msg.isCustom && msg.id != null) {
                    await this._mvm.eval(`matlab.apputil.run('${msg.id}')`, true)
                } else {
                    await this._mvm.eval(msg.stem, true)
                }
                break
            case 'refresh':
                await this.refresh()
                break
        }
    }

    private async _fetchAndPost (): Promise<void> {
        const log = vscode.window.createOutputChannel('MATLAB Apps Gallery')
        log.show()
        try {
            const matlabResourceDir = this._context.asAbsolutePath(path.join('resources', 'matlab'))
            log.appendLine(`addpath dir: ${matlabResourceDir}`)
            await this._mvm.eval(`addpath('${matlabResourceDir}')`, false)

            // Force MATLAB to reload the function file in case it's cached
            await this._mvm.eval('clear vsCodeGetAppsGalleryData', false)
            log.appendLine('Calling vsCodeGetAppsGalleryData...')
            const result = await this._mvm.feval<MatlabData>('vsCodeGetAppsGalleryData', 1, [], false)
            log.appendLine(`Raw result: ${JSON.stringify(result, null, 2).slice(0, 4000)}`)

            if (result == null || !('result' in result)) {
                log.appendLine('Result was null or missing result field')
                this._post({ type: 'galleryData', apps: [], toolboxes: [] })
                return
            }

            const raw = result.result[0]
            log.appendLine(`raw keys: ${Object.keys(raw ?? {})}`)
            log.appendLine(`diagnostics: ${JSON.stringify(raw?.diagnostics)}`)
            const { apps, toolboxes } = this._parseResult(raw, log)
            log.appendLine(`Parsed ${apps.length} apps, ${toolboxes.length} toolboxes`)
            this._cachedApps = apps
            this._cachedToolboxes = toolboxes
            this._post({ type: 'galleryData', apps, toolboxes })
        } catch (e) {
            log.appendLine(`Error: ${String(e)}`)
            this._post({ type: 'galleryData', apps: [], toolboxes: [] })
        }
    }

    private _parseResult (raw: MatlabData, log?: vscode.OutputChannel): { apps: MatlabApp[]; toolboxes: ToolboxInfo[] } {
        // Parse toolbox display names to build folder→displayName map later
        const toolboxNames: string[] = []
        const tbxNamesRaw = mdaUnwrap(raw, 'toolboxNames')
        const tbxCount = mdaLength(tbxNamesRaw)
        for (let i = 0; i < tbxCount; i++) {
            const name = String(mdaUnwrap(tbxNamesRaw, undefined, i) ?? '')
            if (name !== '') {
                toolboxNames.push(name)
            }
        }

        // Parse built-in apps — no license filtering: if the .mlapp exists on disk, the toolbox is installed
        const builtinRaw = mdaUnwrap(raw, 'builtinApps')
        const builtinCount = mdaLength(builtinRaw)
        log?.appendLine(`builtinApps raw: ${JSON.stringify(builtinRaw, null, 2).slice(0, 2000)}`)
        log?.appendLine(`builtinCount: ${builtinCount}`)
        const apps: MatlabApp[] = []
        const seenFolders = new Set<string>()

        for (let i = 0; i < builtinCount; i++) {
            const stem = String(mdaUnwrap(mdaUnwrap(builtinRaw, 'stem', i)) ?? '')
            const folder = String(mdaUnwrap(mdaUnwrap(builtinRaw, 'toolboxFolder', i)) ?? '')

            if (stem === '' || folder === '') continue

            apps.push({
                name: stemToDisplayName(stem),
                stem,
                toolboxFolder: folder,
                isCustom: false
            })
            seenFolders.add(folder)
        }

        // Parse custom apps
        const customRaw = mdaUnwrap(raw, 'customApps')
        if (customRaw != null) {
            const customCount = mdaLength(customRaw)
            for (let i = 0; i < customCount; i++) {
                const id = String(mdaUnwrap(mdaUnwrap(customRaw, 'id', i)) ?? '')
                const name = String(mdaUnwrap(mdaUnwrap(customRaw, 'name', i)) ?? '')
                if (id === '' || name === '') continue
                apps.push({
                    name,
                    stem: name,
                    id,
                    toolboxFolder: 'custom',
                    isCustom: true
                })
                seenFolders.add('custom')
            }
        }

        // Build toolbox info list for seen folders
        const toolboxMap = new Map<string, string>()
        for (const name of toolboxNames) {
            toolboxMap.set(name.split(' ')[0].toLowerCase(), name)
        }

        const toolboxes: ToolboxInfo[] = Array.from(seenFolders).sort().map(folder => ({
            folder,
            displayName: folder === 'custom'
                ? 'My Apps'
                : (toolboxMap.get(folder.toLowerCase()) ?? stemToDisplayName(folder))
        }))

        return { apps, toolboxes }
    }

    private _post (msg: ExtensionToWebviewMessage): void {
        void this._view?.webview.postMessage(msg)
    }

    private _getHtmlForWebview (webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'out', 'appsgallery', 'galleryWebview.js')
        )
        const nonce = getNonce()
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MATLAB Apps</title>
    <style>
        body {
            margin: 0; padding: 0;
            background: var(--vscode-sideBar-background);
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
    }
}
