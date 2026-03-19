// Copyright 2026 The MathWorks, Inc.

// ---------------------------------------------------------------------------
// Shared message protocol between the extension host and the Variable Editor
// webview. Both sides import from this file.
// ---------------------------------------------------------------------------

// Messages sent from the extension host TO the webview
export type ExtensionToWebviewMessage =
    | { type: 'init'; variable: VariableMetadata }
    | { type: 'dataPage'; requestId: string; page: DataPage }
    | { type: 'cellData'; requestId: string; data: VariablePayload }
    | { type: 'writeAck'; requestId: string; success: boolean; error?: string }
    | { type: 'structuralAck'; requestId: string; success: boolean; error?: string }
    | { type: 'refresh'; variable: VariableMetadata }
    | { type: 'mvmDisconnected' }
    | { type: 'mvmConnected' }

// Messages sent from the webview TO the extension host
export type WebviewToExtensionMessage =
    | { type: 'ready' }
    | { type: 'requestPage'; requestId: string; startRow: number; startCol: number; rowCount: number; colCount: number }
    | { type: 'requestCellDrill'; requestId: string; row: number; col: number }
    | { type: 'writeCell'; requestId: string; row: number; col: number; value: string }
    | { type: 'writeRange'; requestId: string; startRow: number; startCol: number; values: string[][] }
    | { type: 'insertRow'; requestId: string; afterRow: number }
    | { type: 'deleteRow'; requestId: string; rowIndex: number }
    | { type: 'insertCol'; requestId: string; afterCol: number }
    | { type: 'deleteCol'; requestId: string; colIndex: number }

// Metadata describing a MATLAB workspace variable
export interface VariableMetadata {
    name: string
    cls: string           // MATLAB class string e.g. 'double', 'char', 'struct'
    size: number[]        // e.g. [100, 3]
    isEditable: boolean
    columnNames?: string[] // table: variable names
    fieldNames?: string[]  // struct: field names
}

// A rectangular page of cell data returned from the extension host
export interface DataPage {
    startRow: number
    startCol: number
    rows: CellValue[][]
}

// Discriminated union of displayable cell values
export type CellValue =
    | { kind: 'number'; display: string }
    | { kind: 'text'; value: string }
    | { kind: 'logical'; value: boolean }
    | { kind: 'complex'; display: string }
    | { kind: 'nested'; summary: string; cls: string }
    | { kind: 'empty' }

// Full variable payload returned for drill-down (cell/struct contents)
export type VariablePayload = {
    metadata: VariableMetadata
    firstPage: DataPage
}

// Page fetch parameters
export const PAGE_ROWS = 50
export const PAGE_COLS = 26
export const BUFFER_ROWS = 30
export const ROW_HEIGHT_PX = 24
export const COL_WIDTH_PX = 100
export const ROW_NUM_COL_WIDTH_PX = 60
