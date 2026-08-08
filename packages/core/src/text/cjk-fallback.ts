export const BUNDLED_CJK_FAMILY = 'Noto Sans SC'
export const BUNDLED_CJK_FONT_URL = '/NotoSansSC-Regular.woff2'

export type BundledCJKFontLoader = () => Promise<ArrayBuffer | null>
export type BundledCJKFontApplier = (data: ArrayBuffer) => boolean

/**
 * Caches the same-origin CJK font independently of CanvasKit providers.
 * This lets a provider created after startup receive the exact already-downloaded bytes.
 */
export class BundledCJKFallback {
  private data: ArrayBuffer | null = null
  private loading: Promise<ArrayBuffer | null> | null = null

  constructor(
    private readonly load: BundledCJKFontLoader,
    private readonly apply: BundledCJKFontApplier
  ) {}

  prefetch(): void {
    void this.loadData()
  }

  async ensure(): Promise<boolean> {
    const data = await this.loadData()
    return data ? this.apply(data) : false
  }

  applyIfReady(): boolean {
    return this.data ? this.apply(this.data) : false
  }

  private async loadData(): Promise<ArrayBuffer | null> {
    if (this.data) return this.data
    if (!this.loading) {
      this.loading = this.load()
        .then((data) => {
          this.data = data
          return data
        })
        .catch(() => null)
        .finally(() => {
          this.loading = null
        })
    }
    return this.loading
  }
}
