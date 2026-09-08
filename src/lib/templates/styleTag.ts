import type { ArtStyle } from '../../types'

/** Seedance / 分镜提示词里的画风短句 */
export function styleTag(style: ArtStyle, tone: 'xianxia' | 'gufeng' | 'dushi' = 'dushi'): string {
  if (style === '真人都市') {
    return '真人实拍都市短剧质感，自然肤质，电影级布光，当代中国一线城市实景，竖屏短剧摄影，禁止二次元漫画脸'
  }
  if (style === '2D国风') {
    if (tone === 'gufeng') return '2D国风古装动画，精致服饰纹样，柔光水墨背景'
    if (tone === 'xianxia') return '2D国风仙侠动画，细腻线稿，水墨晕染背景'
    return '2D国风都市动画，干净线稿，柔和色块'
  }
  // 2D日漫
  if (tone === 'gufeng') return '2D日漫古风，细腻瞳孔高光，柔和色调'
  if (tone === 'xianxia') return '2D日漫风格，赛璐璐上色，高对比光影'
  return '2D日漫都市，赛璐璐上色，清爽现代服装'
}
