// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'
import { MVM, MatlabMVMConnectionState } from '../commandwindow/MVM'
import { VariableDataService } from './VariableDataService'
import { VariableEditorPanel } from './VariableEditorPanel'
import { ExtensionToWebviewMessage } from './protocol'

/**
 * Manages all open VariableEditorPanels. Ensures at most one panel per variable name
 * and keeps panels in sync with MVM connection and prompt-change events.
 */
export class VariableEditorProvider implements vscode.Disposable {
    private readonly _openPanels = new Map<string, VariableEditorPanel>()

    constructor (
        private readonly _mvm: MVM,
        private readonly _dataService: VariableDataService,
        private readonly _context: vscode.ExtensionContext
    ) {
        _mvm.on(MVM.Events.promptChange, (_state: string, isIdle: boolean) => {
            if (isIdle) {
                void this._refreshAll()
            }
        })

        _mvm.on(MVM.Events.stateChanged, (_old: MatlabMVMConnectionState, newState: MatlabMVMConnectionState) => {
            const connected = newState !== MatlabMVMConnectionState.DISCONNECTED
            this._broadcastConnectionState(connected)
        })
    }

    /**
     * Opens the variable editor for the given variable name.
     * If the panel is already open, it is revealed instead of creating a new one.
     */
    async openVariable (varName: string): Promise<void> {
        const existing = this._openPanels.get(varName)
        if (existing !== undefined) {
            existing.reveal()
            return
        }

        const metadata = await this._dataService.getMetadata(varName)
        const panel = VariableEditorPanel.create(this._context, this._dataService, metadata)
        this._openPanels.set(varName, panel)
        panel.onDidDispose(() => this._openPanels.delete(varName))
    }

    private async _refreshAll (): Promise<void> {
        for (const [varName, panel] of this._openPanels) {
            try {
                const updated = await this._dataService.getMetadata(varName)
                panel.refresh(updated)
            } catch {
                void vscode.window.showInformationMessage(`Variable '${varName}' no longer exists in the workspace.`)
                panel.dispose()
                this._openPanels.delete(varName)
            }
        }
    }

    private _broadcastConnectionState (connected: boolean): void {
        const msg: ExtensionToWebviewMessage = connected
            ? { type: 'mvmConnected' }
            : { type: 'mvmDisconnected' }
        for (const panel of this._openPanels.values()) {
            panel.postMessage(msg)
        }
    }

    dispose (): void {
        for (const panel of this._openPanels.values()) {
            panel.dispose()
        }
        this._openPanels.clear()
    }
}
