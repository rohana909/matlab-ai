// Copyright 2025 The MathWorks, Inc.

export type ExtensionToWebviewMessage =
    | { type: 'galleryData'; apps: MatlabApp[]; toolboxes: ToolboxInfo[] }
    | { type: 'disconnected' }
    | { type: 'loading' }

export type WebviewToExtensionMessage =
    | { type: 'ready' }
    | { type: 'launch'; stem: string; id?: string; isCustom: boolean }
    | { type: 'refresh' }

export interface MatlabApp {
    name: string           // display name (title-cased stem)
    stem: string           // camelCase function name for launch
    id?: string            // custom app ID (from apputil)
    toolboxFolder: string  // directory name used for grouping
    isCustom: boolean
}

export interface ToolboxInfo {
    folder: string       // e.g. 'signal'
    displayName: string  // e.g. 'Signal Processing Toolbox'
}
