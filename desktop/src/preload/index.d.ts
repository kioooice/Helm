import type { HelmApi } from './index'

declare global {
  interface Window {
    helm: HelmApi
  }
}
