// Copyright 2026 The MathWorks, Inc.

import { renderCellValue, getEditInitialValue, valueToMatlabExpr } from './TypeRenderers.js'

// ── Protocol types (duplicated from shared protocol for webview bundle) ────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_ROWS = 50
const PAGE_COLS = 26
const BUFFER_ROWS = 30
const ROW_HEIGHT_PX = 24
const COL_WIDTH_PX = 100
const ROW_NUM_COL_WIDTH_PX = 60

// ── Helpers ───────────────────────────────────────────────────────────────────

function genRequestId (): string {
    return Math.random().toString(36).substring(2, 11)
}

// ── GridComponent ─────────────────────────────────────────────────────────────

type PendingRequest =
    | { type: 'page'; pageKey: string }
    | { type: 'write'; row: number; col: number; prevDisplay: string }
    | { type: 'structural' }

export class GridComponent {
    private _meta: VariableMetadata
    private readonly _container: HTMLElement
    private readonly _scrollEl: HTMLElement
    private readonly _innerEl: HTMLElement
    private readonly _headerEl: HTMLElement
    private readonly _rowsEl: HTMLElement
    private _rowEls = new Map<number, HTMLElement>()
    private _pageCache = new Map<string, DataPage>()
    private _pendingRequests = new Map<string, PendingRequest>()
    private _pendingPageKeys = new Set<string>()
    private _selection: { row: number; col: number } | null = null
    private _editingInput: HTMLInputElement | null = null
    private _editingCell: { row: number; col: number } | null = null
    private _sendMessage: (msg: WebviewToExtensionMessage) => void
    private _scrollDebounceTimer: ReturnType<typeof setTimeout> | null = null

    constructor (
        root: HTMLElement,
        meta: VariableMetadata,
        sendMessage: (msg: WebviewToExtensionMessage) => void
    ) {
        this._meta = meta
        this._container = root
        this._sendMessage = sendMessage

        this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;'

        // Sticky header container (sits above scroll area)
        this._headerEl = document.createElement('div')
        this._headerEl.className = 'grid-header'
        this._headerEl.style.cssText = [
            'display:flex;flex-direction:row;flex-shrink:0;',
            'background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background));',
            'border-bottom:1px solid var(--vscode-editorGroup-border,#444);',
            'z-index:10;',
            'overflow:hidden;',
        ].join('')
        this._container.appendChild(this._headerEl)

        // Scroll area
        this._scrollEl = document.createElement('div')
        this._scrollEl.style.cssText = 'flex:1;overflow:auto;position:relative;'
        this._container.appendChild(this._scrollEl)

        // Inner spacer for correct scrollbar range
        this._innerEl = document.createElement('div')
        this._innerEl.style.cssText = 'position:relative;'
        this._scrollEl.appendChild(this._innerEl)

        // Rows container (absolutely positioned children)
        this._rowsEl = document.createElement('div')
        this._rowsEl.style.cssText = 'position:absolute;top:0;left:0;'
        this._innerEl.appendChild(this._rowsEl)

        this._applyDimensions()
        this._renderHeader()

        this._scrollEl.addEventListener('scroll', () => {
            this._onScroll()
        }, { passive: true })

        // Keyboard navigation
        this._scrollEl.addEventListener('keydown', (e: KeyboardEvent) => {
            this._handleKeyDown(e)
        })
        this._scrollEl.setAttribute('tabindex', '0')

        // Toolbar structural-action events from InfoBar
        document.addEventListener('variableeditor:insertRow', () => {
            if (this._selection !== null) {
                this._doInsertRow(this._selection.row)
            }
        })
        document.addEventListener('variableeditor:deleteRow', () => {
            if (this._selection !== null) {
                this._doDeleteRow(this._selection.row)
            }
        })
        document.addEventListener('variableeditor:insertCol', () => {
            if (this._selection !== null) {
                this._doInsertCol(this._selection.col)
            }
        })
        document.addEventListener('variableeditor:deleteCol', () => {
            if (this._selection !== null) {
                this._doDeleteCol(this._selection.col)
            }
        })

        this._fetchMissingPages()
        this._renderVisibleRows()
    }

    // ── Dimensions ──────────────────────────────────────────────────────────

    private _totalRows (): number {
        return this._meta.size.length >= 1 ? this._meta.size[0] : 0
    }

    private _totalCols (): number {
        return this._meta.size.length >= 2 ? this._meta.size[1] : 1
    }

    private _applyDimensions (): void {
        const totalRows = this._totalRows()
        const totalCols = this._totalCols()
        const totalHeight = totalRows * ROW_HEIGHT_PX
        const totalWidth = ROW_NUM_COL_WIDTH_PX + totalCols * COL_WIDTH_PX
        this._innerEl.style.height = `${totalHeight}px`
        this._innerEl.style.width = `${totalWidth}px`
        this._rowsEl.style.width = `${totalWidth}px`
    }

    // ── Header ──────────────────────────────────────────────────────────────

    private _renderHeader (): void {
        this._headerEl.innerHTML = ''

        const totalCols = this._totalCols()

        // Row-number gutter cell
        const cornerCell = document.createElement('div')
        cornerCell.style.cssText = this._rowNumCellStyle() + 'font-weight:bold;'
        cornerCell.textContent = ''
        this._headerEl.appendChild(cornerCell)

        // Column header cells
        for (let c = 0; c < totalCols; c++) {
            const cell = document.createElement('div')
            cell.style.cssText = this._headerCellStyle()
            cell.textContent = this._colLabel(c)
            this._headerEl.appendChild(cell)
        }
    }

    private _colLabel (colIndex: number): string {
        const meta = this._meta
        if (meta.cls === 'struct' && meta.fieldNames !== undefined && meta.fieldNames[colIndex] !== undefined) {
            return meta.fieldNames[colIndex]
        }
        if (meta.cls === 'table' && meta.columnNames !== undefined && meta.columnNames[colIndex] !== undefined) {
            return meta.columnNames[colIndex]
        }
        return String(colIndex + 1)
    }

    // ── Style helpers ────────────────────────────────────────────────────────

    private _rowNumCellStyle (): string {
        return [
            `width:${ROW_NUM_COL_WIDTH_PX}px;min-width:${ROW_NUM_COL_WIDTH_PX}px;`,
            `height:${ROW_HEIGHT_PX}px;`,
            'display:flex;align-items:center;justify-content:flex-end;',
            'padding:0 6px;box-sizing:border-box;',
            'background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background));',
            'color:var(--vscode-descriptionForeground);',
            'font-size:12px;',
            'border-right:1px solid var(--vscode-editorGroup-border,#444);',
            'flex-shrink:0;',
            'user-select:none;',
        ].join('')
    }

    private _headerCellStyle (): string {
        return [
            `width:${COL_WIDTH_PX}px;min-width:${COL_WIDTH_PX}px;`,
            `height:${ROW_HEIGHT_PX}px;`,
            'display:flex;align-items:center;justify-content:center;',
            'padding:0 4px;box-sizing:border-box;',
            'font-weight:bold;font-size:12px;',
            'border-right:1px solid var(--vscode-editorGroup-border,#444);',
            'flex-shrink:0;',
            'user-select:none;',
        ].join('')
    }

    private _dataCellStyle (selected: boolean): string {
        const bg = selected
            ? 'var(--vscode-list-activeSelectionBackground)'
            : 'var(--vscode-editor-background)'
        const fg = selected
            ? 'var(--vscode-list-activeSelectionForeground)'
            : 'var(--vscode-editor-foreground)'
        return [
            `width:${COL_WIDTH_PX}px;min-width:${COL_WIDTH_PX}px;`,
            `height:${ROW_HEIGHT_PX}px;`,
            `background:${bg};color:${fg};`,
            'display:flex;align-items:center;',
            'box-sizing:border-box;',
            'border-right:1px solid var(--vscode-editorGroup-border,#444);',
            'border-bottom:1px solid var(--vscode-editorGroup-border,#333);',
            'overflow:hidden;',
            'cursor:default;',
            'flex-shrink:0;',
            'position:relative;',
        ].join('')
    }

    // ── Page cache ───────────────────────────────────────────────────────────

    private _pageKey (startRow: number, startCol: number): string {
        return `${startRow}:${startCol}`
    }

    private _pageStart (index: number, pageSize: number): number {
        return Math.floor(index / pageSize) * pageSize
    }

    private _requestPage (startRow: number, startCol: number): void {
        const key = this._pageKey(startRow, startCol)
        if (this._pageCache.has(key) || this._pendingPageKeys.has(key)) return

        const requestId = genRequestId()
        this._pendingPageKeys.add(key)
        this._pendingRequests.set(requestId, { type: 'page', pageKey: key })
        this._sendMessage({
            type: 'requestPage',
            requestId,
            startRow,
            startCol,
            rowCount: PAGE_ROWS,
            colCount: PAGE_COLS,
        })
    }

    private _fetchMissingPages (): void {
        const { start, end } = this._getVisibleRange()
        const bufferedStart = Math.max(0, start - BUFFER_ROWS)
        const bufferedEnd = Math.min(this._totalRows() - 1, end + BUFFER_ROWS)

        for (let r = bufferedStart; r <= bufferedEnd; r += PAGE_ROWS) {
            const pageRow = this._pageStart(r, PAGE_ROWS)
            // For now, fetch all column pages needed
            for (let c = 0; c < this._totalCols(); c += PAGE_COLS) {
                const pageCol = this._pageStart(c, PAGE_COLS)
                this._requestPage(pageRow, pageCol)
            }
        }
    }

    // ── Visible range ────────────────────────────────────────────────────────

    private _getVisibleRange (): { start: number; end: number } {
        const scrollTop = this._scrollEl.scrollTop
        const clientHeight = this._scrollEl.clientHeight
        const start = Math.floor(scrollTop / ROW_HEIGHT_PX)
        const end = Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT_PX)
        return {
            start: Math.max(0, start),
            end: Math.min(this._totalRows() - 1, end),
        }
    }

    // ── Scroll handler ───────────────────────────────────────────────────────

    private _onScroll (): void {
        if (this._scrollDebounceTimer !== null) {
            clearTimeout(this._scrollDebounceTimer)
        }
        this._scrollDebounceTimer = setTimeout(() => {
            this._scrollDebounceTimer = null
            this._fetchMissingPages()
            this._renderVisibleRows()
            // Sync header horizontal scroll
            this._headerEl.scrollLeft = this._scrollEl.scrollLeft
        }, 16)
    }

    // ── Render ───────────────────────────────────────────────────────────────

    private _renderVisibleRows (): void {
        const { start, end } = this._getVisibleRange()
        const bufferedStart = Math.max(0, start - BUFFER_ROWS)
        const bufferedEnd = Math.min(this._totalRows() - 1, end + BUFFER_ROWS)

        // Remove rows outside buffer
        for (const [rowIndex, el] of this._rowEls) {
            if (rowIndex < bufferedStart || rowIndex > bufferedEnd) {
                el.remove()
                this._rowEls.delete(rowIndex)
            }
        }

        // Add missing rows in range
        for (let r = bufferedStart; r <= bufferedEnd; r++) {
            if (!this._rowEls.has(r)) {
                const rowEl = this._renderRow(r)
                this._rowsEl.appendChild(rowEl)
                this._rowEls.set(r, rowEl)
            }
        }
    }

    private _renderRow (rowIndex: number): HTMLElement {
        const totalCols = this._totalCols()
        const rowEl = document.createElement('div')
        rowEl.style.cssText = [
            'position:absolute;',
            'display:flex;flex-direction:row;',
            `top:${rowIndex * ROW_HEIGHT_PX}px;`,
            `height:${ROW_HEIGHT_PX}px;`,
        ].join('')
        rowEl.dataset.row = String(rowIndex)

        // Row number cell
        const rowNumEl = document.createElement('div')
        rowNumEl.style.cssText = this._rowNumCellStyle()
        rowNumEl.textContent = String(rowIndex + 1)
        rowEl.appendChild(rowNumEl)

        // Data cells
        for (let c = 0; c < totalCols; c++) {
            const cellEl = this._renderCell(rowIndex, c)
            rowEl.appendChild(cellEl)
        }

        return rowEl
    }

    private _getCellValue (rowIndex: number, colIndex: number): CellValue | null {
        const pageRow = this._pageStart(rowIndex, PAGE_ROWS)
        const pageCol = this._pageStart(colIndex, PAGE_COLS)
        const key = this._pageKey(pageRow, pageCol)
        const page = this._pageCache.get(key)
        if (page === undefined) return null

        const localRow = rowIndex - page.startRow
        const localCol = colIndex - page.startCol
        if (
            localRow < 0 ||
            localCol < 0 ||
            localRow >= page.rows.length ||
            localCol >= (page.rows[localRow]?.length ?? 0)
        ) {
            return null
        }
        return page.rows[localRow][localCol]
    }

    private _renderCell (rowIndex: number, colIndex: number): HTMLElement {
        const isSelected =
            this._selection !== null &&
            this._selection.row === rowIndex &&
            this._selection.col === colIndex

        const cellEl = document.createElement('div')
        cellEl.style.cssText = this._dataCellStyle(isSelected)
        cellEl.dataset.row = String(rowIndex)
        cellEl.dataset.col = String(colIndex)

        const value = this._getCellValue(rowIndex, colIndex)
        if (value === null) {
            // Placeholder while loading
            const placeholder = document.createElement('div')
            placeholder.style.cssText = 'padding:0 4px;color:var(--vscode-descriptionForeground);font-style:italic;'
            placeholder.textContent = '...'
            cellEl.appendChild(placeholder)
        } else {
            const content = renderCellValue(value, this._meta.cls, this._meta.isEditable)
            cellEl.appendChild(content)
        }

        // Click handler
        cellEl.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation()
            this._handleCellClick(rowIndex, colIndex, cellEl)
        })

        // Double-click to edit or drill
        cellEl.addEventListener('dblclick', (e: MouseEvent) => {
            e.stopPropagation()
            this._handleCellDblClick(rowIndex, colIndex, cellEl)
        })

        return cellEl
    }

    private _refreshCell (rowIndex: number, colIndex: number): void {
        const rowEl = this._rowEls.get(rowIndex)
        if (rowEl === undefined) return
        // col 0 is row num cell, data cells start at index 1
        const cellEl = rowEl.children[colIndex + 1] as HTMLElement | undefined
        if (cellEl === undefined) return

        const isSelected =
            this._selection !== null &&
            this._selection.row === rowIndex &&
            this._selection.col === colIndex
        cellEl.style.cssText = this._dataCellStyle(isSelected)
        cellEl.innerHTML = ''

        const value = this._getCellValue(rowIndex, colIndex)
        if (value === null) {
            const placeholder = document.createElement('div')
            placeholder.style.cssText = 'padding:0 4px;color:var(--vscode-descriptionForeground);font-style:italic;'
            placeholder.textContent = '...'
            cellEl.appendChild(placeholder)
        } else {
            const content = renderCellValue(value, this._meta.cls, this._meta.isEditable)
            cellEl.appendChild(content)
        }
    }

    // ── Selection ────────────────────────────────────────────────────────────

    private _handleCellClick (row: number, col: number, cellEl: HTMLElement): void {
        if (this._editingCell !== null) {
            this._commitEditFromBlur()
        }

        const prev = this._selection
        this._selection = { row, col }

        // Deselect previous
        if (prev !== null && !(prev.row === row && prev.col === col)) {
            this._refreshCell(prev.row, prev.col)
        }

        // Highlight new
        cellEl.style.background = 'var(--vscode-list-activeSelectionBackground)'
        cellEl.style.color = 'var(--vscode-list-activeSelectionForeground)'
    }

    private _handleCellDblClick (row: number, col: number, cellEl: HTMLElement): void {
        const value = this._getCellValue(row, col)
        if (value === null) return

        if (value.kind === 'nested') {
            const requestId = genRequestId()
            this._sendMessage({ type: 'requestCellDrill', requestId, row, col })
            return
        }

        if (this._meta.isEditable) {
            const initial = getEditInitialValue(value, this._meta.cls)
            this._startEdit(row, col, cellEl, initial)
        }
    }

    // ── Keyboard ─────────────────────────────────────────────────────────────

    private _handleKeyDown (e: KeyboardEvent): void {
        if (this._editingCell !== null) return
        if (this._selection === null) return

        const { row, col } = this._selection
        const totalRows = this._totalRows()
        const totalCols = this._totalCols()

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault()
                if (row > 0) this._selectCell(row - 1, col)
                break
            case 'ArrowDown':
            case 'Enter':
                e.preventDefault()
                if (row < totalRows - 1) this._selectCell(row + 1, col)
                break
            case 'ArrowLeft':
                e.preventDefault()
                if (col > 0) this._selectCell(row, col - 1)
                break
            case 'ArrowRight':
            case 'Tab':
                e.preventDefault()
                if (col < totalCols - 1) this._selectCell(row, col + 1)
                break
            case 'Escape':
                this._cancelEdit()
                break
            case 'Delete':
            case 'Backspace':
                if (this._meta.isEditable) {
                    this._startEditInCell(row, col, '')
                }
                break
            default:
                // Printable character — start editing
                if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && this._meta.isEditable) {
                    this._startEditInCell(row, col, e.key)
                }
                break
        }
    }

    private _selectCell (row: number, col: number): void {
        const prev = this._selection
        this._selection = { row, col }
        if (prev !== null) this._refreshCell(prev.row, prev.col)

        // Scroll cell into view if needed
        this._scrollCellIntoView(row, col)

        // Re-render row to show selection highlight
        const rowEl = this._rowEls.get(row)
        if (rowEl !== undefined) {
            const cellEl = rowEl.children[col + 1] as HTMLElement | undefined
            if (cellEl !== undefined) {
                cellEl.style.background = 'var(--vscode-list-activeSelectionBackground)'
                cellEl.style.color = 'var(--vscode-list-activeSelectionForeground)'
            }
        }
    }

    private _scrollCellIntoView (row: number, col: number): void {
        const rowTop = row * ROW_HEIGHT_PX
        const rowBottom = rowTop + ROW_HEIGHT_PX
        const scrollTop = this._scrollEl.scrollTop
        const clientHeight = this._scrollEl.clientHeight

        if (rowTop < scrollTop) {
            this._scrollEl.scrollTop = rowTop
        } else if (rowBottom > scrollTop + clientHeight) {
            this._scrollEl.scrollTop = rowBottom - clientHeight
        }

        const colLeft = ROW_NUM_COL_WIDTH_PX + col * COL_WIDTH_PX
        const colRight = colLeft + COL_WIDTH_PX
        const scrollLeft = this._scrollEl.scrollLeft
        const clientWidth = this._scrollEl.clientWidth

        if (colLeft < scrollLeft) {
            this._scrollEl.scrollLeft = colLeft
        } else if (colRight > scrollLeft + clientWidth) {
            this._scrollEl.scrollLeft = colRight - clientWidth
        }
    }

    // ── Editing ───────────────────────────────────────────────────────────────

    private _startEditInCell (row: number, col: number, initialText: string): void {
        const rowEl = this._rowEls.get(row)
        if (rowEl === undefined) return
        const cellEl = rowEl.children[col + 1] as HTMLElement | undefined
        if (cellEl === undefined) return
        this._startEdit(row, col, cellEl, initialText)
    }

    private _startEdit (row: number, col: number, cellEl: HTMLElement, currentDisplay: string): void {
        if (this._editingCell !== null) {
            this._commitEditFromBlur()
        }

        this._editingCell = { row, col }

        const input = document.createElement('input')
        input.type = 'text'
        input.value = currentDisplay
        input.style.cssText = [
            'position:absolute;',
            'top:0;left:0;',
            `width:${COL_WIDTH_PX}px;`,
            `height:${ROW_HEIGHT_PX}px;`,
            'box-sizing:border-box;',
            'padding:0 4px;',
            'font-size:inherit;',
            'font-family:inherit;',
            'background:var(--vscode-input-background);',
            'color:var(--vscode-input-foreground);',
            'border:1px solid var(--vscode-focusBorder);',
            'outline:none;',
            'z-index:20;',
        ].join('')

        this._editingInput = input
        cellEl.style.position = 'relative'
        cellEl.appendChild(input)
        input.focus()
        input.select()

        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                const value = this._getCellValue(row, col)
                const prev = value !== null ? getEditInitialValue(value, this._meta.cls) : ''
                this._commitEdit(row, col, input.value, prev)
            } else if (e.key === 'Tab') {
                e.preventDefault()
                const value = this._getCellValue(row, col)
                const prev = value !== null ? getEditInitialValue(value, this._meta.cls) : ''
                this._commitEdit(row, col, input.value, prev)
                // Move to next column
                const totalCols = this._totalCols()
                if (col + 1 < totalCols) this._selectCell(row, col + 1)
            } else if (e.key === 'Escape') {
                e.preventDefault()
                this._cancelEdit()
            }
        })

        input.addEventListener('blur', () => {
            // Only commit if still editing this cell
            if (this._editingCell !== null &&
                this._editingCell.row === row &&
                this._editingCell.col === col
            ) {
                const value = this._getCellValue(row, col)
                const prev = value !== null ? getEditInitialValue(value, this._meta.cls) : ''
                this._commitEdit(row, col, input.value, prev)
            }
        })
    }

    private _commitEditFromBlur (): void {
        if (this._editingCell === null || this._editingInput === null) return
        const { row, col } = this._editingCell
        const value = this._getCellValue(row, col)
        const prev = value !== null ? getEditInitialValue(value, this._meta.cls) : ''
        this._commitEdit(row, col, this._editingInput.value, prev)
    }

    private _commitEdit (row: number, col: number, newValue: string, prevDisplay: string): void {
        this._cancelEdit()

        const expr = valueToMatlabExpr(newValue, this._meta.cls)
        const requestId = genRequestId()
        this._pendingRequests.set(requestId, { type: 'write', row, col, prevDisplay })

        // Optimistically update display
        this._updateCellDisplay(row, col, newValue)

        this._sendMessage({ type: 'writeCell', requestId, row, col, value: expr })
    }

    private _cancelEdit (): void {
        if (this._editingInput !== null) {
            this._editingInput.remove()
            this._editingInput = null
        }
        this._editingCell = null
    }

    private _updateCellDisplay (row: number, col: number, displayText: string): void {
        // Invalidate cache for this cell's page so it will be re-fetched after ack
        const pageRow = this._pageStart(row, PAGE_ROWS)
        const pageCol = this._pageStart(col, PAGE_COLS)
        const key = this._pageKey(pageRow, pageCol)
        // Update the cached cell value optimistically
        const page = this._pageCache.get(key)
        if (page !== undefined) {
            const localRow = row - page.startRow
            const localCol = col - page.startCol
            if (
                localRow >= 0 &&
                localCol >= 0 &&
                localRow < page.rows.length &&
                localCol < (page.rows[localRow]?.length ?? 0)
            ) {
                const currentVal = page.rows[localRow][localCol]
                // Update display optimistically based on kind
                if (currentVal.kind === 'number') {
                    page.rows[localRow][localCol] = { kind: 'number', display: displayText }
                } else if (currentVal.kind === 'text') {
                    page.rows[localRow][localCol] = { kind: 'text', value: displayText }
                } else if (currentVal.kind === 'logical') {
                    page.rows[localRow][localCol] = { kind: 'logical', value: displayText === '1' || displayText.toLowerCase() === 'true' }
                }
            }
        }
        this._refreshCell(row, col)
    }

    // ── Structural operations ─────────────────────────────────────────────────

    private _doInsertRow (afterRow: number): void {
        const requestId = genRequestId()
        this._pendingRequests.set(requestId, { type: 'structural' })
        this._sendMessage({ type: 'insertRow', requestId, afterRow })
    }

    private _doDeleteRow (rowIndex: number): void {
        const requestId = genRequestId()
        this._pendingRequests.set(requestId, { type: 'structural' })
        this._sendMessage({ type: 'deleteRow', requestId, rowIndex })
    }

    private _doInsertCol (afterCol: number): void {
        const requestId = genRequestId()
        this._pendingRequests.set(requestId, { type: 'structural' })
        this._sendMessage({ type: 'insertCol', requestId, afterCol })
    }

    private _doDeleteCol (colIndex: number): void {
        const requestId = genRequestId()
        this._pendingRequests.set(requestId, { type: 'structural' })
        this._sendMessage({ type: 'deleteCol', requestId, colIndex })
    }

    // ── Public API ────────────────────────────────────────────────────────────

    receivePage (requestId: string, page: DataPage): void {
        const pending = this._pendingRequests.get(requestId)
        if (pending !== undefined && pending.type === 'page') {
            this._pendingRequests.delete(requestId)
            this._pendingPageKeys.delete(pending.pageKey)
        }

        const key = this._pageKey(page.startRow, page.startCol)
        this._pageCache.set(key, page)

        // Re-render affected rows
        const endRow = Math.min(page.startRow + page.rows.length - 1, this._totalRows() - 1)
        for (let r = page.startRow; r <= endRow; r++) {
            if (this._rowEls.has(r)) {
                const rowEl = this._renderRow(r)
                const old = this._rowEls.get(r)
                if (old !== undefined) {
                    old.replaceWith(rowEl)
                }
                this._rowEls.set(r, rowEl)
            }
        }
    }

    receiveWriteAck (requestId: string, success: boolean, error?: string): void {
        const pending = this._pendingRequests.get(requestId)
        if (pending === undefined || pending.type !== 'write') return
        this._pendingRequests.delete(requestId)

        if (!success) {
            // Revert optimistic update — invalidate and re-fetch
            const pageRow = this._pageStart(pending.row, PAGE_ROWS)
            const pageCol = this._pageStart(pending.col, PAGE_COLS)
            const key = this._pageKey(pageRow, pageCol)
            this._pageCache.delete(key)
            this._fetchMissingPages()
            this._renderVisibleRows()

            if (error !== undefined && error.length > 0) {
                // Show brief error in cell
                this._showCellError(pending.row, pending.col, error)
            }
        } else {
            // On success re-fetch the page to get MATLAB's canonical display
            const pageRow = this._pageStart(pending.row, PAGE_ROWS)
            const pageCol = this._pageStart(pending.col, PAGE_COLS)
            const key = this._pageKey(pageRow, pageCol)
            this._pageCache.delete(key)
            this._pendingPageKeys.delete(key)
            this._requestPage(pageRow, pageCol)
        }
    }

    receiveStructuralAck (requestId: string, success: boolean, error?: string): void {
        this._pendingRequests.delete(requestId)
        if (!success && error !== undefined && error.length > 0) {
            console.error('[VariableEditor] Structural operation failed:', error)
        }
        // Refresh will be triggered by a 'refresh' message from the extension host
    }

    handleRefresh (meta: VariableMetadata): void {
        this._meta = meta
        this._invalidateCache()
        this._applyDimensions()
        this._renderHeader()
        this._fetchMissingPages()
        this._renderVisibleRows()
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private _invalidateCache (): void {
        this._pageCache.clear()
        this._pendingPageKeys.clear()
        // Clear all rendered rows
        for (const el of this._rowEls.values()) {
            el.remove()
        }
        this._rowEls.clear()
        this._selection = null
        this._editingCell = null
        this._editingInput = null
    }

    private _showCellError (row: number, col: number, message: string): void {
        const rowEl = this._rowEls.get(row)
        if (rowEl === undefined) return
        const cellEl = rowEl.children[col + 1] as HTMLElement | undefined
        if (cellEl === undefined) return

        cellEl.title = message
        cellEl.style.border = '1px solid var(--vscode-inputValidation-errorBorder,red)'
        setTimeout(() => {
            if (cellEl !== undefined) {
                cellEl.title = ''
                cellEl.style.border = ''
            }
        }, 3000)
    }
}
