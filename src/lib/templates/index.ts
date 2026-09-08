import type {
  ArtStyle,
  Character,
  EpisodeOutline,
  EpisodeScript,
  Genre,
  Project,
  Shot,
} from '../../types'
import {
  XUANHUAN_CHARACTERS,
  buildXuanhuanOutline,
  buildXuanhuanScript,
  buildXuanhuanShots,
} from './xuanhuan'
import {
  NVPIN_CHARACTERS,
  buildNvpinOutline,
  buildNvpinScript,
  buildNvpinShots,
} from './nvpin'
import {
  DUSHI_NIXI_CHARACTERS,
  DUSHI_CHONGSHENG_CHARACTERS,
  buildDushiOutline,
  buildDushiScript,
  buildDushiShots,
} from './dushi'

function isNvpin(genre: Genre): boolean {
  return genre === '古风女频重生' || genre === '大女主'
}

function isDushi(genre: Genre): boolean {
  return genre === '都市逆袭' || genre === '都市重生'
}

function dushiMode(genre: Genre): 'nixi' | 'chongsheng' {
  return genre === '都市重生' ? 'chongsheng' : 'nixi'
}

export function defaultCharacters(genre: Genre): Character[] {
  if (isNvpin(genre)) return NVPIN_CHARACTERS.map((c) => ({ ...c }))
  if (genre === '都市重生') return DUSHI_CHONGSHENG_CHARACTERS.map((c) => ({ ...c }))
  if (genre === '都市逆袭') return DUSHI_NIXI_CHARACTERS.map((c) => ({ ...c }))
  return XUANHUAN_CHARACTERS.map((c) => ({ ...c }))
}

export function defaultLogline(genre: Genre, title: string): string {
  const map: Record<Genre, string> = {
    男频玄幻: `《${title}》：被退婚的废柴少年觉醒上古神魂，一路打脸宗门天才，登临巅峰。`,
    都市逆袭: `《${title}》：被撤职扫地的落魄青年手握父亲遗留密钥，逆袭商界打脸假好友与前任。`,
    都市重生: `《${title}》：职场女重生回到被害前夜，撕开白莲闺蜜面具，夺回股权与人生。`,
    古风女频重生: `《${title}》：嫡女重生回到被害前夜，以白玉簪为刃，撕开庶妹白莲面具，掌权复仇。`,
    大女主: `《${title}》：从牺牲品到掌权者，她用权谋与真心改写命运，让所有欺辱过她的人跪地。`,
  }
  return map[genre]
}

export function defaultTitle(genre: Genre): string {
  const map: Record<Genre, string> = {
    男频玄幻: '古戒仙尊',
    都市逆袭: '重返巅峰',
    都市重生: '重生之星',
    古风女频重生: '嫡女重生：白玉簪',
    大女主: '凤主沉浮',
  }
  return map[genre]
}

/** 都市题材默认更贴真人都市画风 */
export function defaultStyleForGenre(genre: Genre): ArtStyle {
  if (isDushi(genre)) return '真人都市'
  if (isNvpin(genre)) return '2D国风'
  return '2D国风'
}

export function generateOutline(
  genre: Genre,
  count: number,
  title: string,
): EpisodeOutline[] {
  if (isNvpin(genre)) return buildNvpinOutline(count, title)
  if (isDushi(genre)) return buildDushiOutline(count, title, dushiMode(genre))
  return buildXuanhuanOutline(count, title)
}

export function generateScript(
  genre: Genre,
  ep: number,
  outline: EpisodeOutline,
  chars: Character[],
  seconds: number,
): EpisodeScript {
  if (isNvpin(genre)) return buildNvpinScript(ep, outline, chars, seconds)
  if (isDushi(genre)) return buildDushiScript(ep, outline, chars, seconds, dushiMode(genre))
  return buildXuanhuanScript(ep, outline, chars, seconds)
}

export function generateStoryboard(
  genre: Genre,
  ep: number,
  outline: EpisodeOutline,
  script: EpisodeScript,
  chars: Character[],
  style: ArtStyle,
  seconds: number,
): Shot[] {
  if (isNvpin(genre)) return buildNvpinShots(ep, outline, script, chars, style, seconds)
  if (isDushi(genre)) {
    return buildDushiShots(ep, outline, script, chars, style, seconds, dushiMode(genre))
  }
  return buildXuanhuanShots(ep, outline, script, chars, style, seconds)
}

export function createSampleProject(): Project {
  const genre: Genre = '都市逆袭'
  const title = defaultTitle(genre)
  const characters = defaultCharacters(genre)
  const style = defaultStyleForGenre(genre)
  const outline = generateOutline(genre, 30, title)
  const scripts: Project['scripts'] = {}
  const storyboards: Project['storyboards'] = {}
  const ep = 1
  const script = generateScript(genre, ep, outline[0], characters, 75)
  scripts[ep] = script
  storyboards[ep] = generateStoryboard(genre, ep, outline[0], script, characters, style, 75)
  return {
    id: `p_${Date.now()}`,
    title,
    genre,
    platform: '红果',
    episodeCount: 30,
    secondsPerEp: 75,
    style,
    logline: defaultLogline(genre, title),
    characters,
    outline,
    scripts,
    storyboards,
    selectedEpisode: 1,
    updatedAt: new Date().toISOString(),
  }
}

export function createBlankProject(): Project {
  const genre: Genre = '男频玄幻'
  const title = '未命名短剧'
  return {
    id: `p_${Date.now()}`,
    title,
    genre,
    platform: '红果',
    episodeCount: 30,
    secondsPerEp: 75,
    style: '2D国风',
    logline: '',
    characters: defaultCharacters(genre),
    outline: [],
    scripts: {},
    storyboards: {},
    selectedEpisode: 1,
    updatedAt: new Date().toISOString(),
  }
}
