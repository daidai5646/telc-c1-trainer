const seedMarker = 'telc-c1-public-bank-v2'

export async function loadPublicQuestionBank() {
  if (localStorage.getItem(seedMarker)) return

  // Merge missing items by ID; an existing local library is never replaced.
  const encodedParts = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
    const filename = `question-bank.part-${String(index).padStart(2, '0')}.txt`
    const response = await fetch(`${import.meta.env.BASE_URL}${filename}`)
    if (!response.ok) throw new Error(`线上题库读取失败（${response.status}）。`)
    return response.text()
  }))
  if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持线上题库解压，请手动导入 JSON 题库。')
  const compressed = Uint8Array.from(atob(encodedParts.join('')), (character) => character.charCodeAt(0))
  const decompressed = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
  const bundle: unknown = JSON.parse(await new Response(decompressed).text())
  const { importQuestionBank } = await import('./exchange')
  await importQuestionBank(bundle, 'skip')
  localStorage.setItem(seedMarker, 'loaded')
}
