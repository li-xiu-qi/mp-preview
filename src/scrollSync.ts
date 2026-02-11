import { App, TFile, MarkdownView } from 'obsidian';

/**
 * 基于行号的同步滚动管理器
 * 
 * 原理：
 * 1. 建立 Markdown 行号到预览元素的映射
 * 2. 监听预览滚动，找到当前最顶部的可见元素
 * 3. 获取该元素对应的源文件行号
 * 4. 同步编辑器滚动到对应行
 */
export class ScrollSyncManager {
    private app: App;
    private previewEl: HTMLElement | null = null;
    private currentFile: TFile | null = null;
    private syncEnabled: boolean = false;
    private isSyncing: boolean = false;
    private lineToElementMap: Map<number, HTMLElement> = new Map();
    private lastScrollTop: number = 0;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 启用/禁用同步滚动
     */
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

    /**
     * 初始化同步
     */
    async initialize(previewEl: HTMLElement, currentFile: TFile): Promise<void> {
        this.previewEl = previewEl;
        this.currentFile = currentFile;
        this.lineToElementMap.clear();
        
        // 延迟一下等待渲染完成
        setTimeout(() => {
            this.buildLineMap();
        }, 100);
    }

    /**
     * 构建行号到元素的映射
     */
    private async buildLineMap(): Promise<void> {
        if (!this.previewEl || !this.currentFile) return;

        try {
            const content = await this.app.vault.cachedRead(this.currentFile);
            const lines = content.split('\n');
            
            // 清空旧映射
            this.lineToElementMap.clear();
            
            // 获取所有块级元素
            const elements = this.previewEl.querySelectorAll(
                'h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, table, hr, .callout, .mp-content-section > div'
            );

            let lastHeadingLine = 0;
            let elementIndex = 0;

            elements.forEach((el) => {
                const element = el as HTMLElement;
                
                // 尝试从 data-source-line 获取（如果之前已设置）
                let lineNum = parseInt(element.getAttribute('data-source-line') || '-1');
                
                // 如果没有，尝试匹配标题
                if (lineNum < 0) {
                    const tagName = element.tagName.toLowerCase();
                    if (tagName.match(/^h[1-6]$/)) {
                        const text = element.textContent?.trim();
                        if (text) {
                            for (let i = lastHeadingLine; i < lines.length; i++) {
                                if (lines[i].includes(text)) {
                                    lineNum = i;
                                    lastHeadingLine = i + 1;
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // 如果还没有，使用估算
                if (lineNum < 0) {
                    lineNum = lastHeadingLine + elementIndex;
                }
                
                // 存储映射
                if (lineNum >= 0 && lineNum < lines.length) {
                    element.setAttribute('data-source-line', String(lineNum));
                    this.lineToElementMap.set(lineNum, element);
                }
                
                elementIndex++;
            });

            console.log('[ScrollSync] 行号映射建立完成，共', this.lineToElementMap.size, '个元素');
        } catch (error) {
            console.error('[ScrollSync] 建立行号映射失败:', error);
        }
    }

    /**
     * 开始同步监听
     */
    private startSync(): void {
        if (!this.previewEl) return;
        
        // 监听预览滚动
        this.previewEl.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
        
        console.log('[ScrollSync] 同步滚动已开启');
    }

    /**
     * 停止同步监听
     */
    private stopSync(): void {
        if (!this.previewEl) return;
        this.previewEl.removeEventListener('scroll', this.handlePreviewScroll);
        console.log('[ScrollSync] 同步滚动已关闭');
    }

    /**
     * 处理预览滚动
     */
    private handlePreviewScroll = (): void => {
        if (!this.syncEnabled || this.isSyncing || !this.previewEl) return;
        
        const currentScrollTop = this.previewEl.scrollTop;
        
        // 避免微小滚动触发频繁同步
        if (Math.abs(currentScrollTop - this.lastScrollTop) < 30) return;
        
        this.isSyncing = true;
        this.lastScrollTop = currentScrollTop;
        
        // 找到当前最可见的元素
        const visibleLine = this.findVisibleLine();
        if (visibleLine !== null) {
            this.syncEditorToLine(visibleLine);
        }
        
        // 防抖
        setTimeout(() => {
            this.isSyncing = false;
        }, 50);
    };

    /**
     * 找到当前预览区域最顶部的可见行号
     */
    private findVisibleLine(): number | null {
        if (!this.previewEl || this.lineToElementMap.size === 0) return null;

        const previewRect = this.previewEl.getBoundingClientRect();
        const viewportTop = previewRect.top + 50; // 留一点余量

        let closestLine: number | null = null;
        let closestDistance = Infinity;

        this.lineToElementMap.forEach((element, line) => {
            const rect = element.getBoundingClientRect();
            const elementTop = rect.top;
            
            // 元素在视口上方或刚好在视口内
            if (elementTop <= viewportTop) {
                const distance = viewportTop - elementTop;
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestLine = line;
                }
            }
        });

        // 如果没有找到（所有元素都在下方），返回第一个元素
        if (closestLine === null && this.lineToElementMap.size > 0) {
            const firstEntry = Array.from(this.lineToElementMap.entries())[0];
            closestLine = firstEntry[0];
        }

        return closestLine;
    }

    /**
     * 同步编辑器滚动到指定行
     */
    private syncEditorToLine(lineNumber: number): void {
        // 获取当前活动的 Markdown 视图
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const editor = activeView.editor;
        if (!editor) return;

        // 设置光标到目标行
        try {
            // 先获取当前光标位置
            const currentCursor = editor.getCursor();
            
            // 只有当目标行与当前行差异较大时才跳转
            if (Math.abs(currentCursor.line - lineNumber) > 3) {
                editor.setCursor({
                    line: lineNumber,
                    ch: 0
                });
                
                // 滚动编辑器使该行可见
                editor.scrollIntoView({
                    from: { line: lineNumber, ch: 0 },
                    to: { line: lineNumber, ch: 0 }
                }, true);
            }
        } catch (error) {
            console.error('[ScrollSync] 同步编辑器失败:', error);
        }
    }

    /**
     * 手动同步到指定行（用于点击跳转）
     */
    scrollToLine(lineNumber: number): void {
        if (!this.syncEnabled) return;
        this.syncEditorToLine(lineNumber);
    }

    /**
     * 获取当前可见的行号
     */
    getCurrentVisibleLine(): number | null {
        return this.findVisibleLine();
    }

    /**
     * 清理资源
     */
    destroy(): void {
        this.stopSync();
        this.lineToElementMap.clear();
    }
}
