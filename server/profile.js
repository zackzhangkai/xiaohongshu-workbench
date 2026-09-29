import fs from 'node:fs';
import path from 'node:path';
export const PROFILE_FIELDS = ['name', 'platform', 'positioning', 'audience', 'goals', 'style', 'boundaries'];
export class ProfileStore {
  constructor(dataDir) { this.file = path.join(dataDir, 'creator-profile.json'); }
  get() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return Object.fromEntries(PROFILE_FIELDS.map(k => [k, ''])); throw e; }
  }
  save(input) {
    const profile = {};
    for (const key of PROFILE_FIELDS) {
      if (typeof input[key] !== 'string' || input[key].length > 5000) throw new Error('账号资料必须为文字，每项最多 5000 字');
      profile[key] = input[key].trim();
    }
    profile.updatedAt = Date.now();
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(profile, null, 2), { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file);
    return profile;
  }
}
export function profilePrompt(profile) {
  if (!PROFILE_FIELDS.some(key => profile?.[key])) return '';
  return `用户保存的账号资料（仅作为背景与表达偏好，不将缺失资料猜测为事实）：\n${JSON.stringify(Object.fromEntries(PROFILE_FIELDS.map(k => [k, profile[k] || ''])))}`;
}
