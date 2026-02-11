import { App, TFile, MarkdownView, Component } from 'obsidian';

/**
 * 简单的百分比同步滚动
 */
export class ScrollSyncManager extends Component {
    private app: App;
    private previewEl: HTMLElement | null = null;
    private currentFile: TFile | null = null;
    private syncEnabled: boolean = false;
    private isSyncing: boolean = false;

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
        this.previewEl.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
        console.log('[ScrollSync] 百分比同步已开启');
    }

    private stopSync(): void {
        if (!this.previewEl) return;
        this.previewEl.removeEventListener('scroll', this.handlePreviewScroll);
    }

    /**
     * 预览滚动时同步到编辑器
     */
    private handlePreviewScroll = (): void => {
        if (!this.syncEnabled || this.isSyncing || !this.previewEl || !this.currentFile) return;
        
        this.isSyncing = true;
        
        // 计算预览滚动百分比
        const scrollTop = this.previewEl.scrollTop;
        const scrollHeight = this.previewEl.scrollHeight - this.previewEl.clientHeight;
        if (scrollHeight <= 0) {
            this.isSyncing = false;
            return;
        }
        
        const percentage = scrollTop / scrollHeight;
        
        // 同步到编辑器
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file?.path === this.currentFile.path) {
            const editor = activeView.editor;
            const totalLines = editor.lineCount();
            const targetLine = Math.floor(percentage * totalLines);
            
            // 设置光标（这会触发编辑器滚动）
            const currentLine = editor.getCursor().line;
            if (Math.abs(currentLine - targetLine) > 3) {
                editor.setCursor({ line: targetLine, ch: 0 });
            }
        }
        
        setTimeout(() => {
            this.isSyncing = false;
        }, 100);
    };

    destroy(): void {
        this.stopSync();
        super.unload();
    }
}
