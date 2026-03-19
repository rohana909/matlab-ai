// Copyright 2025 The MathWorks, Inc.

import * as vscode from 'vscode'
import { MVM, MatlabMVMConnectionState } from '../commandwindow/MVM'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MatlabData = any

// MDA (MATLAB Data Array) helpers - mirrors server/src/debug/MatlabDebugAdaptor.ts
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

interface WorkspaceEntry {
    name: string
    cls: string
    size: string
    value: string
}

export class WorkspaceVariable extends vscode.TreeItem {
    constructor (public readonly entry: WorkspaceEntry) {
        super(entry.name, vscode.TreeItemCollapsibleState.None)
        this.description = `${entry.size}  ${entry.cls}`
        this.tooltip = new vscode.MarkdownString(
            `**${entry.name}**\n\n` +
            `- Class: \`${entry.cls}\`\n` +
            `- Size: \`${entry.size}\`\n` +
            `- Value: ${entry.value}`
        )
        this.iconPath = new vscode.ThemeIcon(
            this._getIconForClass(entry.cls),
            new vscode.ThemeColor('symbolIcon.variableForeground')
        )
        this.contextValue = 'workspaceVariable'
        this.command = {
            command: 'matlab.openVariableEditor',
            title: 'Open in Variable Editor',
            arguments: [this]
        }
    }

    private _getIconForClass (cls: string): string {
        switch (cls) {
            case 'double': case 'single':
            case 'int8': case 'int16': case 'int32': case 'int64':
            case 'uint8': case 'uint16': case 'uint32': case 'uint64':
                return 'symbol-number'
            case 'char': case 'string':
                return 'symbol-string'
            case 'logical':
                return 'symbol-boolean'
            case 'cell':
                return 'symbol-array'
            case 'struct':
                return 'symbol-struct'
            case 'function_handle':
                return 'symbol-function'
            default:
                return 'symbol-variable'
        }
    }
}

export class WorkspaceBrowserProvider implements vscode.TreeDataProvider<WorkspaceVariable> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>()
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event

    private _variables: WorkspaceEntry[] = []

    constructor (private readonly _mvm: MVM) {
        _mvm.on(MVM.Events.promptChange, (_state: string, isIdle: boolean) => {
            if (isIdle) {
                void this.refresh()
            }
        })

        _mvm.on(MVM.Events.stateChanged, (_oldState: MatlabMVMConnectionState, newState: MatlabMVMConnectionState) => {
            if (newState === MatlabMVMConnectionState.DISCONNECTED) {
                this._variables = []
                this._onDidChangeTreeData.fire()
            } else {
                void this.refresh()
            }
        })
    }

    getTreeItem (element: WorkspaceVariable): vscode.TreeItem {
        return element
    }

    getChildren (): WorkspaceVariable[] {
        return this._variables.map(v => new WorkspaceVariable(v))
    }

    async refresh (): Promise<void> {
        try {
            const result = await this._mvm.feval<MatlabData>(
                'matlab.internal.datatoolsservices.getWorkspaceDisplay', 1, ['base'], false
            )

            if (result == null || !('result' in result)) {
                this._variables = []
                this._onDidChangeTreeData.fire()
                return
            }

            const raw = result.result[0]
            const n = mdaLength(raw)
            const unwrap = (struct: MatlabData, field: string, index: number): MatlabData =>
                mdaUnwrap(mdaUnwrap(struct, field, index))

            const entries: WorkspaceEntry[] = []
            for (let i = 0; i < n; i++) {
                const name = String(unwrap(raw, 'Name', i) ?? '')
                const cls = String(unwrap(raw, 'Class', i) ?? '')
                const size = String(unwrap(raw, 'Size', i) ?? '')
                const value = String(unwrap(raw, 'Value', i) ?? '')
                if (name !== '') {
                    entries.push({ name, cls, size, value })
                }
            }
            this._variables = entries
        } catch {
            this._variables = []
        }
        this._onDidChangeTreeData.fire()
    }
}
