// Copyright 2026 The MathWorks, Inc.

import { GridComponent } from './GridComponent.js'
import { InfoBar } from './InfoBar.js'

// ── Protocol types ─────────────────────────────────────────────────────────────

type ExtensionToWebviewMessage =
    | { type: 'init'; variable: VariableMetadata }
    | { type: 'dataPage'; requestId: string; page: DataPage }
    | { type: 'cellData'; requestId: string; data: VariablePayload }
    | { type: 'writeAck'; requestId: string; success: boolean; error?: string }
    | { type: 'structuralAck'; requestId: string; success: boolean; error?: string }
    | { type: 'refresh'; variable: VariableMetadata }
    | { type: 'mvmDisconnected' }
    | { type: 'mvmConnected' }

type WebviewToExtensionMessage =
    | { type: 'ready' }
    | { type: 'requestPage'; requestId: string; startRow: number; startCol: number; rowCount: number; colCount: number }
    | { type: 'requestCellDrill'; requestId: string; row: number; col: number }
    | { type: 'writeCell'; requestId: string; row: number; col: number; value: string }
    | { type: 'writeRange'; requestId: string; startRow: number; startCol: number; values: string[][] }
    | { type: 'insertRow'; requestId: string; afterRow: number }
    | { type: 'deleteRow'; requestId: string; rowIndex: number }
    | { type: 'insertCol'; requestId: string; afterCol: number }
    | { type: 'deleteCol'; requestId: string; colIndex: number }

interface VariableMetadata {
    name: string
    cls: string
    size: number[]
    isEditable: boolean
    columnNames?: string[]
    fieldNames?: string[]
}

interface DataPage {
    startRow: number
    startCol: number
    rows: CellValue[][]
}

type CellValue =
    | { kind: 'number'; display: string }
    | { kind: 'text'; value: string }
    | { kind: 'logical'; value: boolean }
    | { kind: 'complex'; display: string }
    | { kind: 'nested'; summary: string; cls: string }
    | { kind: 'empty' }

interface VariablePayload {
    metadata: VariableMetadata
    firstPage: DataPage
}

// ── Constants ─────────────────────────────────────────────────────────────────
// (Exported for use by GridComponent via shared bundle scope)

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PAGE_ROWS = 50
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PAGE_COLS = 26
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BUFFER_ROWS = 30
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ROW_HEIGHT_PX = 24
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const COL_WIDTH_PX = 100
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ROW_NUM_COL_WIDTH_PX = 60

// ── VS Code API ───────────────────────────────────────────────────────────────

declare function acquireVsCodeApi (): {
    postMessage (msg: WebviewToExtensionMessage): void
    getState (): unknown
    setState (state: unknown): void
}

const vscodeApi = acquireVsCodeApi()

function sendMessage (msg: WebviewToExtensionMessage): void {
    vscodeApi.postMessage(msg)
}

// ── Global styles ─────────────────────────────────────────────────────────────

function injectGlobalStyles (): void {
    const style = document.createElement('style')
    style.textContent = `
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 0;
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-editor-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
            font-size: var(--vscode-editor-font-size, 13px);
        }
        #header-area {
            display: flex;
            flex-direction: row;
            align-items: center;
            padding: 4px 8px;
            border-bottom: 1px solid var(--vscode-editorGroup-border, #444);
            background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
            flex-shrink: 0;
            gap: 16px;
            min-height: 32px;
        }
        #info-bar {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 13px;
        }
        #toolbar {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        #grid-root {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        #disconnected-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 100;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 12px;
        }
        #disconnected-overlay .overlay-message {
            color: var(--vscode-editor-foreground);
            font-size: 16px;
            background: var(--vscode-editorWidget-background, #252526);
            padding: 24px 32px;
            border-radius: 4px;
            border: 1px solid var(--vscode-editorWidget-border, #454545);
            text-align: center;
        }
        .cell-content {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding: 0 4px;
            box-sizing: border-box;
        }
    `
    document.head.appendChild(style)
}

// ── Main entry point ──────────────────────────────────────────────────────────

injectGlobalStyles()

let grid: GridComponent | null = null

const infoBarEl = document.getElementById('info-bar')
const toolbarEl = document.getElementById('toolbar')
const gridRootEl = document.getElementById('grid-root')

if (infoBarEl === null || toolbarEl === null || gridRootEl === null) {
    console.error('[VariableEditor] Required DOM elements not found. Expected #info-bar, #toolbar, #grid-root.')
}

const infoBar = new InfoBar(
    infoBarEl ?? document.createElement('div'),
    toolbarEl ?? document.createElement('div'),
    sendMessage
)

window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as ExtensionToWebviewMessage
    switch (msg.type) {
        case 'init':
            infoBar.update(msg.variable)
            if (gridRootEl !== null) {
                gridRootEl.innerHTML = ''
                grid = new GridComponent(gridRootEl, msg.variable, sendMessage)
            }
            break

        case 'dataPage':
            grid?.receivePage(msg.requestId, msg.page)
            break

        case 'writeAck':
            grid?.receiveWriteAck(msg.requestId, msg.success, msg.error)
            break

        case 'structuralAck':
            grid?.receiveStructuralAck(msg.requestId, msg.success, msg.error)
            break

        case 'cellData':
            // Future: open drill-down panel
            break

        case 'refresh':
            infoBar.update(msg.variable)
            grid?.handleRefresh(msg.variable)
            break

        case 'mvmDisconnected': {
            const overlay = document.getElementById('disconnected-overlay')
            if (overlay !== null) overlay.style.display = 'flex'
            break
        }

        case 'mvmConnected': {
            const overlay = document.getElementById('disconnected-overlay')
            if (overlay !== null) overlay.style.display = 'none'
            break
        }
    }
})

// Signal ready to the extension host
sendMessage({ type: 'ready' })
