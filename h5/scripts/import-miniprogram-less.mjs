import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.resolve(root, '../miniprogram/miniprogram')
const outputRoot = path.resolve(root, 'src/styles/miniprogram')

const sources = [
  ['app.less', 'app.less', ''],
  ['components/navigation-bar/navigation-bar.less', 'navigation-bar.less', ''],
  ['custom-tab-bar/index.less', 'tab-bar.less', ''],
  ['pages/create/index.less', 'create.less', '.mp-create'],
  ['pages/creation-preferences/index.less', 'creation-preferences.less', '.mp-creation-preferences'],
  ['pages/preference-settings/index.less', 'preference-settings.less', '.mp-preference-settings'],
  ['pages/creating/index.less', 'creating.less', '.mp-creating'],
  ['pages/create-result/index.less', 'create-result.less', '.mp-create-result'],
  ['pages/community/index.less', 'community.less', '.mp-community'],
  ['pages/publication-detail/index.less', 'publication-detail.less', '.mp-publication-detail'],
  ['pages/profile/index.less', 'profile.less', '.mp-profile'],
  ['pages/my-works/index.less', 'my-works.less', '.mp-my-works'],
  ['pages/my-drafts/index.less', 'my-drafts.less', '.mp-my-drafts'],
  ['pages/followers/index.less', 'followers.less', '.mp-followers'],
  ['pages/following/index.less', 'following.less', '.mp-following'],
  ['pages/edit-profile/index.less', 'edit-profile.less', '.mp-edit-profile'],
  ['pages/help/index.less', 'help.less', '.mp-help'],
  ['pages/feedback/index.less', 'feedback.less', '.mp-feedback'],
  ['pages/about/index.less', 'about.less', '.mp-about'],
]

const selectorReplacements = [
  [/(?<![-\w])page(?=[\s,.#:\[>+~{])/g, ':where(.mp-page)'],
  [/(?<![-\w])image(?=[\s,.#:\[>+~{])/g, ':where(img)'],
  [/(?<![-\w])textarea(?=[\s,.#:\[>+~{])/g, ':where(textarea)'],
  [/(?<![-\w])input(?=[\s,.#:\[>+~{])/g, ':where(input)'],
  [/(?<![-\w])switch(?=[\s,.#:\[>+~{])/g, ':where(.mp-switch)'],
]

function convert(source) {
  let output = source
    .replace(/^@import\s+[^;]+;\s*$/gm, '')
    .replace(/(-?\d*\.?\d+)rpx\b/g, (_, value) => `${Number(value) / 7.5}cqw`)
  for (const [pattern, replacement] of selectorReplacements) output = output.replace(pattern, replacement)
  return output
}

await mkdir(outputRoot, { recursive: true })
for (const [source, output, scope] of sources) {
  const contents = await readFile(path.join(sourceRoot, source), 'utf8')
  const converted = convert(contents)
  await writeFile(
    path.join(outputRoot, output),
    `/* Generated from miniprogram/${source}. Do not hand-edit. */\n${scope ? `${scope} {\n${converted}\n}` : converted}`,
  )
}

const index = sources.map(([, output]) => `@import './${output}';`).join('\n')
await writeFile(path.join(outputRoot, 'index.less'), `${index}\n`)
