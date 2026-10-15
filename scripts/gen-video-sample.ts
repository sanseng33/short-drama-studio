/** npx tsx scripts/gen-video-sample.ts → samples/video-pipeline.sample.json */
import { writeFileSync, mkdirSync } from 'node:fs'
import { heuristicIdea, mapGenre, mapStyle, toCharacters, toOutline } from '../src/lib/idea'
import { generateScript, generateStoryboard } from '../src/lib/templates'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import type { Project } from '../src/types'

const IDEA =
  '《逆光者》讲述外卖员林川被豪门公子赵泽当众羞辱。林川意外得到父亲留下的加密芯片，发现赵家吞并父亲公司的真相。苏晴是调查记者，决定帮助林川。林川一步步反击，赵泽设下圈套。'

const idea = heuristicIdea(IDEA)
const { genre, custom } = mapGenre(idea.genre, IDEA)
const style = mapStyle(idea.artStyle, genre)
const characters = toCharacters(idea.characters)
const outline = toOutline(idea.episodes).slice(0, 2)
const seconds = 75
const scripts: Project['scripts'] = {}
const storyboards: Project['storyboards'] = {}
for (const o of outline) {
  const sc = generateScript(genre, o.episode, o, characters, seconds)
  scripts[o.episode] = sc
  storyboards[o.episode] = generateStoryboard(genre, o.episode, o, sc, characters, style, seconds)
}
const project: Project = {
  id: 'p_sample',
  title: idea.title,
  genre,
  customGenre: custom,
  platform: '红果',
  episodeCount: outline.length,
  secondsPerEp: seconds,
  style,
  logline: idea.logline,
  characters,
  outline,
  scripts,
  storyboards,
  selectedEpisode: 1,
  updatedAt: '2026-10-15T00:00:00.000Z',
}
mkdirSync('samples', { recursive: true })
writeFileSync('samples/video-pipeline.sample.json', JSON.stringify(buildVideoPipelineExport(project), null, 2) + '\n')
console.log('wrote samples/video-pipeline.sample.json')
