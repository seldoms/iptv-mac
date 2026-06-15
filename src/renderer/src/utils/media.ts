import { localApi } from './ipc'

let serverInfoPromise: Promise<{ url?: string; token?: string }> | null = null

function getServerInfo(): Promise<{ url?: string; token?: string }> {
  if (!serverInfoPromise) {
    serverInfoPromise = localApi.getServerInfo()
  }
  return serverInfoPromise
}

export async function getPlayableMediaUrl(
  url: string,
  header?: Record<string, string>,
  forceProxy = false
): Promise<string> {
  const shouldProxy = forceProxy || /\.m3u8(?:$|\?)/i.test(url) || !!(header && Object.keys(header).length > 0)

  if (!shouldProxy) {
    return url
  }

  try {
    const info = await getServerInfo()
    if (!info.url || !info.token) return url
    const query = new URLSearchParams({ token: info.token, url })
    if (header && Object.keys(header).length > 0) {
      query.set('header', JSON.stringify(header))
    }
    return `${info.url}/stream?${query.toString()}`
  } catch {
    return url
  }
}
