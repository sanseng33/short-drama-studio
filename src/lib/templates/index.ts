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

export function defaultCharacters(genre: Genre): Character[] {
  if (genre === '古风女频重生' || genre === '大女主') {
    return NVPIN_CHARACTERS.map((c) => ({ ...c }))
  }
  if (genre === '都市逆袭') {
    return [
      {
        id: 'c1',
        name: '陈默',
        role: '男主·落魄逆袭',
        visualLock:
          '二十五岁男子，短发微乱，剑眉深目，下巴有浅疤，西装皱但眼神倔强，后期换成定制黑西装气场全开',
        costume: '初期旧西装+白衬衫；逆袭后全黑修身西装，袖扣银质',
        signatureProp: '父亲留下的旧怀表（内藏芯片密钥）',
      },
      {
        id: 'c2',
        name: '林可',
        role: '女主·投行精英',
        visualLock:
          '二十四岁女性，齐肩黑发，利落侧分，杏眼含笑，职业妆容精致，气质干练温暖',
        costume: '米白西装套裙，高跟鞋，珍珠耳钉',
        signatureProp: '红色笔记本（记录关键证据）',
      },
      {
        id: 'c3',
        name: '赵凯',
        role: '反派·假好友',
        visualLock:
          '二十六岁男子，油头卷发，笑容谄媚，金丝眼镜，眼神闪烁',
        costume: '名牌运动外套+大金链，炫富感',
        signatureProp: '伪造的股权转让书',
      },
    ]
  }
  // 男频玄幻 default
  return XUANHUAN_CHARACTERS.map((c) => ({ ...c }))
}

export function defaultLogline(genre: Genre, title: string): string {
  const map: Record<Genre, string> = {
    男频玄幻: `《${title}》：被退婚的废柴少年觉醒上古神魂，一路打脸宗门天才，登临巅峰。`,
    都市逆袭: `《${title}》：被撤职扫地的落魄青年手握父亲遗留密钥，逆袭商界打脸假好友与前任。`,
    古风女频重生: `《${title}》：嫡女重生回到被害前夜，以白玉簪为刃，撕开庶妹白莲面具，掌权复仇。`,
    大女主: `《${title}》：从牺牲品到掌权者，她用权谋与真心改写命运，让所有欺辱过她的人跪地。`,
  }
  return map[genre]
}

export function defaultTitle(genre: Genre): string {
  const map: Record<Genre, string> = {
    男频玄幻: '古戒仙尊',
    都市逆袭: '重返巅峰',
    古风女频重生: '嫡女重生：白玉簪',
    大女主: '凤主沉浮',
  }
  return map[genre]
}

export function generateOutline(
  genre: Genre,
  count: number,
  title: string,
): EpisodeOutline[] {
  if (genre === '古风女频重生' || genre === '大女主') {
    return buildNvpinOutline(count, title)
  }
  // 都市逆袭复用玄幻骨架但改写口吻（模板层简单替换）
  const base = buildXuanhuanOutline(count, title)
  if (genre === '都市逆袭') {
    return base.map((e, i) => ({
      ...e,
      title: e.title
        .replace('宗门', '公司')
        .replace('秘境', '资本局')
        .replace('筑基', '融资')
        .replace('神域', '上市'),
      hook: e.hook
        .replace(/林尘/g, '陈默')
        .replace(/赵无极/g, '赵凯')
        .replace(/苏清雪/g, '林可')
        .replace(/宗门/g, '公司')
        .replace(/修为/g, '身价'),
      summary: e.summary
        .replace(/林尘/g, '陈默')
        .replace(/赵无极/g, '赵凯')
        .replace(/苏清雪/g, '林可')
        .replace(/青云宗/g, '华腾集团')
        .replace(/古戒/g, '旧怀表'),
      cliffhanger: e.cliffhanger
        .replace(/林尘/g, '陈默')
        .replace(/古戒/g, '怀表')
        .replace(/神魂/g, '芯片AI'),
    }))
  }
  return base
}

export function generateScript(
  genre: Genre,
  ep: number,
  outline: EpisodeOutline,
  chars: Character[],
  seconds: number,
): EpisodeScript {
  if (genre === '古风女频重生' || genre === '大女主') {
    return buildNvpinScript(ep, outline, chars, seconds)
  }
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
  if (genre === '古风女频重生' || genre === '大女主') {
    return buildNvpinShots(ep, outline, script, chars, style, seconds)
  }
  return buildXuanhuanShots(ep, outline, script, chars, style, seconds)
}

export function createSampleProject(): Project {
  const genre: Genre = '男频玄幻'
  const title = defaultTitle(genre)
  const characters = defaultCharacters(genre)
  const outline = generateOutline(genre, 30, title)
  const scripts: Project['scripts'] = {}
  const storyboards: Project['storyboards'] = {}
  // pre-generate ep1 for sample
  const ep = 1
  const script = generateScript(genre, ep, outline[0], characters, 75)
  scripts[ep] = script
  storyboards[ep] = generateStoryboard(
    genre,
    ep,
    outline[0],
    script,
    characters,
    '2D国风',
    75,
  )
  return {
    id: `p_${Date.now()}`,
    title,
    genre,
    platform: '红果',
    episodeCount: 30,
    secondsPerEp: 75,
    style: '2D国风',
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
  const title = '未命名漫剧'
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
