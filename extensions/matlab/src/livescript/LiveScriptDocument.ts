// Copyright 2026 The MathWorks, Inc.

export interface LiveScriptSection {
    kind: 'code' | 'text' | 'break'
    title?: string
    content: string
    startLine?: number  // 1-based line number in the source file (code sections only)
}

export interface LiveScriptOutput {
    sectionIndex: number
    html: string
}

export interface LiveScriptDocument {
    sections: LiveScriptSection[]
    outputs: LiveScriptOutput[]
    mediaFiles: Record<string, string>
}

/**
 * Parses a .mlx file (ZIP containing OOXML) into a LiveScriptDocument.
 */
export async function parseMlx (bytes: Uint8Array): Promise<LiveScriptDocument> {
    // Dynamic import to keep the module loadable without jszip installed at type-check time
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const JSZip = require('jszip') as typeof import('jszip')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const xml2js = require('xml2js') as typeof import('xml2js')

    const zip = await JSZip.loadAsync(bytes)

    const mediaFiles: Record<string, string> = {}
    for (const [name, file] of Object.entries(zip.files)) {
        if (name.startsWith('matlab/') && !name.endsWith('.xml') && !(zip.files[name] as any).dir) {
            const mediaBytes = await (file as any).async('uint8array') as Uint8Array
            const b64 = _uint8ArrayToBase64(mediaBytes)
            const mime = _guessMime(name)
            mediaFiles[name] = `data:${mime};base64,${b64}`
        }
    }

    const parseXml = async (xmlText: string): Promise<any> => {
        return await xml2js.parseStringPromise(xmlText, {
            explicitArray: true,
            explicitCharkey: true,
            attrkey: '$',
            charkey: '_'
        })
    }

    const sections: LiveScriptSection[] = []
    const outputs: LiveScriptOutput[] = []

    const documentFile = zip.file('matlab/document.xml')
    if (documentFile == null) {
        return { sections, outputs, mediaFiles }
    }

    const documentXml = await (documentFile as any).async('string') as string
    const documentObj = await parseXml(documentXml)

    const body = documentObj?.['w:wordDocument']?.['w:body']?.[0]
    const paragraphs: any[] = body?.['w:p'] ?? []

    let currentSection: LiveScriptSection | null = null

    for (const para of paragraphs) {
        const pPr = para['w:pPr']?.[0]
        const pStyle = pPr?.['w:pStyle']?.[0]?.['$']?.['w:val'] as string | undefined
        const isCode = (pStyle == null) || pStyle === 'code' || pStyle.toLowerCase().includes('code')

        const runs: any[] = para['w:r'] ?? []
        let paraText = ''
        for (const run of runs) {
            const texts: any[] = run['w:t'] ?? []
            for (const t of texts) {
                paraText += typeof t === 'string' ? t : (t._ ?? '')
            }
        }

        if (isCode) {
            if (currentSection == null || currentSection.kind !== 'code') {
                currentSection = { kind: 'code', content: '' }
                sections.push(currentSection)
            }
            currentSection.content += (currentSection.content.length > 0 ? '\n' : '') + paraText
        } else {
            if (currentSection == null || currentSection.kind !== 'text') {
                currentSection = { kind: 'text', content: '' }
                sections.push(currentSection)
            }
            currentSection.content += (currentSection.content.length > 0 ? '\n' : '') + paraText
        }
    }

    const outputFile = zip.file('matlab/output.xml')
    if (outputFile != null) {
        const outputXml = await (outputFile as any).async('string') as string
        try {
            const outputObj = await parseXml(outputXml)
            const outputSections: any[] = outputObj?.outputs?.section ?? []
            outputSections.forEach((sec: any, idx: number) => {
                const html = _outputSectionToHtml(sec, mediaFiles)
                if (html.length > 0) {
                    outputs.push({ sectionIndex: idx, html })
                }
            })
        } catch {
            // output.xml parse failure is non-fatal
        }
    }

    return { sections, outputs, mediaFiles }
}

/**
 * Parses a .m file with live script markup into a LiveScriptDocument.
 *
 * Three-pass algorithm:
 *   Pass 1 — collect appendix blocks (lines between a block header and %---)
 *   Pass 2 — parse sections and record inline output references
 *   Pass 3 — build output HTML from the collected appendix data
 */
export async function parseMText (text: string): Promise<LiveScriptDocument> {
    const sections: LiveScriptSection[] = []
    const outputs: LiveScriptOutput[] = []
    const mediaFiles: Record<string, string> = {}

    const lines = text.split('\n').map(l => l.trimEnd())

    // -----------------------------------------------------------------------
    // Pass 1 — collect appendix blocks
    // A block header is a line that matches /^%\[([^\]]+)\]\s*$/ (nothing
    // after the closing bracket) and whose NEXT line starts with /^%\s+data:/.
    // -----------------------------------------------------------------------
    const appendixBlocks: Record<string, unknown> = {}

    let i = 0
    while (i < lines.length) {
        const line = lines[i]
        const headerMatch = /^%\[([^\]]+)\]\s*$/.exec(line)
        if (headerMatch != null) {
            const blockKey = headerMatch[1]
            const nextLine = lines[i + 1] ?? ''
            if (/^%\s+data:/.test(nextLine)) {
                // Collect all lines until %---
                i++ // move to the %   data: line
                const rawBlockLines: string[] = []
                while (i < lines.length && lines[i] !== '%---') {
                    rawBlockLines.push(lines[i])
                    i++
                }
                // i is now at %--- (or end); skip it
                i++

                // Strip leading `% ` or `%` from each line
                const stripped = rawBlockLines.map(l => l.replace(/^%\s*/, ''))

                // Find the `data:` line and join with subsequent lines
                const dataLineIdx = stripped.findIndex(l => l.startsWith('data:'))
                if (dataLineIdx !== -1) {
                    // Everything from data: onward is the JSON value
                    const jsonStr = stripped.slice(dataLineIdx).join('').replace(/^data:\s*/, '')
                    try {
                        appendixBlocks[blockKey] = JSON.parse(jsonStr)
                    } catch {
                        // non-fatal; block data is unparseable
                    }
                }
                continue
            }
        }
        i++
    }

    // -----------------------------------------------------------------------
    // Pass 2 — parse sections and record inline output references
    // -----------------------------------------------------------------------

    // Track inline output refs: { blockKey, sectionIndex }
    const inlineRefs: Array<{ blockKey: string; sectionIndex: number }> = []

    let currentSection: LiveScriptSection | null = null

    // Helper to get or create a code section, recording the 1-based source line number
    const ensureCodeSection = (): LiveScriptSection => {
        if (currentSection == null || currentSection.kind !== 'code') {
            currentSection = { kind: 'code', content: '', startLine: i + 1 }
            sections.push(currentSection)
        }
        return currentSection
    }

    // Helper to get or create a text section
    const ensureTextSection = (): LiveScriptSection => {
        if (currentSection == null || currentSection.kind !== 'text') {
            currentSection = { kind: 'text', content: '' }
            sections.push(currentSection)
        }
        return currentSection
    }

    const appendLine = (sec: LiveScriptSection, content: string): void => {
        sec.content += (sec.content.length > 0 ? '\n' : '') + content
    }

    i = 0
    while (i < lines.length) {
        const line = lines[i]

        // Check for a block header
        const headerMatch = /^%\[([^\]]+)\]\s*$/.exec(line)
        if (headerMatch != null) {
            const blockKey = headerMatch[1]

            if (blockKey in appendixBlocks) {
                // Skip the entire block: header + data lines + %---
                i++
                while (i < lines.length && lines[i] !== '%---') { i++ }
                if (i < lines.length) { i++ } // skip %---
                continue
            }

            // It's an inline output reference (no appendix data)
            if (blockKey.startsWith('output:')) {
                // Record the current section index
                const sectionIndex = sections.length > 0 ? sections.length - 1 : 0
                inlineRefs.push({ blockKey, sectionIndex })
            }
            i++
            continue
        }

        // Skip appendix header line and bare %--- delimiters
        if (line.startsWith('%[appendix]') || line === '%---') {
            i++
            continue
        }

        // Section break: %% or %% Title
        if (line === '%%' || line.startsWith('%% ')) {
            const title = line.startsWith('%% ') ? line.slice(3).trim() : undefined
            // Section breaks start a new code section; startLine points to the line after %%
            currentSection = { kind: 'code', content: '', startLine: i + 2 }
            if (title != null && title.length > 0) {
                currentSection.title = title
            }
            sections.push(currentSection)
            i++
            continue
        }

        // Text line: %[text]{...opts} content  OR  %[text] content
        const textLineMatch = /^%\[text\](?:\{[^}]*\})?\s?(.*)$/.exec(line)
        if (textLineMatch != null) {
            const markdownContent = textLineMatch[1]
            const sec = ensureTextSection()
            appendLine(sec, _markdownLineToHtml(markdownContent, mediaFiles))
            i++
            continue
        }

        // Otherwise: MATLAB code line — may have inline control refs and/or a trailing output ref.
        // Step 1: replace all inline control refs with «CTRL»...«/CTRL» markers (or strip if no data).
        let processedLine = line.replace(/%\[control:(\w+):([^\]]+)\](?:\{[^}]*\})?/g, (_match, controlType: string, controlId: string) => {
            const blockKey = `control:${controlType}:${controlId}`
            const data = appendixBlocks[blockKey]
            if (data == null) {
                return ''
            }
            const html = _controlToHtml(controlType, data as Record<string, unknown>)
            return `\u00abCTRL\u00bb${html}\u00ab/CTRL\u00bb`
        })

        // Step 2: check for a trailing output ref on the (possibly control-substituted) line.
        const trailingOutputMatch = /^(.*?)\s*%\[output:([^\]]+)\]\s*$/.exec(processedLine)
        if (trailingOutputMatch != null) {
            const codePart = trailingOutputMatch[1]
            const outputId = trailingOutputMatch[2]
            const sec = ensureCodeSection()
            if (codePart.length > 0) {
                appendLine(sec, codePart)
            }
            const sectionIndex = sections.length > 0 ? sections.length - 1 : 0
            inlineRefs.push({ blockKey: `output:${outputId}`, sectionIndex })
            i++
            continue
        }

        const sec = ensureCodeSection()
        appendLine(sec, processedLine)
        i++
    }

    // -----------------------------------------------------------------------
    // Pass 3 — build outputs from inline refs and appendix data
    // -----------------------------------------------------------------------
    for (const { blockKey, sectionIndex } of inlineRefs) {
        const data = appendixBlocks[blockKey]
        if (data == null) {
            continue
        }
        const html = _appendixDataToHtml(data as Record<string, unknown>)
        if (html.length > 0) {
            outputs.push({ sectionIndex, html })
        }
    }

    // -----------------------------------------------------------------------
    // Media files — populate from text:image:* appendix blocks
    // -----------------------------------------------------------------------
    for (const [key, data] of Object.entries(appendixBlocks)) {
        if (key.startsWith('text:image:')) {
            const d = data as Record<string, unknown>
            const encoding = d.encoding as string | undefined
            const format = d.format as string | undefined
            const b64 = d.data as string | undefined
            if (encoding === 'base64' && b64 != null) {
                const mime = format === 'png' ? 'image/png' : _guessMime(`.${format ?? 'png'}`)
                mediaFiles[key] = `data:${mime};base64,${b64}`
            }
        }
    }

    // Convert empty code sections (from bare %% lines) into section-break markers
    const filteredSections = sections.map(s =>
        (s.kind === 'code' && s.content.trim() === '') ? { kind: 'break' as const, content: '' } : s
    )
    return { sections: filteredSections, outputs, mediaFiles }
}

function _controlToHtml (controlType: string, data: Record<string, unknown>): string {
    if (controlType === 'dropdown') {
        const options = (data.options as string[] | undefined) ?? []
        const value = data.value as string | undefined
        const opts = options.map(o => `<option${o === value ? ' selected' : ''}>${o}</option>`).join('')
        return `<select class="live-control-dropdown">${opts}</select>`
    }
    if (controlType === 'slider') {
        const min = (data.min as number | undefined) ?? 0
        const max = (data.max as number | undefined) ?? 100
        const val = (data.value as number | undefined) ?? 0
        const step = (data.step as number | undefined) ?? 1
        return `<input type="range" class="live-control-slider" min="${min}" max="${max}" value="${val}" step="${step}"><span class="live-control-slider-val">${val}</span>`
    }
    if (controlType === 'checkbox') {
        const checked = (data.value as boolean | undefined) ?? false
        return `<input type="checkbox" class="live-control-checkbox"${checked ? ' checked' : ''}>`
    }
    if (controlType === 'editfield') {
        const val = String(data.value ?? '')
        return `<input type="text" class="live-control-edit" value="${val}">`
    }
    return ''
}

function _appendixDataToHtml (data: Record<string, unknown>): string {
    // MATLAB R2025a format: { dataType, outputData }
    const dataType = data.dataType as string | undefined
    if (dataType === 'text') {
        const outputData = data.outputData as Record<string, unknown> | undefined
        const text = (outputData?.text as string | undefined) ?? ''
        return `<pre class="output-text">${_escapeHtml(text)}</pre>`
    }
    if (dataType === 'image') {
        const outputData = data.outputData as Record<string, unknown> | undefined
        const src = (outputData?.src as string | undefined) ?? (outputData?.data as string | undefined) ?? ''
        const format = (outputData?.format as string | undefined) ?? 'png'
        if (src.length > 0) {
            const mime = _guessMime(`.${format}`)
            return `<img src="data:${mime};base64,${src}" class="output-image">`
        }
    }
    // Legacy / fallback format: { type, value } or { type, data }
    const type = data.type as string | undefined
    if (type === 'text') {
        const value = (data.value as string | undefined) ?? ''
        return `<pre class="output-text">${_escapeHtml(value)}</pre>`
    }
    if (type === 'image') {
        const encoding = data.encoding as string | undefined
        const format = (data.format as string | undefined) ?? 'png'
        const b64 = data.data as string | undefined
        if (encoding === 'base64' && b64 != null) {
            const mime = _guessMime(`.${format}`)
            return `<img src="data:${mime};base64,${b64}" class="output-image">`
        }
    }
    return ''
}

function _markdownLineToHtml (line: string, mediaFiles: Record<string, string>): string {
    // Headings
    if (line.startsWith('### ')) return `<h3>${_inlineMarkdown(line.slice(4), mediaFiles)}</h3>`
    if (line.startsWith('## ')) return `<h2>${_inlineMarkdown(line.slice(3), mediaFiles)}</h2>`
    if (line.startsWith('# ')) return `<h1>${_inlineMarkdown(line.slice(2), mediaFiles)}</h1>`
    // Empty line → paragraph break
    if (line.trim() === '') return '<br>'
    return `<p>${_inlineMarkdown(line, mediaFiles)}</p>`
}

function _inlineMarkdown (text: string, mediaFiles: Record<string, string>): string {
    // Inline images: ![alt](text:image:id)
    text = text.replace(/!\[([^\]]*)\]\((text:image:[^)]+)\)/g, (_match, alt: string, ref: string) => {
        const src = mediaFiles[ref] ?? ''
        return `<img src="${src}" alt="${_escapeHtml(alt)}" class="inline-image">`
    })
    // Escape HTML entities (after image substitution to avoid double-escaping src)
    text = text.replace(/&(?![a-zA-Z#]\w*;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Links: [label](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Bold **text**
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic *text*
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code `code`
    text = text.replace(/`(.+?)`/g, '<code>$1</code>')
    return text
}

function _outputSectionToHtml (sec: any, mediaFiles: Record<string, string>): string {
    if (sec == null) return ''
    let html = ''
    const items: any[] = sec.item ?? []
    for (const item of items) {
        const type: string = item?.['$']?.type ?? ''
        if (type === 'text') {
            const content = item._ ?? ''
            html += `<div class="output-text">${_escapeHtml(content)}</div>`
        } else if (type === 'image') {
            const ref: string = item?.['$']?.ref ?? ''
            const src = mediaFiles[ref] ?? ''
            if (src.length > 0) {
                html += `<img src="${src}" class="output-image" alt="output">`
            }
        }
    }
    return html
}

function _guessMime (filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const map: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        webp: 'image/webp'
    }
    return map[ext] ?? 'application/octet-stream'
}

function _escapeHtml (text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function _uint8ArrayToBase64 (bytes: Uint8Array): string {
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize)
        binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
}
