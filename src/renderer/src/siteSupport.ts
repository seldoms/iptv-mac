import type { Site } from '@/stores/useConfigStore'

export function isSupportedContentSite(site: Site): boolean {
  if (site.hide === 1 || !site.api?.trim()) return false
  const api = site.api.trim()
  if (api.startsWith('csp_') || api.includes('.py')) return false
  if (site.type === 0 || site.type === 1 || site.type === 4) return true
  return site.type === 3 && (api.includes('.js') || api.includes('.mjs'))
}
