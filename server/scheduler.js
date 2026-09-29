import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class ScheduleError extends Error {}
export class Scheduler {
  constructor({ dataDir, execute, now = Date.now }) {
    this.file = path.join(dataDir, 'schedules.json');
    this.execute = execute;
    this.now = now;
    fs.mkdirSync(dataDir, { recursive: true });
    this.items = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    let recovered = false;
    for (const task of this.items) if (task.status === 'running') {
      task.status = 'failed'; task.enabled = false;
      const run = task.runs[0];
      if (run?.status === 'running') Object.assign(run, { status: 'interrupted', finishedAt: this.now(), error: '服务退出，执行结果未知。请检查结果后手动重试。' });
      recovered = true;
    }
    if (recovered) this.persist();
  }
  persist() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.items, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  list() { return structuredClone(this.items); }
  get(id) {
    const task = this.items.find(t => t.id === id);
    if (!task) throw new ScheduleError('任务不存在');
    return task;
  }
  validate(input) {
    const { title, prompt, runAt, repeat = 'once' } = input;
    if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new ScheduleError('请填写不超过 200 字的任务名称');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 50000) throw new ScheduleError('请填写有效任务内容（最多 50000 字）');
    if (!['once', 'daily', 'weekly', 'interval'].includes(repeat)) throw new ScheduleError('不支持的重复方式');
    if (typeof runAt !== 'string' || !Number.isFinite(Date.parse(runAt))) throw new ScheduleError('请选择有效执行时间');
    const intervalMinutes = Number(input.intervalMinutes ?? 60);
    if (repeat === 'interval' && (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 525600)) throw new ScheduleError('间隔必须为 1 至 525600 分钟');
    return { title: title.trim(), prompt: prompt.trim(), runAt: new Date(runAt).toISOString(), repeat, intervalMinutes };
  }
  create(input) {
    const fields = this.validate(input);
    const task = { ...fields, id: crypto.randomUUID(), nextRunAt: fields.runAt, enabled: true, status: 'scheduled', createdAt: this.now(), runs: [] };
    this.items.unshift(task); this.persist(); return structuredClone(task);
  }
  update(id, input) {
    const task = this.get(id);
    if (task.status === 'running') throw new ScheduleError('任务执行中，请等待完成后修改');
    if (typeof input.enabled !== 'boolean') throw new ScheduleError('请指定启用状态');
    if (['title', 'prompt', 'runAt', 'repeat', 'intervalMinutes'].some(key => key in input)) {
      const fields = this.validate(input);
      if (Date.parse(fields.runAt) <= this.now()) throw new ScheduleError('修改任务时，下次执行时间必须晚于现在');
      Object.assign(task, fields, { nextRunAt: fields.runAt, enabled: input.enabled, status: 'scheduled' });
      this.persist(); return structuredClone(task);
    }
    if (input.enabled && task.repeat === 'once' && task.runs.some(r => r.status === 'completed')) throw new ScheduleError('单次任务已完成，请新建任务或手动执行');
    task.enabled = input.enabled;
    if (input.enabled) task.status = 'scheduled';
    this.persist(); return structuredClone(task);
  }
  next(task) {
    let next = new Date(task.nextRunAt).getTime();
    const step = task.repeat === 'interval' ? task.intervalMinutes * 60000 : (task.repeat === 'weekly' ? 7 : 1) * 86400000;
    next += Math.max(1, Math.floor((this.now() - next) / step) + 1) * step;
    return new Date(next).toISOString();
  }
  async run(id) {
    const task = this.get(id);
    if (task.status === 'running') throw new ScheduleError('任务已经在执行');
    const run = { id: crypto.randomUUID(), startedAt: this.now(), status: 'running', title: task.title, prompt: task.prompt };
    task.runs.unshift(run); task.status = 'running'; this.persist();
    try {
      const result = await this.execute(structuredClone(task), run.id);
      Object.assign(run, { status: 'completed', sessionId: result.sessionId, finishedAt: this.now() });
      task.status = 'completed';
      if (task.repeat === 'once') task.enabled = false;
      else task.nextRunAt = this.next(task);
    } catch (error) {
      Object.assign(run, { status: 'failed', error: String(error.message), finishedAt: this.now(), ...(error.sessionId ? { sessionId: error.sessionId } : {}) });
      task.status = 'failed'; task.enabled = false;
    }
    this.persist(); return structuredClone(task);
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const task of this.items) if (task.enabled && task.status !== 'running' && Date.parse(task.nextRunAt) <= this.now()) await this.run(task.id);
    } finally { this.ticking = false; }
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(e => console.error('[scheduler]', e.message)), 5000);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}
