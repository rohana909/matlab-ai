// Copyright 2025 The MathWorks, Inc.

import { MatlabApp, ToolboxInfo } from '../protocol'

type LaunchCallback = (app: MatlabApp) => void

export class GalleryComponent {
    private readonly _root: HTMLElement
    private _apps: MatlabApp[] = []
    private _toolboxes: ToolboxInfo[] = []
    private _onLaunch: LaunchCallback
    private _searchQuery = ''
    private _debounceTimer: ReturnType<typeof setTimeout> | null = null

    constructor (root: HTMLElement, onLaunch: LaunchCallback) {
        this._root = root
        this._onLaunch = onLaunch
        this._injectStyles()
        this._renderLoading()
    }

    showLoading (): void {
        this._renderLoading()
    }

    showDisconnected (): void {
        this._root.innerHTML = `
            <div class="state-message">
                <p>Connect to MATLAB to browse apps.</p>
            </div>`
    }

    showGallery (apps: MatlabApp[], toolboxes: ToolboxInfo[]): void {
        this._apps = apps
        this._toolboxes = toolboxes
        this._render()
    }

    private _render (): void {
        const filtered = this._filterApps()

        if (this._apps.length === 0) {
            this._root.innerHTML = `
                <div class="state-message">
                    <p>No apps found.</p>
                </div>`
            return
        }

        const searchHtml = `
            <div class="search-bar">
                <input id="gallery-search" type="text" placeholder="Filter apps..." value="${this._escapeHtml(this._searchQuery)}" />
            </div>`

        let groupsHtml = ''
        if (filtered.length === 0) {
            groupsHtml = '<div class="state-message"><p>No apps match your filter.</p></div>'
        } else {
            const grouped = this._groupByToolbox(filtered)
            for (const toolbox of this._toolboxes) {
                const groupApps = grouped.get(toolbox.folder)
                if (groupApps == null || groupApps.length === 0) continue
                groupsHtml += this._renderGroup(toolbox, groupApps)
            }
            // Custom apps not in toolboxes list
            const customApps = grouped.get('custom')
            if (customApps != null && customApps.length > 0) {
                const customTbx: ToolboxInfo = { folder: 'custom', displayName: 'My Apps' }
                if (!this._toolboxes.find(t => t.folder === 'custom')) {
                    groupsHtml += this._renderGroup(customTbx, customApps)
                }
            }
        }

        this._root.innerHTML = searchHtml + `<div class="gallery">${groupsHtml}</div>`

        const input = this._root.querySelector<HTMLInputElement>('#gallery-search')
        if (input != null) {
            input.addEventListener('input', () => {
                if (this._debounceTimer != null) clearTimeout(this._debounceTimer)
                this._debounceTimer = setTimeout(() => {
                    this._searchQuery = input.value
                    this._render()
                }, 300)
            })
            // Restore focus to search box after re-render
            if (document.activeElement?.id === 'gallery-search') {
                input.focus()
                input.setSelectionRange(input.value.length, input.value.length)
            }
        }

        this._root.querySelectorAll<HTMLElement>('.app-card').forEach(card => {
            card.addEventListener('click', () => {
                const stem = card.dataset.stem ?? ''
                const id = card.dataset.id
                const isCustom = card.dataset.isCustom === 'true'
                const app = this._apps.find(a => a.stem === stem && a.isCustom === isCustom)
                if (app != null) {
                    this._onLaunch(app)
                }
            })
            card.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    card.click()
                }
            })
        })
    }

    private _renderGroup (toolbox: ToolboxInfo, apps: MatlabApp[]): string {
        const cardsHtml = apps
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(app => this._renderCard(app))
            .join('')
        return `
            <details open>
                <summary class="group-header">${this._escapeHtml(toolbox.displayName)}<span class="app-count">${apps.length}</span></summary>
                <div class="card-grid">${cardsHtml}</div>
            </details>`
    }

    private _renderCard (app: MatlabApp): string {
        const idAttr = app.id != null ? ` data-id="${this._escapeHtml(app.id)}"` : ''
        return `<div class="app-card" tabindex="0" role="button"
            data-stem="${this._escapeHtml(app.stem)}"
            data-is-custom="${app.isCustom}"${idAttr}
            title="${this._escapeHtml(app.name)}">
            <div class="app-icon">${this._escapeHtml(app.name.charAt(0).toUpperCase())}</div>
            <div class="app-name">${this._escapeHtml(app.name)}</div>
        </div>`
    }

    private _renderLoading (): void {
        this._root.innerHTML = `
            <div class="state-message">
                <div class="spinner"></div>
                <p>Loading apps...</p>
            </div>`
    }

    private _filterApps (): MatlabApp[] {
        const q = this._searchQuery.toLowerCase().trim()
        if (q === '') return this._apps
        return this._apps.filter(a => a.name.toLowerCase().includes(q))
    }

    private _groupByToolbox (apps: MatlabApp[]): Map<string, MatlabApp[]> {
        const map = new Map<string, MatlabApp[]>()
        for (const app of apps) {
            const key = app.toolboxFolder
            if (!map.has(key)) map.set(key, [])
            map.get(key)!.push(app)
        }
        return map
    }

    private _escapeHtml (str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
    }

    private _injectStyles (): void {
        const style = document.createElement('style')
        style.textContent = `
            * { box-sizing: border-box; }

            .state-message {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 32px 16px;
                color: var(--vscode-descriptionForeground);
                text-align: center;
            }

            .spinner {
                width: 24px;
                height: 24px;
                border: 3px solid var(--vscode-foreground);
                border-top-color: transparent;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                margin-bottom: 8px;
            }
            @keyframes spin { to { transform: rotate(360deg); } }

            .search-bar {
                padding: 6px 8px;
                position: sticky;
                top: 0;
                background: var(--vscode-sideBar-background);
                z-index: 10;
                border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
            }
            .search-bar input {
                width: 100%;
                padding: 4px 8px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 2px;
                font-size: var(--vscode-font-size);
                outline: none;
            }
            .search-bar input:focus {
                border-color: var(--vscode-focusBorder);
            }

            .gallery { padding: 0 0 8px; }

            details { border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border); }

            .group-header {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 8px;
                cursor: pointer;
                list-style: none;
                font-weight: 600;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                color: var(--vscode-sideBarSectionHeader-foreground);
                background: var(--vscode-sideBarSectionHeader-background);
                user-select: none;
            }
            .group-header::-webkit-details-marker { display: none; }
            .group-header::before {
                content: '▸';
                display: inline-block;
                transition: transform 0.15s;
                font-size: 10px;
                color: var(--vscode-foreground);
            }
            details[open] > .group-header::before {
                transform: rotate(90deg);
            }

            .app-count {
                margin-left: auto;
                font-size: 10px;
                color: var(--vscode-descriptionForeground);
                font-weight: normal;
            }

            .card-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
                gap: 4px;
                padding: 6px 8px;
            }

            .app-card {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 8px 4px 6px;
                border-radius: 4px;
                cursor: pointer;
                text-align: center;
                border: 1px solid transparent;
                transition: background 0.1s;
                outline: none;
            }
            .app-card:hover {
                background: var(--vscode-list-hoverBackground);
                border-color: var(--vscode-list-hoverBackground);
            }
            .app-card:focus {
                border-color: var(--vscode-focusBorder);
                background: var(--vscode-list-hoverBackground);
            }
            .app-card:active {
                background: var(--vscode-list-activeSelectionBackground);
            }

            .app-icon {
                width: 36px;
                height: 36px;
                border-radius: 8px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 4px;
                flex-shrink: 0;
            }

            .app-name {
                font-size: 11px;
                line-height: 1.3;
                color: var(--vscode-foreground);
                word-break: break-word;
                max-width: 100%;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            }
        `
        document.head.appendChild(style)
    }
}
