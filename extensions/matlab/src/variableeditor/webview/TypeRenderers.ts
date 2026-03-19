// Copyright 2026 The MathWorks, Inc.

type CellValue =
    | { kind: 'number'; display: string }
    | { kind: 'text'; value: string }
    | { kind: 'logical'; value: boolean }
    | { kind: 'complex'; display: string }
    | { kind: 'nested'; summary: string; cls: string }
    | { kind: 'empty' }

export function renderCellValue (value: CellValue, cls: string, isEditable: boolean): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cell-content'
    el.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px;box-sizing:border-box;'

    switch (value.kind) {
        case 'number':
            el.textContent = value.display
            el.style.textAlign = 'right'
            el.style.justifyContent = 'flex-end'
            el.style.fontFamily = 'monospace'
            break
        case 'text':
            el.textContent = cls === 'char' ? `'${value.value}'` : value.value
            el.style.textAlign = 'left'
            el.style.justifyContent = 'flex-start'
            break
        case 'logical':
            el.textContent = value.value ? '1' : '0'
            el.style.textAlign = 'center'
            el.style.justifyContent = 'center'
            break
        case 'complex':
            el.textContent = value.display
            el.style.textAlign = 'right'
            el.style.justifyContent = 'flex-end'
            el.style.fontFamily = 'monospace'
            break
        case 'nested':
            el.textContent = `[${value.summary}]`
            el.style.color = 'var(--vscode-textLink-foreground)'
            el.style.cursor = 'pointer'
            el.title = `${value.cls} — double-click to open`
            el.style.justifyContent = 'flex-start'
            break
        case 'empty':
            el.textContent = ''
            break
    }
    return el
}

export function getEditInitialValue (value: CellValue, cls: string): string {
    switch (value.kind) {
        case 'number': return value.display
        case 'text': return value.value
        case 'logical': return value.value ? '1' : '0'
        case 'complex': return value.display
        default: return ''
    }
}

export function valueToMatlabExpr (raw: string, cls: string): string {
    const trimmed = raw.trim()
    if (cls === 'char') {
        return `'${trimmed.replace(/'/g, "''")}'`
    }
    if (cls === 'string') {
        return `"${trimmed.replace(/"/g, '""')}"`
    }
    if (cls === 'logical') {
        if (trimmed === '1' || trimmed.toLowerCase() === 'true') return 'true'
        return 'false'
    }
    return trimmed
}
