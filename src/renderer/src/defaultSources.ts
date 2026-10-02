import bundledSources from '@shared/default-sources.json'

export interface DefaultSource {
  name: string
  url: string
  desc: string
  sites?: number
  lives?: number
}

export const DEFAULT_SOURCES: DefaultSource[] = bundledSources.map((source) => ({
  ...source,
  desc: '内置兼容配置源'
}))
