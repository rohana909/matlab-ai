// Copyright 2025 The MathWorks, Inc.

import { ExtensionToWebviewMessage, MatlabApp, WebviewToExtensionMessage } from '../protocol'
import { GalleryComponent } from './GalleryComponent'

declare function acquireVsCodeApi (): {
    postMessage: (msg: WebviewToExtensionMessage) => void
}

const vscodeApi = acquireVsCodeApi()

function sendMessage (msg: WebviewToExtensionMessage): void {
    vscodeApi.postMessage(msg)
}

const root = document.getElementById('root')!
const gallery = new GalleryComponent(root, (app: MatlabApp) => {
    sendMessage({
        type: 'launch',
        stem: app.stem,
        id: app.id,
        isCustom: app.isCustom
    })
})

window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as ExtensionToWebviewMessage
    switch (msg.type) {
        case 'loading':
            gallery.showLoading()
            break
        case 'disconnected':
            gallery.showDisconnected()
            break
        case 'galleryData':
            gallery.showGallery(msg.apps, msg.toolboxes)
            break
    }
})

sendMessage({ type: 'ready' })
