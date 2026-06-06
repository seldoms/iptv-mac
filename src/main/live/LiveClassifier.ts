/**
 * 直播频道智能分类器
 * 根据频道名识别国家/地区和类别
 */
import type { MergedChannel, CountryNode, LiveTree } from '../../shared/types'

/** 国家识别规则 */
const COUNTRY_RULES: Record<string, string[]> = {
  '中国': [
    'cctv', '央视', '卫视', '湖南', '浙江', '江苏', '北京', '上海',
    '广东', '深圳', '东方', '湖北', '四川', '山东', '河南', '河北',
    '天津', '重庆', '福建', '安徽', '辽宁', '陕西', '江西', '广西',
    '云南', '贵州', '山西', '甘肃', '海南', '吉林', '黑龙江', '内蒙古',
    '新疆', '宁夏', '青海', '西藏', '凤凰', '翡翠', '星河', '澳亚',
    '港台', '香港', '台湾', '澳门', '中国'
  ],
  '英国': ['bbc', 'itv', 'sky', 'channel4', 'channel5', 'uk'],
  '美国': ['cnn', 'fox', 'nbc', 'cbs', 'abc', 'hbo', 'espn', 'usa'],
  '日本': ['nhk', '日本', 'tbs', '富士', '朝日', '东京'],
  '韩国': ['kbs', 'mbc', 'sbs', '韩国', '首尔'],
  '其他': [] // 兜底
}

/** 类别识别规则 */
const CATEGORY_RULES: Record<string, string[]> = {
  '央视': ['cctv', '央视'],
  '卫视': [
    '卫视', '凤凰', '翡翠', '星河', '澳亚',
    '湖南卫', '浙江卫', '江苏卫', '北京卫', '东方卫', '广东卫',
    '深圳卫', '东南卫', '旅游卫', '重庆卫', '天津卫', '黑龙江卫',
    '山东卫', '湖北卫', '河北卫', '河南卫', '安徽卫', '辽宁卫',
    '陕西卫', '江西卫', '广西卫', '云南卫', '贵州卫', '山西卫',
    '甘肃卫', '海南卫', '吉林卫'
  ],
  '地方台': [
    '省台', '市台', '县级',
    '湖南卫视', '浙江卫视', '江苏卫视', '北京卫视', '东方卫视',
    '广东卫视', '深圳卫视', '山东卫视', '天津卫视', '重庆卫视',
    '东南卫视', '旅游卫视', '黑龙江卫视', '湖北卫视', '河北卫视',
    '河南卫视', '安徽卫视', '辽宁卫视', '陕西卫视', '江西卫视',
    '广西卫视', '云南卫视', '贵州卫视', '山西卫视', '甘肃卫视',
    '海南卫视', '吉林卫视', '内蒙古卫视', '新疆卫视', '宁夏卫视',
    '青海卫视', '西藏卫视'
  ],
  '体育': ['体育', 'sport', 'espn', '赛事', '足球', '篮球', 'nba', '英超'],
  '电影': ['电影', 'movie', 'hbo', 'cinema', '影院', '剧场', 'action'],
  '新闻': ['新闻', 'news', 'cnn', 'foxnews', 'bbcnews'],
  '儿童': ['少儿', '儿童', 'kids', '动画', '卡通', 'cartoon', 'baby'],
  '音乐': ['音乐', 'music', 'mtv'],
  '纪录片': ['纪录', 'documentary', 'discovery', 'natgeo', '国家地理'],
}

/**
 * 识别国家
 */
function identifyCountry(name: string): string {
  const lower = name.toLowerCase()

  for (const [country, keywords] of Object.entries(COUNTRY_RULES)) {
    if (country === '其他') continue
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return country
      }
    }
  }

  return '其他'
}

/**
 * 识别类别
 */
function identifyCategory(name: string, country: string): string {
  const lower = name.toLowerCase()

  // 先匹配具体类别
  for (const [category, keywords] of Object.entries(CATEGORY_RULES)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return category
      }
    }
  }

  // CCTV 但未被识别为央视（兜底）
  if (lower.startsWith('cctv') || lower.includes('央视')) {
    return '央视'
  }

  // 默认类别
  if (country === '中国') return '其他'
  return '综合'
}

/**
 * 计算 CCTV 排序权重
 * CCTV-1 -> 1, CCTV-4K -> 4, CCTV-5+ -> 5.5
 */
function getSortOrder(name: string, category: string): number {
  if (category === '央视') {
    const match = name.match(/cctv[\s-]*(\d+)(\+|k|4k|8k)?/i)
    if (match) {
      let num = parseInt(match[1], 10)
      const suffix = match[2]?.toLowerCase()

      if (suffix === 'k' || suffix === '4k') {
        num = num === 4 ? 4 : num // CCTV4K -> 4
      }
      if (suffix === '8k') {
        num = num === 4 ? 4.5 : num // CCTV4 8K -> 4.5
      }
      if (suffix === '+') {
        return num + 0.5 // CCTV5+ -> 5.5
      }

      return num
    }
  }

  return 999 // 非 CCTV 排在最后
}

/**
 * 分类频道
 */
export function classifyChannels(channels: MergedChannel[]): MergedChannel[] {
  return channels.map((ch) => {
    const country = identifyCountry(ch.name)
    const category = identifyCategory(ch.name, country)
    const sortOrder = getSortOrder(ch.name, category)

    return {
      ...ch,
      country,
      category,
      sortOrder
    }
  })
}

/**
 * 构建三层树结构
 */
export function buildTree(channels: MergedChannel[]): LiveTree {
  const countryMap = new Map<string, Map<string, MergedChannel[]>>()

  // 按国家和类别分组
  for (const ch of channels) {
    if (!countryMap.has(ch.country)) {
      countryMap.set(ch.country, new Map())
    }
    const catMap = countryMap.get(ch.country)!
    if (!catMap.has(ch.category)) {
      catMap.set(ch.category, [])
    }
    catMap.get(ch.category)!.push(ch)
  }

  // 构建树
  const countries: CountryNode[] = []

  // 排序：中国排第一，其他按字母
  const sortedCountries = Array.from(countryMap.keys()).sort((a, b) => {
    if (a === '中国') return -1
    if (b === '中国') return 1
    return a.localeCompare(b, 'zh')
  })

  for (const country of sortedCountries) {
    const catMap = countryMap.get(country)!
    const categories: { name: string; channels: MergedChannel[] }[] = []

    // 排序类别
    const categoryOrder: Record<string, number> = {
      '央视': 1,
      '卫视': 2,
      '地方台': 3,
      '体育': 4,
      '电影': 5,
      '新闻': 6,
      '儿童': 7,
      '音乐': 8,
      '纪录片': 9,
      '其他': 10,
      '综合': 11
    }

    const sortedCategories = Array.from(catMap.keys()).sort((a, b) => {
      const orderA = categoryOrder[a] ?? 99
      const orderB = categoryOrder[b] ?? 99
      if (orderA !== orderB) return orderA - orderB
      return a.localeCompare(b, 'zh')
    })

    for (const category of sortedCategories) {
      const chs = catMap.get(category)!.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
        return a.name.localeCompare(b.name, 'zh')
      })
      categories.push({ name: category, channels: chs })
    }

    countries.push({ name: country, categories })
  }

  return { countries }
}
