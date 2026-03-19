// Copyright 2026 The MathWorks, Inc.

import { MVMError } from '../commandwindow/MVMInterface'
import { MVM } from '../commandwindow/MVM'
import {
    CellValue,
    DataPage,
    VariableMetadata,
    VariablePayload,
    PAGE_ROWS,
    PAGE_COLS
} from './protocol'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MatlabData = any

// ---------------------------------------------------------------------------
// MDA (MATLAB Data Array) unwrap helpers — mirrors WorkspaceBrowserProvider.ts
// ---------------------------------------------------------------------------

const mdaLength = (obj: MatlabData): number => {
    if (obj instanceof Array) return obj.length
    if (obj?.mwsize !== undefined) return obj.mwsize[0]
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

// ---------------------------------------------------------------------------
// Helper: classify a MATLAB class string
// ---------------------------------------------------------------------------

const NUMERIC_CLASSES = new Set([
    'double', 'single',
    'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64'
])

const EDITABLE_CLASSES = new Set([
    'double', 'single',
    'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'char', 'string', 'logical', 'cell', 'struct', 'table'
])

function isNumericClass (cls: string): boolean {
    return NUMERIC_CLASSES.has(cls)
}

function isEditableClass (cls: string): boolean {
    return EDITABLE_CLASSES.has(cls)
}

// ---------------------------------------------------------------------------
// Helper: format a scalar JS number for display
// ---------------------------------------------------------------------------

function formatNumber (val: MatlabData): string {
    if (val === null || val === undefined) return ''
    const n = Number(val)
    if (isNaN(n)) return String(val)
    return String(n)
}

// ---------------------------------------------------------------------------
// Helper: convert a raw MDA scalar value to CellValue
// ---------------------------------------------------------------------------

function toCellValue (val: MatlabData, cls: string): CellValue {
    if (val === null || val === undefined) {
        return { kind: 'empty' }
    }

    // Complex numbers arrive as objects with re/im properties
    if (typeof val === 'object' && val !== null && ('re' in val || 'im' in val)) {
        const re = val.re ?? 0
        const im = val.im ?? 0
        const sign = im < 0 ? '-' : '+'
        return { kind: 'complex', display: `${formatNumber(re)}${sign}${formatNumber(Math.abs(im))}i` }
    }

    if (isNumericClass(cls)) {
        return { kind: 'number', display: formatNumber(val) }
    }

    if (cls === 'logical') {
        return { kind: 'logical', value: Boolean(val) }
    }

    if (cls === 'char' || cls === 'string') {
        return { kind: 'text', value: String(val) }
    }

    if (cls === 'cell' || cls === 'struct') {
        return { kind: 'nested', summary: String(val), cls }
    }

    // Fallback for anything else (function_handle, user-defined, etc.)
    return { kind: 'nested', summary: String(val), cls }
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

/**
 * Sole owner of all MATLAB communication for the Variable Editor.
 * All reads and writes go through this class via mvm.feval() / mvm.eval().
 * Uses 1-indexed rows and columns (MATLAB convention).
 */
export class VariableDataService {
    constructor (private readonly _mvm: MVM) {}

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private _isMVMError (result: unknown): result is MVMError {
        return result !== null && typeof result === 'object' && 'isError' in result
    }

    /**
     * Thin wrapper around mvm.feval that throws a descriptive Error on failure.
     */
    private async _feval<T> (
        functionName: string,
        nargout: number,
        args: unknown[],
        context: string
    ): Promise<T[]> {
        const result = await this._mvm.feval<T>(functionName, nargout, args, false)
        if (this._isMVMError(result)) {
            throw new Error(`VariableDataService(${context}): MATLAB feval '${functionName}' returned an error`)
        }
        if (result == null || !('result' in result)) {
            throw new Error(`VariableDataService(${context}): MATLAB feval '${functionName}' returned no result`)
        }
        return result.result
    }

    /**
     * Thin wrapper around mvm.eval that throws a descriptive Error on failure.
     */
    private async _eval (command: string, context: string): Promise<void> {
        try {
            await this._mvm.eval(command, false)
        } catch (err) {
            throw new Error(`VariableDataService(${context}): MATLAB eval failed — ${String(err)}`)
        }
    }

    // -----------------------------------------------------------------------
    // getMetadata
    // -----------------------------------------------------------------------

    /**
     * Retrieve metadata (class, size, editability, column/field names) for a
     * workspace variable.  Tries the official internal service first and falls
     * back to `whos` when that is unavailable.
     */
    async getMetadata (varName: string): Promise<VariableMetadata> {
        // Use whos directly — the internal service functions may not exist in all
        // MATLAB builds and calling them produces an audible error beep when missing.
        return await this._getMetadataViaWhos(varName)
    }

    private async _getMetadataViaService (varName: string): Promise<VariableMetadata> {
        const res = await this._feval<MatlabData>(
            'matlab.internal.datatoolsservices.getVariableEditorInfo',
            1,
            ['base', varName],
            'getMetadata/service'
        )
        const raw = res[0]

        const cls = String(mdaUnwrap(raw, 'class') ?? mdaUnwrap(raw, 'Class') ?? '')
        const sizeRaw = mdaUnwrap(raw, 'size') ?? mdaUnwrap(raw, 'Size')
        const size = this._parseSizeArray(sizeRaw)

        const metadata: VariableMetadata = {
            name: varName,
            cls,
            size,
            isEditable: isEditableClass(cls)
        }

        // column names for table
        if (cls === 'table') {
            metadata.columnNames = await this._getTableColumnNames(varName)
        }

        // field names for struct
        if (cls === 'struct') {
            metadata.fieldNames = await this._getStructFieldNames(varName)
        }

        return metadata
    }

    private async _getMetadataViaWhos (varName: string): Promise<VariableMetadata> {
        const res = await this._feval<MatlabData>(
            'whos',
            1,
            ['in', 'base', varName],
            'getMetadata/whos'
        )
        const raw = res[0]

        const cls = String(mdaUnwrap(raw, 'class') ?? mdaUnwrap(raw, 'Class') ?? 'double')
        const sizeRaw = mdaUnwrap(raw, 'size') ?? mdaUnwrap(raw, 'Size')
        const size = this._parseSizeArray(sizeRaw)

        const metadata: VariableMetadata = {
            name: varName,
            cls,
            size,
            isEditable: isEditableClass(cls)
        }

        if (cls === 'table') {
            try {
                metadata.columnNames = await this._getTableColumnNames(varName)
            } catch {
                // best-effort
            }
        }

        if (cls === 'struct') {
            try {
                metadata.fieldNames = await this._getStructFieldNames(varName)
            } catch {
                // best-effort
            }
        }

        return metadata
    }

    private _parseSizeArray (sizeRaw: MatlabData): number[] {
        if (sizeRaw instanceof Array) {
            return sizeRaw.map((v: MatlabData) => Number(mdaUnwrap(v) ?? v))
        }
        if (sizeRaw?.mwdata !== undefined) {
            const data = sizeRaw.mwdata
            if (data instanceof Array) return data.map(Number)
            return [Number(data)]
        }
        if (sizeRaw !== undefined && sizeRaw !== null) {
            return [Number(sizeRaw)]
        }
        return [0, 0]
    }

    private async _getTableColumnNames (varName: string): Promise<string[]> {
        const res = await this._feval<MatlabData>(
            'eval',
            1,
            [`${varName}.Properties.VariableNames`],
            'getTableColumnNames'
        )
        const raw = res[0]
        return this._unwrapStringArray(raw)
    }

    private async _getStructFieldNames (varName: string): Promise<string[]> {
        const res = await this._feval<MatlabData>(
            'fieldnames',
            1,
            [`${varName}`, false],
            'getStructFieldNames'
        )
        const raw = res[0]
        return this._unwrapStringArray(raw)
    }

    private _unwrapStringArray (raw: MatlabData): string[] {
        if (raw instanceof Array) {
            return raw.map((v: MatlabData) => String(mdaUnwrap(v) ?? v))
        }
        const n = mdaLength(raw)
        const result: string[] = []
        for (let i = 0; i < n; i++) {
            result.push(String(mdaUnwrap(raw, undefined, i) ?? ''))
        }
        return result
    }

    // -----------------------------------------------------------------------
    // getPage
    // -----------------------------------------------------------------------

    /**
     * Fetch a rectangular page of cell data for the given variable.
     * Tries the official internal service first; falls back to a manual
     * MATLAB expression evaluation.
     */
    async getPage (
        varName: string,
        startRow: number,
        startCol: number,
        rowCount: number,
        colCount: number
    ): Promise<DataPage> {
        // Use the eval-based fallback directly — internal service functions may
        // not exist in all MATLAB builds and cause audible error beeps when missing.
        return await this._getPageViaFallback(varName, startRow, startCol, rowCount, colCount)
    }

    private async _getPageViaService (
        varName: string,
        startRow: number,
        startCol: number,
        rowCount: number,
        colCount: number
    ): Promise<DataPage> {
        // Convert 0-based grid indices to 1-based MATLAB indices
        const matlabStartRow = startRow + 1
        const matlabStartCol = startCol + 1
        const res = await this._feval<MatlabData>(
            'matlab.internal.datatoolsservices.getVariableEditorPage',
            1,
            ['base', varName, matlabStartRow, matlabStartCol, rowCount, colCount],
            'getPage/service'
        )
        const raw = res[0]
        return this._parseServicePage(raw, startRow, startCol, rowCount, colCount)
    }

    private _parseServicePage (
        raw: MatlabData,
        startRow: number,
        startCol: number,
        rowCount: number,
        colCount: number
    ): DataPage {
        const rows: CellValue[][] = []
        // The service may return data in different shapes; handle gracefully
        for (let r = 0; r < rowCount; r++) {
            const row: CellValue[] = []
            for (let c = 0; c < colCount; c++) {
                const linearIdx = r * colCount + c
                const cell = mdaUnwrap(raw, undefined, linearIdx)
                if (cell === null || cell === undefined) {
                    row.push({ kind: 'empty' })
                } else {
                    const val = mdaUnwrap(cell, 'value') ?? mdaUnwrap(cell, 'display') ?? cell
                    const kind = String(mdaUnwrap(cell, 'kind') ?? '')
                    row.push(this._parseServiceCellValue(val, kind))
                }
            }
            rows.push(row)
        }
        return { startRow, startCol, rows }
    }

    private _parseServiceCellValue (val: MatlabData, kind: string): CellValue {
        switch (kind) {
            case 'number': return { kind: 'number', display: String(val ?? '') }
            case 'text': return { kind: 'text', value: String(val ?? '') }
            case 'logical': return { kind: 'logical', value: Boolean(val) }
            case 'complex': return { kind: 'complex', display: String(val ?? '') }
            case 'nested': return { kind: 'nested', summary: String(val ?? ''), cls: '' }
            case 'empty': return { kind: 'empty' }
            default:
                if (val === null || val === undefined) return { kind: 'empty' }
                return { kind: 'number', display: String(val) }
        }
    }

    private async _getPageViaFallback (
        varName: string,
        startRow: number,
        startCol: number,
        rowCount: number,
        colCount: number
    ): Promise<DataPage> {
        // Convert 0-based grid indices to 1-based MATLAB indices
        const matlabStartRow = startRow + 1
        const matlabStartCol = startCol + 1
        const endRow = matlabStartRow + rowCount - 1
        const endCol = matlabStartCol + colCount - 1
        // Clamp with min() so we never exceed actual variable bounds — no MATLAB error
        const rowRange = `${matlabStartRow}:min(${endRow},size(${varName},1))`
        const colRange = `${matlabStartCol}:min(${endCol},size(${varName},2))`

        // Use a temp variable so feval can return the value.
        // Wrap in MATLAB try-catch so errors never surface to the user (no beep).
        const tmpVar = `vedit_page_${Date.now()}`
        const safeAssign = [
            `try,`,
            `  ${tmpVar}=${varName}(${rowRange},${colRange});`,
            `catch,`,
            `  ${tmpVar}=[];`,
            `end`
        ].join(' ')

        try {
            await this._eval(safeAssign, 'getPage/assign')

            const pageRes = await this._feval<MatlabData>('evalin', 1, ['base', tmpVar], 'getPage/fetch')
            const rawPage = pageRes[0]

            const rows = this._buildRowsFromRawPage(rawPage, rowCount, colCount)
            return { startRow, startCol, rows }
        } finally {
            this._mvm.eval(`clear ${tmpVar}`, false).then(undefined, () => undefined)
        }
    }

    /**
     * Parse an MDA object into a flat scalar array plus actual dimensions.
     *
     * The MATLAB language server sends matrices in one of two shapes:
     *
     *   (A) Nested rows — mwdata is an Array of row-Arrays:
     *       { mwdata: [[r0c0,r0c1,...], [r1c0,r1c1,...], ...], mwsize: [1, nRows] }
     *       → data is effectively row-major once fully flattened.
     *
     *   (B) Flat column-major — mwdata is a plain Array of scalars:
     *       { mwdata: [col0row0, col0row1, ...col1row0, col1row1,...], mwsize: [nRows, nCols] }
     *       → MATLAB's standard column-major storage.
     *
     * We detect which case we have and always return a row-major flat array
     * plus the true [nRows, nCols] so the caller can index with r*nCols+c.
     */
    private _parseMDA (raw: MatlabData): { flat: MatlabData[]; nRows: number; nCols: number } {
        if (raw === null || raw === undefined) {
            return { flat: [], nRows: 0, nCols: 0 }
        }

        // Unwrap one level of MDA if present
        const inner: MatlabData = raw?.mwdata !== undefined ? raw.mwdata : raw
        const mwsize: MatlabData = raw?.mwsize

        // Case A: inner is an array-of-arrays (row-per-element)
        if (inner instanceof Array && inner.length > 0 && inner[0] instanceof Array) {
            const nRows = inner.length
            const nCols = (inner[0] as MatlabData[]).length
            const flat: MatlabData[] = []
            for (const rowArr of inner as MatlabData[][]) {
                for (const val of rowArr) {
                    flat.push(val)
                }
            }
            return { flat, nRows, nCols }
        }

        // Case B: inner is a flat scalar array
        if (inner instanceof Array) {
            // Derive dimensions from mwsize if available; otherwise treat as a row vector
            let nRows = 1
            let nCols = inner.length
            if (mwsize instanceof Array && mwsize.length >= 2) {
                nRows = Number(mwsize[0])
                nCols = Number(mwsize[1])
            } else if (mwsize instanceof Array && mwsize.length === 1) {
                nRows = Number(mwsize[0])
                nCols = 1
            }
            // Convert column-major (MATLAB) to row-major for uniform indexing
            const flat: MatlabData[] = new Array(nRows * nCols)
            for (let c = 0; c < nCols; c++) {
                for (let r = 0; r < nRows; r++) {
                    flat[r * nCols + c] = inner[r + c * nRows] // col-major → row-major
                }
            }
            return { flat, nRows, nCols }
        }

        // Scalar
        return { flat: [inner], nRows: 1, nCols: 1 }
    }

    private _buildRowsFromRawPage (
        raw: MatlabData,
        requestedRows: number,
        requestedCols: number
    ): CellValue[][] {
        const { flat, nRows, nCols } = this._parseMDA(raw)
        const cls = this._clsFromMDA(raw)

        const rows: CellValue[][] = []
        for (let r = 0; r < requestedRows; r++) {
            const row: CellValue[] = []
            for (let c = 0; c < requestedCols; c++) {
                if (r >= nRows || c >= nCols) {
                    row.push({ kind: 'empty' })
                } else {
                    // flat is row-major: index = r * nCols + c
                    row.push(toCellValue(flat[r * nCols + c] ?? null, cls))
                }
            }
            rows.push(row)
        }
        return rows
    }

    private _clsFromMDA (raw: MatlabData): string {
        if (raw?.mwtype !== undefined) return String(raw.mwtype)
        if (typeof raw === 'number') return 'double'
        if (typeof raw === 'boolean') return 'logical'
        if (typeof raw === 'string') return 'char'
        return 'double'
    }

    // -----------------------------------------------------------------------
    // writeCell
    // -----------------------------------------------------------------------

    /**
     * Write a scalar value (expressed as a MATLAB expression string) into a
     * single cell of the variable.  Uses 1-based row/col indices.
     */
    async writeCell (
        varName: string,
        row: number,
        col: number,
        expression: string
    ): Promise<void> {
        try {
            // We need the class to build the right assignment syntax.
            let cls = 'double'
            let fieldNames: string[] | undefined
            try {
                const md = await this.getMetadata(varName)
                cls = md.cls
                fieldNames = md.fieldNames
            } catch {
                // proceed with defaults
            }

            // Convert 0-based grid indices to 1-based MATLAB indices
            const matlabRow = row + 1
            const matlabCol = col + 1
            const assignmentStr = this._buildAssignment(varName, matlabRow, matlabCol, expression, cls, fieldNames)
            await this._eval(assignmentStr, `writeCell(${varName},${matlabRow},${matlabCol})`)
        } catch (err) {
            throw new Error(`VariableDataService.writeCell(${varName}, ${row}, ${col}): ${String(err)}`)
        }
    }

    private _buildAssignment (
        varName: string,
        row: number,
        col: number,
        expression: string,
        cls: string,
        fieldNames?: string[]
    ): string {
        if (cls === 'char') {
            // 1-D char array — replace the whole row
            return `${varName}(${row},:) = ${expression};`
        }
        if (cls === 'cell') {
            return `${varName}{${row},${col}} = ${expression};`
        }
        if (cls === 'struct') {
            const fieldName = (fieldNames !== undefined && fieldNames.length >= col)
                ? fieldNames[col - 1]
                : `field${col}`
            return `${varName}.${fieldName}(${row}) = ${expression};`
        }
        if (cls === 'table') {
            return `${varName}{${row},${col}} = ${expression};`
        }
        // numeric, logical, string, and everything else
        return `${varName}(${row},${col}) = ${expression};`
    }

    // -----------------------------------------------------------------------
    // writeRange
    // -----------------------------------------------------------------------

    /**
     * Write a 2-D block of values (each a MATLAB expression string) into the
     * variable.  The top-left corner is (startRow, startCol), 1-indexed.
     */
    async writeRange (
        varName: string,
        startRow: number,
        startCol: number,
        values: string[][]
    ): Promise<void> {
        try {
            let cls = 'double'
            let fieldNames: string[] | undefined
            try {
                const md = await this.getMetadata(varName)
                cls = md.cls
                fieldNames = md.fieldNames
            } catch {
                // proceed with defaults
            }

            // Convert 0-based grid indices to 1-based MATLAB indices
            const matlabStartRow = startRow + 1
            const matlabStartCol = startCol + 1
            for (let r = 0; r < values.length; r++) {
                for (let c = 0; c < values[r].length; c++) {
                    const expression = values[r][c]
                    if (expression !== undefined && expression !== '') {
                        const assignmentStr = this._buildAssignment(
                            varName,
                            matlabStartRow + r,
                            matlabStartCol + c,
                            expression,
                            cls,
                            fieldNames
                        )
                        await this._eval(assignmentStr, `writeRange(${varName})`)
                    }
                }
            }
        } catch (err) {
            throw new Error(`VariableDataService.writeRange(${varName}, ${startRow}, ${startCol}): ${String(err)}`)
        }
    }

    // -----------------------------------------------------------------------
    // Structural operations
    // -----------------------------------------------------------------------

    /**
     * Delete a row (1-indexed) from the variable.
     */
    async deleteRow (varName: string, rowIndex: number): Promise<void> {
        try {
            await this._eval(`${varName}(${rowIndex},:) = [];`, `deleteRow(${varName},${rowIndex})`)
        } catch (err) {
            throw new Error(`VariableDataService.deleteRow(${varName}, ${rowIndex}): ${String(err)}`)
        }
    }

    /**
     * Delete a column (1-indexed) from the variable.
     */
    async deleteCol (varName: string, colIndex: number): Promise<void> {
        try {
            await this._eval(`${varName}(:,${colIndex}) = [];`, `deleteCol(${varName},${colIndex})`)
        } catch (err) {
            throw new Error(`VariableDataService.deleteCol(${varName}, ${colIndex}): ${String(err)}`)
        }
    }

    /**
     * Insert a blank row after the given 1-indexed row position.
     * Pass 0 to prepend a row before the first row.
     */
    async insertRow (varName: string, afterRow: number): Promise<void> {
        try {
            // Build a splice expression that inserts a row of zeros.
            // For tables/cells we use a different blank-row representation.
            let cls = 'double'
            try {
                const md = await this.getMetadata(varName)
                cls = md.cls
            } catch {
                // proceed with defaults
            }

            const blankRow = this._blankRowExpr(varName, cls)
            const expr = this._buildInsertRowExpr(varName, afterRow, blankRow)
            await this._eval(`${varName} = ${expr};`, `insertRow(${varName},after=${afterRow})`)
        } catch (err) {
            throw new Error(`VariableDataService.insertRow(${varName}, ${afterRow}): ${String(err)}`)
        }
    }

    private _blankRowExpr (varName: string, cls: string): string {
        switch (cls) {
            case 'cell':
                return `cell(1, size(${varName}, 2))`
            case 'char':
                return `repmat(' ', 1, size(${varName}, 2))`
            case 'logical':
                return `false(1, size(${varName}, 2))`
            case 'string':
                return `repmat("", 1, size(${varName}, 2))`
            default:
                // numeric types and anything else
                return `zeros(1, size(${varName}, 2), '${cls}')`
        }
    }

    private _buildInsertRowExpr (varName: string, afterRow: number, blankRow: string): string {
        if (afterRow <= 0) {
            // Prepend before the first row
            return `[${blankRow}; ${varName}]`
        }
        return `[${varName}(1:${afterRow},:); ${blankRow}; ${varName}(${afterRow + 1}:end,:)]`
    }

    /**
     * Insert a blank column after the given 1-indexed column position.
     * Pass 0 to prepend a column before the first column.
     */
    async insertCol (varName: string, afterCol: number): Promise<void> {
        try {
            let cls = 'double'
            try {
                const md = await this.getMetadata(varName)
                cls = md.cls
            } catch {
                // proceed with defaults
            }

            const blankCol = this._blankColExpr(varName, cls)
            const expr = this._buildInsertColExpr(varName, afterCol, blankCol)
            await this._eval(`${varName} = ${expr};`, `insertCol(${varName},after=${afterCol})`)
        } catch (err) {
            throw new Error(`VariableDataService.insertCol(${varName}, ${afterCol}): ${String(err)}`)
        }
    }

    private _blankColExpr (varName: string, cls: string): string {
        switch (cls) {
            case 'cell':
                return `cell(size(${varName}, 1), 1)`
            case 'char':
                return `repmat(' ', size(${varName}, 1), 1)`
            case 'logical':
                return `false(size(${varName}, 1), 1)`
            case 'string':
                return `repmat("", size(${varName}, 1), 1)`
            default:
                return `zeros(size(${varName}, 1), 1, '${cls}')`
        }
    }

    private _buildInsertColExpr (varName: string, afterCol: number, blankCol: string): string {
        if (afterCol <= 0) {
            return `[${blankCol}, ${varName}]`
        }
        return `[${varName}(:,1:${afterCol}), ${blankCol}, ${varName}(:,${afterCol + 1}:end)]`
    }

    // -----------------------------------------------------------------------
    // getCellContent (drill-down)
    // -----------------------------------------------------------------------

    /**
     * For cell arrays: retrieve the sub-element at {row, col} as a full
     * VariablePayload (metadata + first page) suitable for drill-down.
     * For structs: retrieve the value of the (col-th) field at row.
     */
    async getCellContent (varName: string, row: number, col: number): Promise<VariablePayload> {
        try {
            let cls = 'double'
            let fieldNames: string[] | undefined
            try {
                const md = await this.getMetadata(varName)
                cls = md.cls
                fieldNames = md.fieldNames
            } catch {
                // proceed with defaults
            }

            // Build an expression for the nested element
            let elementExpr: string
            if (cls === 'struct') {
                const fieldName = (fieldNames !== undefined && fieldNames.length >= col)
                    ? fieldNames[col - 1]
                    : `field${col}`
                elementExpr = `${varName}(${row}).${fieldName}`
            } else if (cls === 'cell') {
                elementExpr = `${varName}{${row},${col}}`
            } else {
                // Treat as array indexing
                elementExpr = `${varName}(${row},${col})`
            }

            // Determine the class of the nested element
            const clsRes = await this._feval<MatlabData>(
                'class',
                1,
                [elementExpr],
                `getCellContent/class(${varName},${row},${col})`
            )
            const nestedCls = String(mdaUnwrap(clsRes[0]) ?? 'double')

            // Determine the size of the nested element
            const sizeRes = await this._feval<MatlabData>(
                'size',
                1,
                [elementExpr],
                `getCellContent/size(${varName},${row},${col})`
            )
            const nestedSize = this._parseSizeArray(sizeRes[0])

            const nestedMetadata: VariableMetadata = {
                name: elementExpr,
                cls: nestedCls,
                size: nestedSize,
                isEditable: isEditableClass(nestedCls)
            }

            if (nestedCls === 'table') {
                try {
                    nestedMetadata.columnNames = await this._getTableColumnNames(elementExpr)
                } catch {
                    // best-effort
                }
            }
            if (nestedCls === 'struct') {
                try {
                    nestedMetadata.fieldNames = await this._getStructFieldNames(elementExpr)
                } catch {
                    // best-effort
                }
            }

            // Fetch the first page of the nested element using a temporary variable
            const tmpVar = `vedit_drill_${Date.now()}`
            let firstPage: DataPage
            try {
                await this._eval(`${tmpVar} = ${elementExpr};`, `getCellContent/assign(${varName})`)
                firstPage = await this.getPage(
                    tmpVar,
                    0, 0,
                    Math.min(PAGE_ROWS, nestedSize[0] ?? 1),
                    Math.min(PAGE_COLS, nestedSize[1] ?? 1)
                )
            } finally {
                this._mvm.eval(`clear ${tmpVar}`, false).then(undefined, () => undefined)
            }

            return { metadata: nestedMetadata, firstPage }
        } catch (err) {
            throw new Error(`VariableDataService.getCellContent(${varName}, ${row}, ${col}): ${String(err)}`)
        }
    }
}
