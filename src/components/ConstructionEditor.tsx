import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import type { PayloadSchema } from '../core/commands';
import { constructionSchemas } from '../core/detailed-commands';
import { emptyConstruction } from '../core/construction';
import { resolveConstruction } from '../core/applied-assemblies';
import type { ConstructionData } from '../core/construction-types';
import { wallTemplateFromWall } from '../core/wall-template';
import { displayLength } from './PieceSchedule';
import './construction-editor.css';

type Kind = Exclude<keyof ConstructionData, 'materials'>;
const kinds: { kind: Kind; command: string; label: string }[] = [
  { kind: 'walls', command: 'wall', label: 'Walls' },
  { kind: 'openings', command: 'opening', label: 'Openings' },
  { kind: 'headers', command: 'header', label: 'Header details' },
  { kind: 'ceilings', command: 'ceiling', label: 'Ceilings' },
  { kind: 'levels', command: 'level', label: 'Levels' },
  { kind: 'placements', command: 'placement', label: 'Sheet alignment' },
];
const title = (key: string) =>
  key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const scalarKeys = new Set(['layers', 'count', 'jambCount', 'wastePercent']);
const angleKeys = new Set(['rotation', 'sectionRotation']);
const pageKeys = new Set(['pageOrigin']);
const surfaceKeys = new Set(['finishes', 'ceilings', 'path-surface']);
const constructionReferenceKeys = new Set([
  'wallId',
  'ownerWallId',
  'headerId',
  'levelId',
]);
function seed(schema: PayloadSchema, key = ''): unknown {
  if (schema.type === 'object')
    return Object.fromEntries(
      (schema.required ?? []).map((name) => [
        name,
        seed(schema.properties?.[name] ?? {}, name),
      ]),
    );
  if (schema.type === 'array') return [];
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'number')
    return schema.minimum && schema.minimum > 0 ? 1 : 0;
  if (key === 'id') return crypto.randomUUID();
  return '';
}
function scalarText(value: unknown): string {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : '';
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function ConstructionFields(props: {
  schema: PayloadSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  unit: 'm' | 'ft';
  controller: WorkspaceController;
  parent?: string;
  hide?: string[];
  inherited?: Record<string, unknown> | undefined;
}) {
  const hasConstructionReferences = createMemo(() =>
    Object.keys(props.schema.properties ?? {}).some((key) =>
      constructionReferenceKeys.has(key),
    ),
  );
  const construction = createMemo(
    () => {
      if (!hasConstructionReferences()) return undefined;
      const project = props.controller.project();
      return project ? resolveConstruction(project) : undefined;
    },
    { name: 'construction.referenceChoices' },
  );
  const set = (key: string, value: unknown) => {
    const next = { ...props.value };
    if (value === undefined) Reflect.deleteProperty(next, key);
    else next[key] = value;
    props.onChange(next);
  };
  const choices = (key: string) => {
    if (
      key !== 'geometryId' &&
      key !== 'sheetId' &&
      !constructionReferenceKeys.has(key)
    )
      return null;
    const project = props.controller.project();
    if (key === 'geometryId')
      return Object.values(project?.geometries ?? {})
        .filter(
          (g) => g.kind === (props.parent === 'ceilings' ? 'area' : 'path'),
        )
        .map((g) => ({ id: g.id, name: g.name }));
    if (key === 'sheetId')
      return Object.values(project?.sheets ?? {}).map((s) => ({
        id: s.id,
        name: s.name,
      }));
    if (key === 'wallId' || key === 'ownerWallId')
      return Object.values(construction()?.walls ?? {}).map((w) => ({
        id: w.id,
        name: project?.geometries[w.geometryId]?.name ?? w.id,
      }));
    if (key === 'headerId')
      return Object.values(construction()?.headers ?? {}).map((h) => ({
        id: h.id,
        name: h.name,
      }));
    if (key === 'levelId')
      return Object.values(construction()?.levels ?? {}).map((l) => ({
        id: l.id,
        name: l.name,
      }));
    return null;
  };
  const factor = (key: string) => {
    if (angleKeys.has(key)) return Math.PI / 180;
    if (
      scalarKeys.has(key) ||
      pageKeys.has(props.parent ?? '') ||
      (key === 'packageSize' && !surfaceKeys.has(props.parent ?? ''))
    )
      return 1;
    return props.unit === 'ft'
      ? key === 'packageSize' && surfaceKeys.has(props.parent ?? '')
        ? 0.09290304
        : 0.3048
      : 1;
  };
  const suffix = (key: string) =>
    angleKeys.has(key)
      ? ' (degrees)'
      : scalarKeys.has(key)
        ? key === 'wastePercent'
          ? ' (%)'
          : ''
        : pageKeys.has(props.parent ?? '')
          ? ' (page units)'
          : key === 'packageSize' && !surfaceKeys.has(props.parent ?? '')
            ? ' (pieces)'
            : ` (${props.unit}${key === 'packageSize' && surfaceKeys.has(props.parent ?? '') ? '²' : ''})`;
  return (
    <div class="construction-fields">
      <For
        each={Object.entries(props.schema.properties ?? {}).filter(
          ([key]) => !props.hide?.includes(key),
        )}
      >
        {([key, schema]) => {
          const required = () => props.schema.required?.includes(key) ?? false;
          const value = () =>
            Object.hasOwn(props.value, key)
              ? props.value[key]
              : props.inherited?.[key];
          return (
            <Show
              when={schema.type === 'object' || schema.type === 'array'}
              fallback={
                <div class="field">
                  <label class="field">
                    {key === 'height' && props.parent === 'walls'
                      ? 'Wall height'
                      : key === 'height' && props.parent === 'path-surface'
                        ? 'Surface height'
                        : key === 'height' && props.parent === 'finishes'
                          ? 'Finish height'
                          : key === 'elevation' &&
                              props.parent === 'path-members'
                            ? 'Start elevation'
                            : key === 'elevation' &&
                                props.parent === 'path-surface'
                              ? 'Bottom elevation'
                              : title(key)}
                    {schema.type === 'number' ? suffix(key) : ''}
                    {required() ? '' : ' (optional)'}
                    <Show
                      when={schema.enum || choices(key)}
                      fallback={
                        schema.type === 'number' ? (
                          <input
                            type="number"
                            step="any"
                            value={
                              typeof value() === 'number'
                                ? Number(
                                    (
                                      (value() as number) / factor(key)
                                    ).toPrecision(12),
                                  )
                                : ''
                            }
                            onInput={(e) => {
                              set(
                                key,
                                e.currentTarget.value === ''
                                  ? undefined
                                  : e.currentTarget.valueAsNumber * factor(key),
                              );
                            }}
                          />
                        ) : (
                          <input
                            value={scalarText(value())}
                            onInput={(e) => {
                              set(
                                key,
                                e.currentTarget.value === '' && !required()
                                  ? undefined
                                  : e.currentTarget.value,
                              );
                            }}
                          />
                        )
                      }
                    >
                      <select
                        value={scalarText(value())}
                        onChange={(e) => {
                          set(key, e.currentTarget.value || undefined);
                        }}
                      >
                        <option value="">
                          {required() ? 'Choose…' : 'None'}
                        </option>
                        <For
                          each={
                            schema.enum?.map((option) => ({
                              id: String(option),
                              name: title(String(option)),
                            })) ??
                            choices(key) ??
                            []
                          }
                        >
                          {(option) => (
                            <option
                              value={option.id}
                              selected={scalarText(value()) === option.id}
                            >
                              {option.name}
                            </option>
                          )}
                        </For>
                      </select>
                    </Show>
                  </label>
                  <Show when={props.inherited}>
                    <small class="muted">
                      {Object.hasOwn(props.value, key)
                        ? 'Override'
                        : 'Inherited from group or assembly'}
                    </small>
                    <Show when={Object.hasOwn(props.value, key)}>
                      <button
                        type="button"
                        onClick={() => {
                          set(key, undefined);
                        }}
                      >
                        Reset {title(key).toLowerCase()}
                      </button>
                    </Show>
                  </Show>
                </div>
              }
            >
              <fieldset class="construction-section">
                <legend>{title(key)}</legend>
                <Show
                  when={value() !== undefined || required()}
                  fallback={
                    <button
                      type="button"
                      onClick={() => {
                        set(key, seed(schema, key));
                      }}
                    >
                      Add {title(key).toLowerCase()}
                    </button>
                  }
                >
                  <Show
                    when={schema.type === 'object'}
                    fallback={
                      <>
                        <For
                          each={
                            Array.isArray(value()) ? (value() as unknown[]) : []
                          }
                          keyed={false}
                        >
                          {(item, index) => (
                            <div class="construction-array-item">
                              <ConstructionFields
                                schema={schema.items ?? {}}
                                value={record(item())}
                                unit={props.unit}
                                controller={props.controller}
                                parent={key}
                                onChange={(next) => {
                                  set(
                                    key,
                                    (value() as unknown[]).map((entry, i) =>
                                      i === index ? next : entry,
                                    ),
                                  );
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  set(
                                    key,
                                    (value() as unknown[]).filter(
                                      (_, i) => i !== index,
                                    ),
                                  );
                                }}
                              >
                                Remove {title(key).toLowerCase()} item
                              </button>
                            </div>
                          )}
                        </For>
                        <button
                          type="button"
                          onClick={() => {
                            set(key, [
                              ...(Array.isArray(value())
                                ? (value() as unknown[])
                                : []),
                              seed(schema.items ?? {}),
                            ]);
                          }}
                        >
                          Add {title(key).toLowerCase()} item
                        </button>
                      </>
                    }
                  >
                    <ConstructionFields
                      schema={schema}
                      value={record(props.value[key])}
                      inherited={
                        props.inherited && props.value[key] !== null
                          ? record(props.inherited[key])
                          : undefined
                      }
                      controller={props.controller}
                      unit={props.unit}
                      parent={key}
                      onChange={(next) => {
                        set(key, next);
                      }}
                    />
                  </Show>
                  <Show when={!required()}>
                    <button
                      type="button"
                      onClick={() => {
                        set(key, undefined);
                      }}
                    >
                      {props.inherited ? 'Reset' : 'Clear'}{' '}
                      {title(key).toLowerCase()}
                    </button>
                  </Show>
                </Show>
              </fieldset>
            </Show>
          );
        }}
      </For>
    </div>
  );
}

export default function ConstructionEditor(props: {
  controller: WorkspaceController;
  onClose: () => void;
  onError: (message: string) => void;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const [kind, setKind] = createSignal<Kind>('walls');
  const [draft, setDraft] = createSignal<Record<string, unknown> | null>(null);
  const [dirty, setDirty] = createSignal(false);
  const [unit, setUnit] = createSignal<'ft' | 'm'>('ft');
  const [filter, setFilter] = createSignal('');
  const [templateName, setTemplateName] = createSignal('Wall template');
  const [templateId, setTemplateId] = createSignal('');
  const [headerTemplateId, setHeaderTemplateId] = createSignal('');
  const [error, setError] = createSignal('');
  const [backupPath, setBackupPath] = createSignal('');
  const [preview, setPreview] = createSignal<unknown>(null);
  const [tab, setTab] = createSignal<'edit' | 'schedule'>('edit');
  let expected: Observation | undefined;
  const data = createMemo(() => {
    const project = props.controller.project();
    return project ? resolveConstruction(project) : emptyConstruction();
  });
  const headerAssemblies = createMemo(() =>
    Object.values(props.controller.project()?.recipes ?? {}).filter(
      (recipe) =>
        recipe.materialTemplate?.kind === 'path-members' &&
        !!recipe.materialTemplate.components?.length &&
        recipe.materialTemplate.components.every((component) =>
          component.role.startsWith('header'),
        ),
    ),
  );
  const records = createMemo(() =>
    Object.entries(
      data()[kind()] as Record<
        string,
        { id: string; name?: string; geometryId?: string }
      >,
    ),
  );
  const entries = createMemo(() =>
    records().filter(([id, item]) =>
      `${id} ${'name' in item ? (item.name ?? '') : ''} ${'geometryId' in item ? (props.controller.project()?.geometries[item.geometryId ?? '']?.name ?? '') : ''}`
        .toLowerCase()
        .includes(filter().toLowerCase()),
    ),
  );
  const pieces = createMemo(() => {
    const selected = new Set(props.controller.selection());
    return (
      props.controller
        .construction()
        ?.pieces.filter(
          (piece) => !selected.size || selected.has(piece.geometryId ?? ''),
        ) ?? []
    );
  });
  createEffect(
    () => ({ dirty: dirty(), notify: props.onDraftChange }),
    (value) => {
      value.notify?.(value.dirty);
    },
  );
  function run(operation: () => Promise<unknown>) {
    const report = props.onError;
    setError('');
    void operation().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      report(message);
    });
  }
  function begin(value?: unknown) {
    const current = props.controller.project();
    if (!current) return;
    expected = props.controller.observe();
    setPreview(null);
    const member = {
      materialId: '',
      width: 0.041275,
      depth: 0.092075,
      stockLength: 3.6576,
    };
    const selected = props.controller
      .selection()
      .map((id) => current.geometries[id]);
    const id = crypto.randomUUID();
    let initial: unknown;
    switch (kind()) {
      case 'walls':
        initial = {
          id,
          geometryId: selected.find((g) => g?.kind === 'path')?.id ?? '',
          baseElevation: 0,
          studSpacing: 0.4064,
          stud: { ...member },
          track: { ...member, width: 0.092075, depth: 0.03175, materialId: '' },
          bottomAllowance: 0,
          topAllowance: 0,
          finishes: [],
          conditions: [],
          backing: [],
        };
        break;
      case 'openings':
        initial = {
          id,
          wallId:
            Object.values(data().walls).find((w) =>
              selected.some((g) => g?.id === w.geometryId),
            )?.id ??
            Object.keys(data().walls)[0] ??
            '',
          distance: 0,
          width: 0.9144,
          sill: 0,
          height: 2.1336,
          jambCount: 1,
        };
        break;
      case 'headers':
        initial = {
          id,
          name: 'Project box header',
          reference: '',
          components: [
            {
              id: 'web-a',
              role: 'header-web',
              member: { ...member },
              startExtension: 0,
              endExtension: 0,
              verticalOffset: 0.0460375,
              faceOffset: -0.0460375,
            },
            {
              id: 'web-b',
              role: 'header-web',
              member: { ...member },
              startExtension: 0,
              endExtension: 0,
              verticalOffset: 0.0460375,
              faceOffset: 0.0460375,
            },
            {
              id: 'closure',
              role: 'header-closure',
              member: { ...member, materialId: '' },
              startExtension: 0,
              endExtension: 0,
              verticalOffset: 0.0206375,
              faceOffset: 0,
              sectionRotation: Math.PI / 2,
            },
          ],
        };
        break;
      case 'ceilings':
        initial = {
          id,
          geometryId: selected.find((g) => g?.kind === 'area')?.id ?? '',
          elevation: 2.7432,
          materialId: '',
          layers: 1,
        };
        break;
      case 'levels':
        initial = { id, name: 'Level', elevation: 0 };
        break;
      case 'placements':
        initial = {
          id,
          sheetId: props.controller.activeSheetId() ?? '',
          pageOrigin: { x: 0, y: 0 },
          worldOffset: { x: 0, y: 0, z: 0 },
          rotation: 0,
        };
        break;
    }
    const fields = constructionSchemas[kind()].properties ?? {};
    setDraft(
      Object.fromEntries(
        Object.entries(
          structuredClone(value ?? initial) as Record<string, unknown>,
        ).filter(([key]) => Object.hasOwn(fields, key)),
      ),
    );
    setDirty(!value);
  }
  const command = () =>
    `${kinds.find((item) => item.kind === kind())?.command ?? 'wall'}.put`;
  async function save() {
    if (!draft()) return;
    await props.controller.execute(
      { name: command(), payload: draft() },
      expected,
    );
    expected = props.controller.observe();
    setDirty(false);
    setPreview(null);
  }
  return (
    <div class="stack">
      <div class="panel-heading">
        <div>
          <h2>Construction</h2>
          <p>
            Dimensions and project details drive the pieces, materials, and 3D
            view.
          </p>
        </div>
        <button
          type="button"
          disabled={dirty() || props.controller.busy()}
          onClick={() => {
            props.onClose();
          }}
        >
          Close
        </button>
      </div>
      <Show when={error()}>
        <p role="alert" class="error-banner">
          {error()}
        </p>
      </Show>
      <div class="button-row">
        <Show when={props.controller.native}>
          <button
            type="button"
            disabled={dirty() || props.controller.busy()}
            onClick={() => {
              run(async () => {
                const result = await props.controller.execute({
                  name: 'project.backup',
                });
                setBackupPath(scalarText(record(result).path));
              });
            }}
          >
            Save recovery copy
          </button>
        </Show>
        <button type="button" disabled={dirty()} onClick={() => setTab('edit')}>
          Construction records
        </button>
        <button
          type="button"
          disabled={dirty()}
          onClick={() => setTab('schedule')}
        >
          Piece schedule
        </button>
        <label class="field">
          Display lengths
          <select
            value={unit()}
            onChange={(e) => setUnit(e.currentTarget.value as 'm' | 'ft')}
          >
            <option value="ft">Feet (decimal)</option>
            <option value="m">Metres</option>
          </select>
        </label>
      </div>
      <Show when={backupPath()}>
        <p role="status">Recovery copy saved: {backupPath()}</p>
      </Show>
      <Show when={tab() === 'edit'}>
        <div class="construction-layout">
          <nav class="construction-list" aria-label="Construction records">
            <select
              aria-label="Construction type"
              value={kind()}
              disabled={dirty()}
              onChange={(e) => {
                setKind(e.currentTarget.value as Kind);
                setDraft(null);
              }}
            >
              <For each={kinds}>
                {(item) => <option value={item.kind}>{item.label}</option>}
              </For>
            </select>
            <button
              type="button"
              disabled={dirty()}
              onClick={() => {
                begin();
              }}
            >
              New {kinds.find((item) => item.kind === kind())?.command}
            </button>
            <input
              aria-label="Filter construction records"
              type="search"
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
            />
            <For each={entries().slice(0, 200)} keyed={([id]) => id}>
              {(entry) => (
                <button
                  type="button"
                  disabled={dirty()}
                  onClick={() => {
                    begin(entry()[1]);
                  }}
                >
                  {'name' in entry()[1]
                    ? (entry()[1].name ?? '')
                    : 'geometryId' in entry()[1]
                      ? (props.controller.project()?.geometries[
                          entry()[1].geometryId ?? ''
                        ]?.name ?? entry()[0])
                      : entry()[0]}
                </button>
              )}
            </For>
          </nav>
          <div class="stack">
            <Show
              when={draft()}
              fallback={
                <p>
                  Select a record or create one from the selected drawing.
                  Heights are required before wall quantities are complete.
                </p>
              }
            >
              {(value) => (
                <>
                  <p class="hint">
                    Member dimensions and the box-header example are editable
                    starting values. Enter the specified product, section,
                    stock, and detail dimensions. An omitted wall height remains
                    unresolved.
                  </p>
                  <Show when={kind() === 'headers'}>
                    <fieldset class="construction-section">
                      <legend>Header assemblies</legend>
                      <p class="hint">
                        Copy an assembly's components into this project header
                        detail, then save it and select it on an opening. The
                        opening positions the components. This copy has its own
                        editable dimensions.
                      </p>
                      <label class="field">
                        Header assembly
                        <select
                          value={headerTemplateId()}
                          onChange={(event) => {
                            setHeaderTemplateId(event.currentTarget.value);
                          }}
                        >
                          <option value="">
                            Choose project header assembly
                          </option>
                          <For each={headerAssemblies()}>
                            {(assembly) => (
                              <option value={assembly.id}>
                                {assembly.name}
                              </option>
                            )}
                          </For>
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={
                          !headerAssemblies().some(
                            (assembly) => assembly.id === headerTemplateId(),
                          ) || props.controller.busy()
                        }
                        onClick={() => {
                          const assembly = headerAssemblies().find(
                            (item) => item.id === headerTemplateId(),
                          );
                          if (!assembly?.materialTemplate?.components) return;
                          const components = structuredClone(
                            assembly.materialTemplate.components,
                          );
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  name: assembly.name,
                                  reference: assembly.reference ?? '',
                                  components,
                                }
                              : current,
                          );
                          setDirty(true);
                          setPreview(null);
                        }}
                      >
                        Use header assembly
                      </button>
                    </fieldset>
                  </Show>
                  <Show when={kind() === 'walls'}>
                    <fieldset class="construction-section">
                      <legend>Wall templates</legend>
                      <p class="hint">
                        Walls follow their project assembly. Editing that
                        assembly updates its walls. Changes made here override
                        only this wall; its openings stay at their entered
                        locations.
                      </p>
                      <label class="field">
                        Template name
                        <input
                          value={templateName()}
                          onInput={(e) =>
                            setTemplateName(e.currentTarget.value)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        disabled={
                          dirty() ||
                          props.controller.busy() ||
                          !data().walls[String(value().id)]
                        }
                        onClick={() => {
                          run(async () => {
                            const wall = data().walls[String(value().id)];
                            if (!wall) return;
                            await props.controller.saveRecipe(
                              {
                                id: crypto.randomUUID(),
                                name: templateName(),
                                geometryKinds: ['path'],
                                inputs: [],
                                outputs: [],
                                wallTemplate: wallTemplateFromWall(wall),
                              },
                              expected,
                            );
                            expected = props.controller.observe();
                          });
                        }}
                      >
                        Save as project template
                      </button>
                      <p class="hint">
                        Save construction first. Use Assemblies to edit the
                        template or save a copy to the global library.
                      </p>
                      <label class="field">
                        Use template
                        <select
                          value={templateId()}
                          onChange={(e) => setTemplateId(e.currentTarget.value)}
                        >
                          <option value="">Choose project wall template</option>
                          <For
                            each={Object.values(
                              props.controller.project()?.recipes ?? {},
                            ).filter((recipe) => recipe.wallTemplate)}
                          >
                            {(recipe) => (
                              <option value={recipe.id}>{recipe.name}</option>
                            )}
                          </For>
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={
                          !templateId() ||
                          !value().geometryId ||
                          props.controller.busy()
                        }
                        onClick={() => {
                          run(async () => {
                            await props.controller.execute(
                              {
                                name: 'wall.fromAssembly',
                                payload: {
                                  assemblyId: templateId(),
                                  id: value().id,
                                  geometryId: value().geometryId,
                                },
                              },
                              expected,
                            );
                            const project = props.controller.project();
                            if (project)
                              begin(
                                resolveConstruction(project).walls[
                                  String(value().id)
                                ],
                              );
                          });
                        }}
                      >
                        Use assembly for this wall
                      </button>
                    </fieldset>
                  </Show>
                  <ConstructionFields
                    schema={constructionSchemas[kind()]}
                    value={value()}
                    unit={unit()}
                    controller={props.controller}
                    parent={kind()}
                    hide={['id']}
                    onChange={(next) => {
                      setDraft(next);
                      setDirty(true);
                      setPreview(null);
                    }}
                  />
                  <div class="button-row">
                    <Show when={kind() === 'walls' || kind() === 'ceilings'}>
                      <button
                        type="button"
                        disabled={
                          dirty() ||
                          props.controller.busy() ||
                          !data()[kind()][String(value().id)]
                        }
                        onClick={() => {
                          run(async () => {
                            await props.controller.execute(
                              {
                                name:
                                  kind() === 'walls'
                                    ? 'wall.reset'
                                    : 'ceiling.reset',
                                payload: { id: value().id },
                              },
                              expected,
                            );
                            const project = props.controller.project();
                            if (project)
                              begin(
                                resolveConstruction(project)[kind()][
                                  String(value().id)
                                ],
                              );
                          });
                        }}
                      >
                        Reset local overrides
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="primary"
                      disabled={props.controller.busy()}
                      onClick={() => {
                        run(save);
                      }}
                    >
                      Save construction
                    </button>
                    <button
                      type="button"
                      disabled={props.controller.busy()}
                      onClick={() => {
                        run(async () =>
                          setPreview(
                            await props.controller.execute(
                              {
                                name: 'preview',
                                payload: {
                                  commands: [
                                    { name: command(), payload: value() },
                                    { name: 'construction.inspect' },
                                  ],
                                },
                              },
                              expected,
                            ),
                          ),
                        );
                      }}
                    >
                      Preview quantities
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(null);
                        setDirty(false);
                        setPreview(null);
                      }}
                    >
                      Cancel edits
                    </button>
                    <button
                      type="button"
                      disabled={dirty() || !data()[kind()][String(value().id)]}
                      onClick={() => {
                        run(async () => {
                          await props.controller.execute(
                            {
                              name: `${kinds.find((item) => item.kind === kind())?.command ?? 'wall'}.delete`,
                              payload: { id: value().id },
                            },
                            expected,
                          );
                          setDraft(null);
                        });
                      }}
                    >
                      Delete record
                    </button>
                  </div>
                  <Show when={preview()}>
                    <p role="status">
                      Preview calculated without saving. Review the material
                      changes below before saving.
                    </p>
                    <div class="quantity-preview">
                      <table>
                        <caption>Material changes</caption>
                        <thead>
                          <tr>
                            <th>Material</th>
                            <th>Before</th>
                            <th>After</th>
                            <th>Change</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For
                            each={
                              (record(preview()).quantityChanges as
                                Record<string, unknown>[] | undefined) ?? []
                            }
                          >
                            {(change) => (
                              <tr>
                                <td>{scalarText(change.materialId)}</td>
                                <td>
                                  {Number(change.before).toLocaleString(
                                    undefined,
                                    { maximumFractionDigits: 3 },
                                  )}{' '}
                                  {scalarText(change.unit)}
                                </td>
                                <td>
                                  {Number(change.after).toLocaleString(
                                    undefined,
                                    { maximumFractionDigits: 3 },
                                  )}{' '}
                                  {scalarText(change.unit)}
                                </td>
                                <td>
                                  {Number(change.delta) > 0 ? '+' : ''}
                                  {Number(change.delta).toLocaleString(
                                    undefined,
                                    { maximumFractionDigits: 3 },
                                  )}{' '}
                                  {scalarText(change.unit)}
                                </td>
                                <td>
                                  {change.complete
                                    ? 'Calculated'
                                    : 'Incomplete'}
                                </td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                      <Show
                        when={
                          !(
                            record(preview()).quantityChanges as
                              unknown[] | undefined
                          )?.length
                        }
                      >
                        <p>No material quantity changes.</p>
                      </Show>
                    </div>
                  </Show>
                </>
              )}
            </Show>
          </div>
        </div>
      </Show>
      <Show when={tab() === 'schedule'}>
        <div class="button-row">
          <For each={['pieces', 'lengths', 'materials'] as const}>
            {(schedule) => (
              <button
                type="button"
                onClick={() => {
                  run(() =>
                    props.controller.exportConstruction('csv', schedule),
                  );
                }}
              >
                Export {schedule} CSV
              </button>
            )}
          </For>
          <button
            type="button"
            onClick={() => {
              run(() => props.controller.exportConstruction('json', 'pieces'));
            }}
          >
            Export full JSON
          </button>
        </div>
        <p>
          {pieces().length} positioned pieces
          {props.controller.selection().length ? ' in selected drawing' : ''}.
          Purchasing waste is separate.
        </p>
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>Material / role</th>
              <th>Cut length</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            <For each={pieces().slice(0, 300)}>
              {(piece) => (
                <tr>
                  <td>
                    {props.controller.project()?.geometries[
                      piece.geometryId ?? ''
                    ]?.name ?? piece.wallId}
                  </td>
                  <td>
                    {piece.materialId} / {piece.role}
                  </td>
                  <td>
                    {displayLength({ value: piece.cutLength, unit: 'm' })}
                  </td>
                  <td>
                    {piece.stockLength
                      ? displayLength({ value: piece.stockLength, unit: 'm' })
                      : 'Unspecified'}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={pieces().length > 300}>
          <p>
            Showing the first 300 pieces. Select a wall to narrow the schedule;
            exports include every piece.
          </p>
        </Show>
        <For each={props.controller.construction()?.diagnostics ?? []}>
          {(diagnostic) => <p class="warning">{diagnostic.message}</p>}
        </For>
      </Show>
    </div>
  );
}
