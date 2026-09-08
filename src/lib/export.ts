import type { Project } from '../types'

export function projectToMarkdown(project: Project): string {
  const lines: string[] = [
    `# ${project.title}`,
    '',
    `> ${project.logline}`,
    '',
    `- 题材：${project.genre}`,
    `- 平台：${project.platform}`,
    `- 集数：${project.episodeCount} × ${project.secondsPerEp}s`,
    `- 画风：${project.style}`,
    `- 更新：${project.updatedAt}`,
    '',
    '## 角色卡',
    '',
  ]
  for (const c of project.characters) {
    lines.push(
      `### ${c.name}（${c.role}）`,
      `- 视觉锁定：${c.visualLock}`,
      `- 服装：${c.costume}`,
      `- 标志道具：${c.signatureProp}`,
      '',
    )
  }
  lines.push('## 分集大纲', '')
  for (const e of project.outline) {
    lines.push(
      `### 第${e.episode}集《${e.title}》`,
      `- 钩子：${e.hook}`,
      `- 概要：${e.summary}`,
      `- 悬念：${e.cliffhanger}`,
      '',
    )
  }
  const eps = Object.keys(project.scripts)
    .map(Number)
    .sort((a, b) => a - b)
  if (eps.length) {
    lines.push('## 分集剧本', '')
    for (const ep of eps) {
      lines.push(project.scripts[ep].fullText, '', '---', '')
    }
  }
  const sbEps = Object.keys(project.storyboards)
    .map(Number)
    .sort((a, b) => a - b)
  if (sbEps.length) {
    lines.push('## 分镜表', '')
    for (const ep of sbEps) {
      lines.push(`### 第${ep}集分镜`, '')
      lines.push(
        '| 镜号 | 景别 | 时长 | 画面 | 动作 | 台词 | 运镜 | 情绪 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
      )
      for (const s of project.storyboards[ep]) {
        lines.push(
          `| ${s.shotNo} | ${s.size} | ${s.durationSec}s | ${s.visual} | ${s.action} | ${s.dialogue || '-'} | ${s.camera} | ${s.emotion} |`,
        )
      }
      lines.push('', '#### Seedance 提示词', '')
      for (const s of project.storyboards[ep]) {
        lines.push(`**镜${s.shotNo}**`, '', '```', s.seedancePrompt, '```', '')
      }
    }
  }
  lines.push(
    '## 附：工作流备忘',
    '',
    '选题 → 大纲 → 分集剧本 → 角色资产 → 分镜表 → Seedance/本地T2V → 剪映出片 → 平台投稿',
    '',
    '详见 GUIDE.md',
  )
  return lines.join('\n')
}

export function seedancePack(project: Project, episode?: number): string {
  const eps =
    episode != null
      ? [episode]
      : Object.keys(project.storyboards)
          .map(Number)
          .sort((a, b) => a - b)
  const blocks: string[] = [`# ${project.title} · Seedance 提示词包`, '']
  for (const ep of eps) {
    const shots = project.storyboards[ep]
    if (!shots?.length) continue
    blocks.push(`## 第${ep}集`, '')
    for (const s of shots) {
      blocks.push(
        `### 镜${s.shotNo}｜${s.size}｜${s.durationSec}s｜${s.camera}`,
        s.groupNote ? `> 镜头组：${s.groupNote}` : '',
        '',
        s.seedancePrompt,
        '',
        '---',
        '',
      )
    }
  }
  return blocks.filter((x) => x !== undefined).join('\n')
}
