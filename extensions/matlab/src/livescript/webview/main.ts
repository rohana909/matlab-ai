// Copyright 2026 The MathWorks, Inc.
// Browser-side renderer for MATLAB Live Script preview webview

import type { LiveScriptDocument, LiveScriptSection, LiveScriptOutput } from '../LiveScriptDocument'

declare const window: Window & { __LIVESCRIPT_DOC__?: LiveScriptDocument }

// Inject global styles
const style = document.createElement('style')
style.textContent = `
* { box-sizing: border-box; }
body {
    margin: 0;
    padding: 20px 32px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    line-height: 1.6;
}
.live-script-doc { max-width: 860px; }
.text-block { margin: 0 0 8px 0; }
.text-block h1 { color: #E87722; font-size: 1.8em; font-weight: 700; margin: 0 0 12px 0; line-height: 1.2; }
.text-block h2 { color: var(--vscode-editor-foreground); font-size: 1.4em; font-weight: 600; margin: 20px 0 8px 0; }
.text-block h3 { color: var(--vscode-editor-foreground); font-size: 1.1em; font-weight: 600; margin: 16px 0 6px 0; }
.text-block p { margin: 0 0 8px 0; color: var(--vscode-editor-foreground); }
.text-block strong { font-weight: 600; }
.text-block em { font-style: italic; }
.text-block code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; font-family: 'Courier New', Courier, monospace; font-size: 0.9em; }
.text-block a { color: #0066cc; text-decoration: none; }
.text-block a:hover { text-decoration: underline; }
.text-block br { display: block; margin: 4px 0; content: ''; }
.code-block {
    background: var(--vscode-textCodeBlock-background, #f8f8f8);
    border: 1px solid var(--vscode-widget-border, #e0e0e0);
    border-left: 4px solid var(--vscode-editorLineNumber-foreground, #c0c0c0);
    border-radius: 0 4px 4px 0;
    padding: 10px 0;
    margin: 8px 0 0 0;
    overflow-x: auto;
}
.code-table { border-collapse: collapse; width: 100%; }
.line-num {
    text-align: right;
    padding: 1px 14px 1px 10px;
    color: var(--vscode-editorLineNumber-foreground, #999);
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.85em;
    user-select: none;
    white-space: nowrap;
    vertical-align: top;
    min-width: 2.5em;
}
.line-code {
    padding: 1px 16px 1px 0;
    white-space: pre;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.9em;
    color: var(--vscode-editor-foreground);
    line-height: 1.5;
}
.output-block {
    margin: 2px 0 16px 40px;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground, #555);
    white-space: pre-wrap;
}
.output-block pre { margin: 0; font-family: inherit; font-size: inherit; color: inherit; white-space: pre-wrap; }
.output-block img { max-width: 100%; display: block; margin: 6px 0; }
.inline-image { max-width: 100%; display: block; margin: 6px 0; }
.live-control-dropdown, .live-control-edit {
    font-size: 0.85em; padding: 2px 6px;
    border: 1px solid var(--vscode-input-border, #bbb);
    background: var(--vscode-input-background, #fff);
    color: var(--vscode-input-foreground, #333);
    border-radius: 3px; vertical-align: middle;
    font-family: 'Courier New', Courier, monospace;
}
.live-control-edit { width: 80px; }
.live-control-slider { vertical-align: middle; }
.live-control-slider-val { font-size: 0.85em; margin-left: 4px; color: var(--vscode-descriptionForeground, #555); }
.live-control-checkbox { vertical-align: middle; margin: 0 2px; }
.error-msg {
    padding: 16px;
    color: var(--vscode-errorForeground);
}
.section-break {
    margin: 20px 0 16px 0;
    border: none;
    border-top: 1px solid var(--vscode-widget-border, #d0d0d0);
    opacity: 0.6;
}
`
document.head.appendChild(style)

const KEYWORDS = new Set([
    'if', 'end', 'for', 'while', 'function', 'return', 'else', 'elseif',
    'break', 'continue', 'true', 'false', 'switch', 'case', 'otherwise',
    'try', 'catch', 'do', 'until', 'global', 'persistent', 'classdef',
    'properties', 'methods', 'events', 'enumeration', 'parfor', 'spmd'
])

/**
 * Applies simple MATLAB syntax highlighting to a single line of code.
 * Returns HTML string with <span> tags for coloring.
 */
function highlightCode(line: string): string {
    const trimmed = line.trimStart()

    // Escape HTML first
    const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

    // Full-line comment: trimmed line starts with %
    if (trimmed.startsWith('%')) {
        return `<span style="color:#3a7a3a">${escaped}</span>`
    }

    // Process strings and inline comments with a stateful scan
    let result = ''
    let i = 0
    const raw = escaped

    while (i < raw.length) {
        // Check for double-quoted string
        if (raw[i] === '"') {
            const start = i
            i++ // skip opening quote
            while (i < raw.length && raw[i] !== '"') {
                if (raw[i] === '\\') { i++ } // skip escape
                i++
            }
            i++ // skip closing quote
            result += `<span style="color:#a31515">${raw.slice(start, i)}</span>`
            continue
        }

        // Check for single-quoted string (MATLAB character array)
        if (raw[i] === "'") {
            const start = i
            i++
            while (i < raw.length && raw[i] !== "'") {
                i++
            }
            i++
            result += `<span style="color:#a31515">${raw.slice(start, i)}</span>`
            continue
        }

        // Check for inline comment starting with %
        if (raw[i] === '%') {
            result += `<span style="color:#3a7a3a">${raw.slice(i)}</span>`
            break
        }

        // Accumulate a word token or non-word characters
        if (/\w/.test(raw[i])) {
            const start = i
            while (i < raw.length && /\w/.test(raw[i])) {
                i++
            }
            const word = raw.slice(start, i)
            // Check if it's a keyword (guard against HTML entity residue)
            const plainWord = word.replace(/&amp;|&lt;|&gt;/g, '_')
            if (KEYWORDS.has(plainWord)) {
                result += `<span style="color:#0000ff">${word}</span>`
            } else if (/^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$/.test(word)) {
                result += `<span style="color:#098658">${word}</span>`
            } else {
                result += word
            }
        } else {
            result += raw[i]
            i++
        }
    }

    return result
}

/**
 * Renders a single code line, handling embedded live control markers.
 * Controls are embedded as «CTRL»html«/CTRL» (guillemet U+00AB/U+00BB).
 * Text parts get syntax highlighting; control parts are inserted as raw HTML.
 */
function renderCodeLine(line: string): string {
    const OPEN = '\u00ab' + 'CTRL\u00bb'
    const CLOSE = '\u00ab' + '/CTRL\u00bb'
    if (!line.includes(OPEN)) {
        return highlightCode(line)
    }
    let result = ''
    let remaining = line
    while (remaining.includes(OPEN)) {
        const openIdx = remaining.indexOf(OPEN)
        const closeIdx = remaining.indexOf(CLOSE, openIdx)
        if (closeIdx === -1) { break }
        result += highlightCode(remaining.slice(0, openIdx))
        result += remaining.slice(openIdx + OPEN.length, closeIdx)
        remaining = remaining.slice(closeIdx + CLOSE.length)
    }
    result += highlightCode(remaining)
    return result
}

/**
 * Renders a code section's content as a table with line numbers and syntax highlighting.
 * startLine is the 1-based line number of the first line in the source file.
 */
function renderCodeLines(content: string, startLine: number): string {
    const lines = content.split('\n')
    const rows = lines.map((line, idx) => {
        const lineNum = startLine + idx
        const cellContent = renderCodeLine(line)
        return `<tr><td class="line-num">${lineNum}</td><td class="line-code">${cellContent}</td></tr>`
    })
    return `<table class="code-table">${rows.join('')}</table>`
}

const root = document.getElementById('root')

function render(doc: LiveScriptDocument): void {
    if (root == null) { return }
    root.innerHTML = ''

    if (doc.sections.length === 0) {
        root.innerHTML = '<div style="padding:16px">No content found in live script.</div>'
        return
    }

    const container = document.createElement('div')
    container.className = 'live-script-doc'

    doc.sections.forEach((section: LiveScriptSection, idx: number) => {
        if (section.kind === 'break') {
            const brk = document.createElement('div')
            brk.className = 'section-break'
            brk.innerHTML = ''
            container.appendChild(brk)
        } else if (section.kind === 'text') {
            const textDiv = document.createElement('div')
            textDiv.className = 'text-block'
            textDiv.innerHTML = section.content
            container.appendChild(textDiv)
        } else {
            // kind === 'code'
            const codeBlock = document.createElement('div')
            codeBlock.className = 'code-block'
            codeBlock.innerHTML = renderCodeLines(section.content, section.startLine ?? 1)
            container.appendChild(codeBlock)
        }

        // Outputs for this section
        const sectionOutputs = doc.outputs.filter((o: LiveScriptOutput) => o.sectionIndex === idx)
        if (sectionOutputs.length > 0) {
            const outputDiv = document.createElement('div')
            outputDiv.className = 'output-block'
            outputDiv.innerHTML = sectionOutputs.map((o: LiveScriptOutput) => o.html).join('')
            container.appendChild(outputDiv)
        }
    })

    root.appendChild(container)
}

const doc = window.__LIVESCRIPT_DOC__
if (doc != null) {
    render(doc)
} else if (root != null) {
    root.innerHTML = '<div class="error-msg">Error: no document data found.</div>'
}
