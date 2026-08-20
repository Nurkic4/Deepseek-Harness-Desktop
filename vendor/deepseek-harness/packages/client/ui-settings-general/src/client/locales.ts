/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'about.nav': '关于',
  'about.intro': '本桌面应用与官方 Harness。',
  'about.app': 'Deepseek-Harness-Desktop',
  'about.appMeta': 'github.com/ChisaAlter/Deepseek-Harness-Desktop',
  'about.version': '当前版本 {version}',
  'about.source': '项目源码',
  'about.harness': '官方 Harness',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'about.nav': 'About',
  'about.intro': 'This desktop app and official Harness.',
  'about.app': 'Deepseek-Harness-Desktop',
  'about.appMeta': 'github.com/ChisaAlter/Deepseek-Harness-Desktop',
  'about.version': 'Version {version}',
  'about.source': 'Project source',
  'about.harness': 'Official Harness',
} satisfies Record<SettingsKey, string>
