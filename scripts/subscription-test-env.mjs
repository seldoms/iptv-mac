import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const media = process.env.IPTV_FIXTURE_MEDIA_URL || 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
if (!['http:', 'https:'].includes(new URL(media).protocol)) throw new Error('IPTV_FIXTURE_MEDIA_URL must use HTTP or HTTPS')
const slowDelayMs = Number(process.env.IPTV_FIXTURE_SLOW_MS || 6000)
if (!Number.isInteger(slowDelayMs) || slowDelayMs < 0 || slowDelayMs > 60000) throw new Error('IPTV_FIXTURE_SLOW_MS must be an integer between 0 and 60000')
// A generated MP4 can be hosted on a controlled public test origin and selected
// with IPTV_FIXTURE_MEDIA_URL. Keep the application's media proxy policy intact.
const dataDir = await mkdtemp(join(tmpdir(), 'iptv-subscription-test-'))
const requests = []
const pendingTimers = new Set()
const type4Extend = { fixture: 'type4', token: 'fixture-token' }
const type4Flag = 'fixture-line'
function mediaUrl(source) {
  const url = new URL(media)
  url.searchParams.set('source', source)
  return url.toString()
}
function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
}
let base
const server = createServer((req, res) => {
  const url = new URL(req.url, base)
  const startedAt = Date.now()
  requests.push(url.pathname + url.search)
  res.on('finish', () => console.log(JSON.stringify({ request: url.pathname + url.search, status: res.statusCode, elapsedMs: Date.now() - startedAt })))
  res.setHeader('Access-Control-Allow-Origin', '*')
  const send = (body, status = 200, contentType = 'application/json') => {
    if (res.destroyed || res.writableEnded) return
    res.writeHead(status, { 'Content-Type': `${contentType}; charset=utf-8` })
    res.end(contentType === 'application/json' ? JSON.stringify(body) : body)
  }
  const config = (name) => ({ sites: [{ key: name, name, type: 1, api: `${base}/api/${name}`, searchable: 1 }], lives: [{ name: `${name} Live`, url: `${base}/live/${name.toLowerCase()}.m3u` }] })
  const vod = (name, id = 'demo') => ({ vod_id: id, vod_name: `${name} Playback Test`, vod_pic: '', vod_remarks: '2 episodes', vod_play_from: 'Test', vod_play_url: `Episode 1$${base}/watch/${name}/1#Episode 2$${base}/watch/${name}/2` })
  const result = (items) => ({ class: [{ type_id: '1', type_name: 'Test' }], list: items, page: 1, pagecount: 1, limit: 20, total: items.length })
  let body
  if (url.pathname === '/a.json') body = config('A')
  else if (url.pathname === '/b.json') body = config('B')
  else if (url.pathname === '/slow.json') {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer)
      send(config('Slow'))
    }, slowDelayMs)
    pendingTimers.add(timer)
    res.on('close', () => { clearTimeout(timer); pendingTimers.delete(timer) })
    return
  }
  else if (url.pathname === '/type4.json') body = { sites: [{ key: 'type4', name: 'HTTP Type 4', type: 4, api: './api/type4?fixture=required', ext: type4Extend, searchable: 1 }], lives: [] }
  else if (url.pathname === '/xml.json') body = { sites: [{ key: 'xml', name: 'XML Type 0', type: 0, api: './api/xml', searchable: 1 }], lives: [] }
  else if (url.pathname === '/warehouse/index.json') body = { urls: [{ name: 'Warehouse A', url: './a/config.json' }, { name: 'Warehouse B', url: './b/config.json' }] }
  else if (/^\/warehouse\/[ab]\/config\.json$/.test(url.pathname)) {
    const name = url.pathname.split('/')[2]
    body = {
      sites: [{ key: `warehouse-${name}`, name: `Warehouse ${name.toUpperCase()}`, type: 1, api: './api', searchable: 1 }],
      lives: [{ name: `Warehouse ${name.toUpperCase()} Live`, url: './live.m3u' }]
    }
  }
  else if (url.pathname === '/unsupported.json') body = { sites: [{ key: 'jar', name: 'JAR', type: 3, api: 'csp_Demo' }], lives: [] }
  else if (url.pathname === '/live.json') body = { sites: [], lives: [{ name: 'Demo live', url: './live.m3u' }] }
  else if (url.pathname === '/live-a.json') body = { sites: [], lives: [{ name: 'Live A', url: './live/a.m3u' }] }
  else if (url.pathname === '/live-b.json') body = { sites: [], lives: [{ name: 'Live B', url: './live/b.m3u' }] }
  else if (url.pathname === '/broken.json') { send('Unavailable', 503, 'text/plain'); return }
  else if (url.pathname === '/malformed.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end('{"sites": [')
    return
  }
  else if (url.pathname === '/api/type4') {
    let extend
    try { extend = JSON.parse(url.searchParams.get('extend') || 'null') } catch { /* Report invalid input below. */ }
    if (url.searchParams.get('fixture') !== 'required' || extend?.fixture !== type4Extend.fixture || extend?.token !== type4Extend.token) {
      send({ success: false, error: 'Type 4 requires the existing API query and JSON extend fixture/token' }, 400)
      return
    }
    if (url.searchParams.has('play')) {
      const id = url.searchParams.get('play')
      if (!['opaque:episode:1', 'opaque:episode:2'].includes(id) || url.searchParams.get('flag') !== type4Flag) {
        send({ success: false, error: 'Type 4 requires an opaque episode id and the original fixture-line flag' }, 400)
        return
      }
      body = { parse: 0, url: mediaUrl(`type4-${id.split(':').at(-1)}`) }
    } else {
      if (url.searchParams.has('t')) {
        try {
          const filters = JSON.parse(Buffer.from(url.searchParams.get('ext') || '', 'base64url').toString('utf8'))
          if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('Invalid filters')
        } catch {
          send({ success: false, error: 'Type 4 category requires base64url JSON ext filters' }, 400)
          return
        }
      }
      body = result([{ ...vod('Type 4', 'type4-demo'), vod_play_from: type4Flag, vod_play_url: 'Episode 1$opaque:episode:1#Episode 2$opaque:episode:2' }])
    }
  } else if (url.pathname === '/api/xml') {
    const ids = url.searchParams.get('ids')?.split(',')
    const videos = [1, 2].filter((index) => !ids || ids.includes(`xml-${index}`)).map((index) => `<video><id>xml-${index}</id><name>XML Playback Test ${index}</name><pic></pic><note>2 episodes</note><dl><dd flag="xml-main"><![CDATA[Episode 1$${base}/watch/xml-${index}/1#Episode 2$${base}/watch/xml-${index}/2]]></dd><dd flag="xml-backup">Episode 1$${escapeXml(mediaUrl(`xml-${index}-backup`))}</dd></dl></video>`).join('')
    send(`<?xml version="1.0" encoding="UTF-8"?><rss version="5.1"><class><ty id="1">Test</ty><ty id="2">Second category</ty></class><list page="1" pagecount="1" pagesize="20" recordcount="2">${videos}</list></rss>`, 200, 'application/xml')
    return
  } else if (/^\/warehouse\/[ab]\/api$/.test(url.pathname)) {
    body = result([vod(`Warehouse-${url.pathname.split('/')[2]}`)])
  }
  else if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.split('/').at(-1)
    body = result([vod(name)])
  } else if (url.pathname.startsWith('/watch/')) {
    send(`<html><script>const url = ${JSON.stringify(mediaUrl(url.pathname.slice('/watch/'.length)))};</script></html>`, 200, 'text/html')
    return
  } else if (url.pathname === '/live.m3u' || /^\/live\/[a-z]+\.m3u$/.test(url.pathname) || /^\/warehouse\/[ab]\/live\.m3u$/.test(url.pathname)) {
    const group = url.pathname.startsWith('/warehouse/') ? `warehouse-${url.pathname.split('/')[2]}` : url.pathname.split('/').at(-1).replace('.m3u', '')
    const variant = group.endsWith('b') ? 'b' : 'a'
    const channels = [
      { name: variant === 'a' ? 'CCTV1' : 'CCTV-1高清', id: 'cctv1', source: `${group}-cctv1-primary` },
      { name: 'CCTV1 高清', id: 'cctv1', source: `${group}-cctv1-backup` },
      { name: 'CCTV5', id: 'cctv5', source: `${group}-cctv5` },
      { name: 'CCTV5+', id: 'cctv5plus', source: `${group}-cctv5plus` }
    ]
    send('#EXTM3U\n' + channels.map((channel) => `#EXTINF:-1 tvg-id="${channel.id}" group-title="Fixture ${variant.toUpperCase()}",${channel.name}\n${mediaUrl(channel.source)}\n`).join(''), 200, 'application/vnd.apple.mpegurl')
    return
  } else { send('Not Found', 404, 'text/plain'); return }
  send(body)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
base = `http://127.0.0.1:${server.address().port}`
const subscriptions = [['A VOD', '/a.json'], ['B VOD', '/b.json'], ['HTTP Type 4', '/type4.json'], ['XML Type 0', '/xml.json'], ['Relative warehouses', '/warehouse/index.json'], ['Live A', '/live-a.json'], ['Live B', '/live-b.json'], ['Slow configuration', '/slow.json'], ['Unavailable', '/broken.json'], ['Malformed configuration', '/malformed.json'], ['Unsupported JAR', '/unsupported.json']]
await writeFile(join(dataDir, 'config-store.json'), JSON.stringify({ builtinSourcesVersion: 1, currentUrl: `${base}/a.json`, configs: subscriptions.map(([name, path]) => ({ name, url: base + path, addTime: 0, updateTime: 0 })) }))
await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ lastLiveConfigUrl: `${base}/live.json` }))
const executable = resolve('src-tauri/target/debug/bundle/macos/IPTV Mac.app/Contents/MacOS/iptv-mac')
const child = spawn(executable, [], { env: { ...process.env, IPTV_TEST_DATA_DIR: dataDir }, stdio: 'inherit' })
console.log(JSON.stringify({ dataDir, base, executable, media, slowDelayMs, subscriptions: subscriptions.map(([name, path]) => ({ name, url: base + path })), expected: { type4Flag, type4Extend, xmlVideos: 2, live: 'Merge CCTV1 aliases while retaining distinct source URLs; keep CCTV5 and CCTV5+ separate.' } }))
let stopping = false
async function stop(reason = 'shutdown') {
  if (stopping) return
  stopping = true
  console.log(JSON.stringify({ event: 'shutdown', reason, requests: requests.length }))
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  for (const timer of pendingTimers) clearTimeout(timer)
  pendingTimers.clear()
  await writeFile(join(dataDir, 'requests.json'), JSON.stringify(requests, null, 2))
  server.close()
  server.closeAllConnections()
  console.log(`Test data retained: ${dataDir}`)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code, signal) => void stop({ code, signal }))
child.on('error', (error) => {
  console.error(`Failed to start test app: ${error.message}`)
  process.exitCode = 1
  void stop('spawn error')
})
