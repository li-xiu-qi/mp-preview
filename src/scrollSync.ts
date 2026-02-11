import { App, MarkdownRenderer, TFile } from 'obsidian';

/**
 * 基于锚点的同步滚动管理器
 * 
 * 原理：
 * 1. 给预览中的每个块级元素（标题、段落、列表等）添加 data-source-line 属性
 * 2. 监听编辑器滚动，获取当前顶部的行号
 * 3. 在预览中找到对应的 data-source-line 元素并滚动到视口
 */
export class ScrollSyncManager {
    private app: App;
    private previewEl: HTMLElement | null = null;
    private editorEl: HTMLElement | null = null;
    private syncEnabled: boolean = false;
    private isScrolling: boolean = false;
    private lineMap: Map<number, HTMLElement> = new Map();
    private observer: MutationObserver | null = null;

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

    /**
     * 初始化同步
     */
    initialize(previewEl: HTMLElement, currentFile: TFile): void {
        this.previewEl = previewEl;
        this.buildLineMap();
        this.injectSourceLineAttributes(currentFile);
    }

    /**
     * 构建行号映射表
     */
    private buildLineMap(): void {
        if (!this.previewEl) return;
        
        this.lineMap.clear();
        
        // 获取所有可映射的元素
        const elements = this.previewEl.querySelectorAll(
            '[data-source-line], h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, table, hr'
        );
        
        elements.forEach((el, index) => {
            // 如果没有 data-source-line，使用元素索引作为近似值
            const lineAttr = el.getAttribute('data-source-line');
            const lineNumber = lineAttr ? parseInt(lineAttr, 10) : index;
            
            if (!isNaN(lineNumber)) {
                this.lineMap.set(lineNumber, el as HTMLElement);
            }
        });
    }

    /**
     * 尝试从 Markdown 内容注入源行号
     * 利用 Obsidian 的 metadata 信息
     */
    private async injectSourceLineAttributes(currentFile: TFile): Promise<void> {
        if (!this.previewEl || !currentFile) return;

        try {
            const content = await this.app.vault.cachedRead(currentFile);
            const lines = content.split('\n');
            
            // 映射标题到行号
            let currentLine = 0;
            const headings = this.previewEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
            
            headings.forEach((heading) => {
                const text = heading.textContent || '';
                // 在源文件中找到匹配的行
                for (let i = currentLine; i < lines.length; i++) {
                    if (lines[i].includes(text.trim())) {
                        heading.setAttribute('data-source-line', String(i));
                        heading.setAttribute('data-scroll-anchor', 'true');
                        currentLine = i + 1;
                        break;
                    }
                }
            });

            // 给其他块级元素添加近似行号
            this.approximateLineNumbers(lines);
        } catch (error) {
            console.error('注入源行号失败:', error);
        }
    }

    /**
     * 为没有精确映射的元素添加近似行号
     */
    private approximateLineNumbers(lines: string[]): void {
        if (!this.previewEl) return;

        // 获取所有块级元素
        const blocks = this.previewEl.querySelectorAll(
            'p, li, pre, blockquote, table, hr, .callout'
        );

        let lastHeadingLine = 0;
        let blockIndex = 0;

        blocks.forEach((block) => {
            // 如果已经有精确行号，跳过
            if (block.hasAttribute('data-source-line')) {
                const line = parseInt(block.getAttribute('data-source-line')!, 10);
                lastHeadingLine = line;
                return;
            }

            // 基于前面最近的标题行号进行估算
            const estimatedLine = lastHeadingLine + blockIndex;
            block.setAttribute('data-source-line', String(Math.min(estimatedLine, lines.length - 1)));
            block.setAttribute('data-scroll-anchor', 'true');
            blockIndex++;
        });
    }

    /**
     * 开始同步监听
     */
    private startSync(): void {
        // 由于无法直接监听 Obsidian 编辑器滚动，
        // 我们实现一个简化版：监听预览滚动，用户可以在预览中点击跳转
        if (!this.previewEl) return;

        // 添加点击跳转功能
        this.previewEl.addEventListener('click', this.handlePreviewClick);
        
        // 监听滚动事件（用于记录当前可见元素）
        this.previewEl.addEventListener('scroll', this.handlePreviewScroll);
    }

    /**
     * 停止同步监听
     */
    private stopSync(): void {
        if (!this.previewEl) return;
        this.previewEl.removeEventListener('click', this.handlePreviewClick);
        this.previewEl.removeEventListener('scroll', this.handlePreviewScroll);
    }

    /**
     * 处理预览点击 - 点击元素时跳转到编辑器对应位置
     */
    private handlePreviewClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;
        const anchor = target.closest('[data-scroll-anchor]') as HTMLElement;
        
        if (anchor && this.app.workspace.activeEditor?.editor) {
            const line = anchor.getAttribute('data-source-line');
            if (line) {
                const lineNumber = parseInt(line, 10);
                // 跳转到编辑器对应行
                this.app.workspace.activeEditor.editor.setCursor({
                    line: lineNumber,
                    ch: 0
                });
            }
        }
    };

    /**
     * 处理预览滚动 - 记录当前最可见的元素
     */
    private handlePreviewScroll = (): void => {
        if (this.isScrolling || !this.previewEl) return;
        
        this.isScrolling = true;
        requestAnimationFrame(() => {
            this.updateVisibleAnchor();
            this.isScrolling = false;
        });
    };

    /**
     * 更新当前可见的锚点
     */
    private updateVisibleAnchor(): void {
        if (!this.previewEl) return;

        const anchors = this.previewEl.querySelectorAll('[data-scroll-anchor]');
        let closestAnchor: HTMLElement | null = null;
        let closestDistance = Infinity;

        anchors.forEach((anchor) => {
            const rect = anchor.getBoundingClientRect();
            const previewRect = this.previewEl!.getBoundingClientRect();
            const distance = Math.abs(rect.top - previewRect.top);

            if (rect.top >= previewRect.top && distance < closestDistance) {
                closestDistance = distance;
                closestAnchor = anchor as HTMLElement;
            }
        });

        // 高亮当前可见元素（可选）
        anchors.forEach(a => (a as HTMLElement).classList.remove('mp-scroll-active'));
        if (closestAnchor) {
            (closestAnchor as HTMLElement).classList.add('mp-scroll-active');
        }
    }

    /**
     * 滚动到指定行号
     */
    scrollToLine(lineNumber: number): void {
        if (!this.previewEl) return;

        const element = this.lineMap.get(lineNumber);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            // 如果没有精确匹配，找最近的
            let closestLine = 0;
            let minDiff = Infinity;
            
            this.lineMap.forEach((_, line) => {
                const diff = Math.abs(line - lineNumber);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestLine = line;
                }
            });

            const closestElement = this.lineMap.get(closestLine);
            if (closestElement) {
                closestElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    /**
     * 获取当前可见的行号
     */
    getCurrentVisibleLine(): number | null {
        if (!this.previewEl) return null;

        const activeElement = this.previewEl.querySelector('.mp-scroll-active');
        if (activeElement) {
            const line = activeElement.getAttribute('data-source-line');
            return line ? parseInt(line, 10) : null;
        }
        return null;
    }

    /**
     * 清理资源
     */
    destroy(): void {
        this.stopSync();
        this.observer?.disconnect();
        this.lineMap.clear();
    }
}
