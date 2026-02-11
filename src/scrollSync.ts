import { App, TFile, MarkdownView, Component } from 'obsidian';

/**
 * 基于百分比的同步滚动管理器
 * 
 * 原理：
 * 1. 计算预览区的滚动百分比
 * 2. 同步编辑器到相同的百分比位置
 * 3. 反之亦然
 */
export class ScrollSyncManager extends Component {
    private app: App;
    private previewEl: HTMLElement | null = null;
    private currentFile: TFile | null = null;
    private syncEnabled: boolean = false;
    private isSyncing: boolean = false;
    private lastSyncTime: number = 0;

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

    initialize(previewEl: HTMLElement, currentFile: TFile): void {
        this.previewEl = previewEl;
        this.currentFile = currentFile;
    }

    private startSync(): void {
        if (!this.previewEl) return;
        
        // 预览滚动监听
        this.previewEl.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
        
        // 编辑器滚动监听
        this.startEditorSync();
        
        console.log('[ScrollSync] 百分比同步已开启');
    }

    private stopSync(): void {
        if (!this.previewEl) return;
        this.previewEl.removeEventListener('scroll', this.handlePreviewScroll);
        this.stopEditorSync();
    }

    /**
     * 开始编辑器同步
     */
    private startEditorSync(): void {
        // 监听光标变化来实现近似同步
        this.registerEvent(
            this.app.workspace.on('editor-change', () => {
                if (!this.syncEnabled || this.isSyncing || !this.currentFile) return;
                
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!activeView || activeView.file?.path !== this.currentFile.path) return;
                
                const editor = activeView.editor;
                const line = editor.getCursor().line;
                const totalLines = editor.lineCount();
                
                if (totalLines > 0) {
                    const percentage = line / totalLines;
                    this.syncPreviewToPercentage(percentage);
                }
            })
        );
    }

    private stopEditorSync(): void {
        // 事件由 Component 自动清理
    }

    /**
     * 处理预览滚动 - 同步到编辑器
     */
    private handlePreviewScroll = (): void => {
        if (!this.syncEnabled || this.isSyncing || !this.previewEl) return;
        
        // 防抖
        const now = Date.now();
        if (now - this.lastSyncTime < 50) return;
        this.lastSyncTime = now;
        
        this.isSyncing = true;
        
        // 计算百分比
        const scrollTop = this.previewEl.scrollTop;
        const scrollHeight = this.previewEl.scrollHeight - this.previewEl.clientHeight;
        const percentage = scrollHeight > 0 ? scrollTop / scrollHeight : 0;
        
        // 同步到编辑器
        this.syncEditorToPercentage(percentage);
        
        setTimeout(() => {
            this.isSyncing = false;
        }, 50);
    };

    /**
     * 同步编辑器到指定百分比
     */
    private syncEditorToPercentage(percentage: number): void {
        if (!this.currentFile) return;
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || activeView.file?.path !== this.currentFile.path) return;

        const editor = activeView.editor;
        const totalLines = editor.lineCount();
        
        if (totalLines > 0) {
            const targetLine = Math.floor(percentage * totalLines);
            const currentLine = editor.getCursor().line;
            
            // 只有差异较大时才同步
            if (Math.abs(currentLine - targetLine) > 3) {
                editor.setCursor({ line: targetLine, ch: 0 });
            }
        }
    }

    /**
     * 同步预览到指定百分比
     */
    private syncPreviewToPercentage(percentage: number): void {
        if (!this.previewEl) return;
        
        const scrollHeight = this.previewEl.scrollHeight - this.previewEl.clientHeight;
        if (scrollHeight > 0) {
            const targetScrollTop = percentage * scrollHeight;
            this.previewEl.scrollTop = targetScrollTop;
        }
    }

    destroy(): void {
        this.stopSync();
        super.unload();
    }
}
