import { App, TFile, MarkdownView, Component } from 'obsidian';

/**
 * 简化的百分比同步滚动
 */
export class ScrollSyncManager extends Component {
    private app: App;
    private previewEl: HTMLElement | null = null;
    private currentFile: TFile | null = null;
    private syncEnabled: boolean = false;
    private isSyncing: boolean = false;
    private checkInterval: number | null = null;

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
        console.log('[ScrollSync] 初始化完成');
    }

    private startSync(): void {
        if (!this.previewEl) {
            console.log('[ScrollSync] 预览元素不存在');
            return;
        }
        
        // 绑定预览滚动
        this.previewEl.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
        
        // 使用定时轮询监听编辑器滚动（更可靠）
        this.startEditorPolling();
        
        console.log('[ScrollSync] 同步已开启');
    }

    private stopSync(): void {
        if (!this.previewEl) return;
        this.previewEl.removeEventListener('scroll', this.handlePreviewScroll);
        
        if (this.checkInterval) {
            window.clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        
        console.log('[ScrollSync] 同步已关闭');
    }

    /**
     * 轮询监听编辑器滚动位置
     */
    private startEditorPolling(): void {
        let lastEditorScroll = -1;
        
        this.checkInterval = window.setInterval(() => {
            if (!this.syncEnabled || this.isSyncing || !this.previewEl || !this.currentFile) return;
            
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView || activeView.file?.path !== this.currentFile.path) return;
            
            // 获取编辑器滚动容器
            const editorContainer = activeView.containerEl.querySelector('.cm-scroller, .CodeMirror-scroll');
            if (!editorContainer) return;
            
            const scrollTop = editorContainer.scrollTop;
            const scrollHeight = editorContainer.scrollHeight - editorContainer.clientHeight;
            
            if (scrollHeight <= 0) return;
            
            // 只有滚动变化较大时才同步
            if (Math.abs(scrollTop - lastEditorScroll) > 30) {
                lastEditorScroll = scrollTop;
                const percentage = scrollTop / scrollHeight;
                this.syncPreviewToPercentage(percentage);
            }
        }, 100) as unknown as number;
    }

    /**
     * 处理预览滚动
     */
    private handlePreviewScroll = (): void => {
        if (!this.syncEnabled || this.isSyncing || !this.previewEl) return;
        
        this.isSyncing = true;
        
        const scrollTop = this.previewEl.scrollTop;
        const scrollHeight = this.previewEl.scrollHeight - this.previewEl.clientHeight;
        
        if (scrollHeight <= 0) {
            this.isSyncing = false;
            return;
        }
        
        const percentage = scrollTop / scrollHeight;
        this.syncEditorToPercentage(percentage);
        
        setTimeout(() => {
            this.isSyncing = false;
        }, 100);
    };

    /**
     * 同步编辑器到指定百分比
     */
    private syncEditorToPercentage(percentage: number): void {
        if (!this.currentFile) return;
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || activeView.file?.path !== this.currentFile.path) return;
        
        // 获取编辑器滚动容器
        const editorContainer = activeView.containerEl.querySelector('.cm-scroller, .CodeMirror-scroll');
        if (!editorContainer) {
            console.log('[ScrollSync] 未找到编辑器滚动容器');
            return;
        }
        
        const scrollHeight = editorContainer.scrollHeight - editorContainer.clientHeight;
        if (scrollHeight <= 0) return;
        
        const targetScrollTop = percentage * scrollHeight;
        editorContainer.scrollTop = targetScrollTop;
        
        console.log('[ScrollSync] 预览→编辑器:', Math.round(percentage * 100) + '%');
    }

    /**
     * 同步预览到指定百分比
     */
    private syncPreviewToPercentage(percentage: number): void {
        if (!this.previewEl) return;
        
        const scrollHeight = this.previewEl.scrollHeight - this.previewEl.clientHeight;
        if (scrollHeight <= 0) return;
        
        this.isSyncing = true;
        this.previewEl.scrollTop = percentage * scrollHeight;
        
        console.log('[ScrollSync] 编辑器→预览:', Math.round(percentage * 100) + '%');
        
        setTimeout(() => {
            this.isSyncing = false;
        }, 100);
    }

    destroy(): void {
        this.stopSync();
        super.unload();
    }
}
