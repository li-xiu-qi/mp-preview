import { App, TFile, MarkdownView, Component } from 'obsidian';

/**
 * 基于行号的同步滚动管理器
 */
export class ScrollSyncManager extends Component {
    private app: App;
    private previewEl: HTMLElement | null = null;
    private currentFile: TFile | null = null;
    private syncEnabled: boolean = false;
    private isSyncing: boolean = false;
    private lineToElementMap: Map<number, HTMLElement> = new Map();
    private totalLines: number = 0;
    private checkInterval: number | null = null;
    private lastEditorLine: number = -1;

    constructor(app: App) {
        super();
        this.app = app;
    }

    setEnabled(enabled: boolean): void {
        this.syncEnabled = enabled;
        if (enabled) {
            this.startSync();
        } else {
            this.stopSync();
        }
    }

    isEnabled(): boolean {
        return this.syncEnabled;
    }
    
    async initialize(previewEl: HTMLElement, currentFile: TFile): Promise<void> {
        this.previewEl = previewEl;
        this.currentFile = currentFile;
        
        // 构建行号映射
        await this.buildLineMap();
        
        console.log('[ScrollSync] 初始化完成，映射了', this.lineToElementMap.size, '个元素');
    }

    /**
     * 构建行号到元素的映射
     */
    private async buildLineMap(): Promise<void> {
        if (!this.previewEl || !this.currentFile) return;

        try {
            const content = await this.app.vault.cachedRead(this.currentFile);
            const lines = content.split('\n');
            this.totalLines = lines.length;
            
            this.lineToElementMap.clear();
            
            // 获取所有块级元素
            const elements = Array.from(this.previewEl.querySelectorAll(
                '.mp-content-section > *'
            )) as HTMLElement[];

            let lineIndex = 0;
            
            for (const element of elements) {
                // 跳过 frontmatter
                if (lineIndex === 0 && lines[0]?.trim() === '---') {
                    lineIndex++;
                    while (lineIndex < lines.length && lines[lineIndex]?.trim() !== '---') {
                        lineIndex++;
                    }
                    lineIndex++;
                }
                
                // 跳过空行
                while (lineIndex < lines.length && lines[lineIndex]?.trim() === '') {
                    lineIndex++;
                }

                if (lineIndex >= lines.length) break;

                // 尝试匹配标题
                const tagName = element.tagName.toLowerCase();
                if (tagName.match(/^h[1-6]$/)) {
                    const text = element.textContent?.trim();
                    if (text) {
                        for (let i = lineIndex; i < Math.min(lineIndex + 10, lines.length); i++) {
                            if (lines[i]?.includes(text.substring(0, 30))) {
                                lineIndex = i;
                                break;
                            }
                        }
                    }
                }

                // 存储映射
                element.setAttribute('data-source-line', String(lineIndex));
                this.lineToElementMap.set(lineIndex, element);
                
                lineIndex++;
            }
        } catch (error) {
            console.error('[ScrollSync] 构建行号映射失败:', error);
        }
    }

    private startSync(): void {
        if (!this.previewEl) return;
        
        // 绑定预览滚动
        this.previewEl.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
        
        // 轮询监听编辑器行号变化
        this.startEditorPolling();
        
        console.log('[ScrollSync] 行号同步已开启');
    }

    private stopSync(): void {
        if (!this.previewEl) return;
        this.previewEl.removeEventListener('scroll', this.handlePreviewScroll);
        
        if (this.checkInterval) {
            window.clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    /**
     * 轮询监听编辑器行号
     */
    private startEditorPolling(): void {
        this.checkInterval = window.setInterval(() => {
            if (!this.syncEnabled || this.isSyncing || !this.previewEl || !this.currentFile) return;
            
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView || activeView.file?.path !== this.currentFile.path) return;
            
            const editor = activeView.editor;
            const currentLine = editor.getCursor().line;
            
            // 行号变化较大时才同步
            if (Math.abs(currentLine - this.lastEditorLine) > 2) {
                this.lastEditorLine = currentLine;
                this.syncPreviewToLine(currentLine);
            }
        }, 200) as unknown as number;
    }

    /**
     * 处理预览滚动
     */
    private handlePreviewScroll = (): void => {
        if (!this.syncEnabled || this.isSyncing || !this.previewEl) return;
        
        const visibleLine = this.findVisibleLine();
        if (visibleLine !== null) {
            this.syncEditorToLine(visibleLine);
        }
    };

    /**
     * 找到预览区最顶部的可见行号
     */
    private findVisibleLine(): number | null {
        if (!this.previewEl || this.lineToElementMap.size === 0) return null;

        const previewRect = this.previewEl.getBoundingClientRect();
        const viewportTop = previewRect.top + 20; // 一点偏移

        let closestLine: number | null = null;
        let closestDistance = Infinity;

        this.lineToElementMap.forEach((element, line) => {
            const rect = element.getBoundingClientRect();
            const distance = rect.top - viewportTop;
            
            // 元素在视口上方或刚好在视口内
            if (distance <= 0 && Math.abs(distance) < closestDistance) {
                closestDistance = Math.abs(distance);
                closestLine = line;
            }
        });

        return closestLine;
    }

    /**
     * 同步编辑器到指定行
     */
    private syncEditorToLine(lineNumber: number): void {
        if (!this.currentFile) return;
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || activeView.file?.path !== this.currentFile.path) return;

        const editor = activeView.editor;
        const currentLine = editor.getCursor().line;
        
        // 差异较大时才同步
        if (Math.abs(currentLine - lineNumber) <= 2) return;

        editor.setCursor({ line: lineNumber, ch: 0 });
        
        // 滚动到该行
        try {
            const editorContainer = activeView.containerEl.querySelector('.cm-scroller, .CodeMirror-scroll');
            if (editorContainer) {
                // 估算滚动位置（基于行号比例）
                const percentage = lineNumber / this.totalLines;
                const scrollHeight = editorContainer.scrollHeight - editorContainer.clientHeight;
                editorContainer.scrollTop = percentage * scrollHeight;
            }
        } catch (e) {
            // 忽略错误
        }
        
        this.isSyncing = true;
        setTimeout(() => {
            this.isSyncing = false;
        }, 150);
    }

    /**
     * 同步预览到指定行
     */
    private syncPreviewToLine(lineNumber: number): void {
        if (!this.previewEl) return;
        
        // 找到对应或最近的元素
        let targetElement = this.lineToElementMap.get(lineNumber);
        
        if (!targetElement) {
            // 找最近的行号
            let closestLine = 0;
            let minDiff = Infinity;
            
            this.lineToElementMap.forEach((_, line) => {
                const diff = Math.abs(line - lineNumber);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestLine = line;
                }
            });
            
            targetElement = this.lineToElementMap.get(closestLine);
        }

        if (targetElement) {
            this.isSyncing = true;
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            
            setTimeout(() => {
                this.isSyncing = false;
            }, 150);
        }
    }

    destroy(): void {
        this.stopSync();
        this.lineToElementMap.clear();
        super.unload();
    }
}
