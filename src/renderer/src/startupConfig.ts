import { DEFAULT_SOURCES } from './defaultSources'

export const DEFAULT_BOOTSTRAP_SOURCE = DEFAULT_SOURCES[0]

export function resolveStartupConfigUrl(savedUrl: string | null | undefined): string {
  const normalized = savedUrl?.trim()
  return normalized || DEFAULT_BOOTSTRAP_SOURCE.url
}
