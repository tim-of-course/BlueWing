import { resolveConstruction } from '../core/applied-assemblies';
import { registry } from './registry';
import { constructionTargets } from './wingman-types';
import type { CommandCall, Project } from '../core/types';
import type {
  ActivityCategory,
  ActivityTarget,
  WingmanActivity,
} from './wingman-types';

const edits = new Set(
  registry.filter((entry) => entry.mutates).map((entry) => entry.name),
);
export function activityCategory(call: CommandCall): ActivityCategory {
  const { name } = call;
  if (['sheet.render', 'snippet.render', 'construction.render'].includes(name))
    return 'Rendered';
  if (
    [
      'takeoff.select',
      'wingman.inspect',
      'wingman.flash',
      'wingman.annotate',
      'project.open',
      'project.close',
    ].includes(name)
  )
    return 'Looked at';
  if (name === 'batch') {
    const children = record(call.payload).commands;
    return Array.isArray(children) &&
      children.some((child) => edits.has(record(child).name as string))
      ? 'Changed'
      : 'Read';
  }
  return edits.has(name) && name !== 'preview' ? 'Changed' : 'Read';
}

const record = (value: unknown) => (value ?? {}) as Record<string, unknown>;

export function constructionKind(kind: string) {
  return Object.hasOwn(constructionTargets, kind)
    ? constructionTargets[kind as keyof typeof constructionTargets]
    : undefined;
}
export function activityEntity(
  project: Project,
  kind: ActivityTarget['kind'],
  id: string,
) {
  switch (kind) {
    case 'sheet':
      return project.sheets[id];
    case 'takeoff':
      return project.takeoffs[id];
    case 'geometry':
      return project.geometries[id];
    case 'group':
      return project.groups[id];
    case 'assembly':
      return project.recipes[id];
    case 'snippet':
      return project.review?.snippets[id];
    case 'wall':
    case 'opening':
    case 'header':
    case 'ceiling':
    case 'level':
    case 'placement':
      return resolveConstruction(project)[constructionTargets[kind]][id];
  }
}
export function changedTargets(
  call: CommandCall,
  data: unknown,
  project: Project,
): ActivityTarget[] {
  const payload = record(call.payload);
  const result = record(data);
  if (call.name === 'batch' && Array.isArray(data)) {
    const commands = payload.commands as CommandCall[];
    return data.flatMap((child, index) =>
      commands[index] && edits.has(commands[index].name)
        ? changedTargets(commands[index], child, project)
        : [],
    );
  }
  const kind = call.name.split('.')[0];
  const targets: ActivityTarget[] = [];
  function add(kind: ActivityTarget['kind'], id: unknown) {
    if (typeof id !== 'string') return;
    const item = activityEntity(project, kind, id);
    if (item)
      targets.push({
        kind,
        id,
        label: 'name' in item && item.name ? item.name : id,
      });
  }
  if (call.name === 'project.import' && Array.isArray(data)) {
    for (const sheet of data) add('sheet', record(sheet).id);
  } else if (
    kind === 'geometry' ||
    kind === 'group' ||
    kind === 'sheet' ||
    kind === 'takeoff'
  ) {
    if (call.name === 'takeoff.copyItems') {
      for (const id of Object.values(record(result.ids))) add('geometry', id);
    } else if (call.name === 'geometry.move' && Array.isArray(payload.ids)) {
      for (const id of payload.ids) add(kind, id);
    } else if (
      call.name === 'sheet.naming.apply' &&
      Array.isArray(payload.sheets)
    ) {
      for (const sheet of payload.sheets) add(kind, record(sheet).id);
    } else if (!call.name.endsWith('.delete'))
      add(kind, record(result.geometry).id ?? result.id ?? payload.id);
  } else if (kind === 'recipe' || kind === 'assembly') {
    add('assembly', result.id ?? payload.id);
  } else if (kind === 'snippet') {
    add('snippet', result.id);
  } else if (kind && constructionKind(kind)) {
    add(kind as keyof typeof constructionTargets, result.id);
  } else if (call.name === 'review.mark') {
    const source = record(result.target);
    if (
      typeof source.kind === 'string' &&
      ['geometry', 'wall', 'opening', 'assembly', 'header', 'ceiling'].includes(
        source.kind,
      )
    )
      add(source.kind as ActivityTarget['kind'], source.id);
  } else {
    add('geometry', result.geometryId ?? payload.geometryId);
    add('group', result.groupId ?? payload.groupId);
    add('sheet', result.sheetId ?? payload.sheetId);
  }
  return targets;
}

/** A reply closes everything that started before that message was saved. */
export function groupActivity(
  entries: readonly WingmanActivity[],
  replyIds: readonly number[],
) {
  const turns = new Map<number, WingmanActivity[]>();
  let index = 0;
  for (const entry of entries) {
    while ((replyIds[index] ?? Infinity) <= entry.afterMessageId) index++;
    const key = replyIds[index] ?? 0;
    const turn = turns.get(key);
    if (turn) turn.push(entry);
    else turns.set(key, [entry]);
  }
  return turns;
}

export function workDuration(start: number, end: number) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60
    ? `${String(seconds)}s`
    : `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}

const encoder = new TextEncoder();
const entrySizes = new WeakMap<WingmanActivity, number>();
function entryBytes(entry: WingmanActivity) {
  const cached = entrySizes.get(entry);
  if (cached !== undefined) return cached;
  const size = encoder.encode(JSON.stringify(entry)).length + 1;
  entrySizes.set(entry, size);
  return size;
}
export function boundActivity(
  entries: readonly WingmanActivity[],
  replyIds: readonly number[],
) {
  // Each earlier turn has a saved reply. Keep the latest turn's newest details.
  let count = entries.length;
  let size = 1 + entries.reduce((sum, entry) => sum + entryBytes(entry), 0);
  if (count <= 500 && size <= 2 * 1024 * 1024) return entries.slice();
  const turns = [...groupActivity(entries, replyIds).values()];
  let removed = 0;
  for (const [index, turn] of turns.entries()) {
    if (count <= 500 && size <= 2 * 1024 * 1024) break;
    for (const entry of turn) {
      count--;
      removed++;
      size -= entryBytes(entry);
      if (index === turns.length - 1 && count <= 500 && size <= 2 * 1024 * 1024)
        break;
    }
  }
  return entries.slice(removed);
}
