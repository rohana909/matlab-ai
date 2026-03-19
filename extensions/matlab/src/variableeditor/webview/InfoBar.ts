// Copyright 2026 The MathWorks, Inc.

interface VariableMetadata {
    name: string
    cls: string
    size: number[]
    isEditable: boolean
    columnNames?: string[]
    fieldNames?: string[]
}

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

export class InfoBar {
    constructor (
        private readonly _infoEl: HTMLElement,
        private readonly _toolbarEl: HTMLElement,
        private readonly _sendMessage: (msg: WebviewToExtensionMessage) => void
    ) {}

    update (meta: VariableMetadata): void {
        this._infoEl.innerHTML = `
            <span style="font-weight:bold">${this._escape(meta.name)}</span>
            &nbsp;&nbsp;
            <span style="color:var(--vscode-descriptionForeground)">${meta.size.join('x')}</span>
            &nbsp;&nbsp;
            <span style="color:var(--vscode-descriptionForeground)">${this._escape(meta.cls)}</span>
        `
        this._renderToolbar(meta)
    }

    private _renderToolbar (meta: VariableMetadata): void {
        this._toolbarEl.innerHTML = ''
        if (!meta.isEditable) return

        const isNd = meta.size.length >= 2
        const canRows = isNd || meta.size[0] > 1
        const canCols = isNd && meta.cls !== 'char'

        if (canRows) {
            this._addButton('Insert Row', () => {
                const event = new CustomEvent('variableeditor:insertRow')
                document.dispatchEvent(event)
            })
            this._addButton('Delete Row', () => {
                const event = new CustomEvent('variableeditor:deleteRow')
                document.dispatchEvent(event)
            })
        }
        if (canCols) {
            this._addButton('Insert Column', () => {
                const event = new CustomEvent('variableeditor:insertCol')
                document.dispatchEvent(event)
            })
            this._addButton('Delete Column', () => {
                const event = new CustomEvent('variableeditor:deleteCol')
                document.dispatchEvent(event)
            })
        }
    }

    private _addButton (label: string, onClick: () => void): void {
        const btn = document.createElement('button')
        btn.textContent = label
        btn.style.cssText = 'padding:2px 8px;cursor:pointer;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-button-border,transparent);border-radius:2px;margin-right:4px;font-size:12px;'
        btn.addEventListener('click', onClick)
        this._toolbarEl.appendChild(btn)
    }

    private _escape (s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
}
