import type {
  AssemblyComponent,
  Recipe,
  RecipeInput,
  RecipeOutput,
} from './types';
import { formulaOutput, formulaQuantity } from './formula';

/** Escaping each segment keeps arbitrary component/output ids unambiguous. */
export function componentOutputId(
  componentId: string,
  outputId: string,
): string {
  return `${encodeURIComponent(componentId)}/${encodeURIComponent(outputId)}`;
}

export function validateSystem(recipe: Recipe): void {
  if (!recipe.components) return;
  if (!recipe.components.length || recipe.outputs.length)
    throw new Error('Systems need components and no direct outputs');
  const ids = new Set<string>();
  for (const component of recipe.components) {
    if (!component.id || ids.has(component.id))
      throw new Error('System component ids must be nonempty and unique');
    ids.add(component.id);
    if (component.assembly.components !== undefined)
      throw new Error(
        'Each component must contain an assembly; nested systems are unsupported',
      );
    if (!component.assembly.outputs.length)
      throw new Error(`Component ${component.id} needs outputs`);
    if (
      !recipe.geometryKinds.every((kind) =>
        component.assembly.geometryKinds.includes(kind),
      )
    )
      throw new Error(
        `Component ${component.id} does not support the system geometry`,
      );
    for (const [name, sharedName] of Object.entries(component.bindings)) {
      const input = component.assembly.inputs.find(
        (entry) => entry.name === name,
      );
      const shared = recipe.inputs.find((entry) => entry.name === sharedName);
      if (!input || !shared || input.type !== shared.type)
        throw new Error(`Invalid component binding: ${component.id}.${name}`);
      if (
        input.type === 'number' &&
        formulaQuantity({ value: 1, unit: input.unit }).dimension !==
          formulaQuantity({ value: 1, unit: shared.unit }).dimension
      )
        throw new Error(
          `Incompatible component input units: ${component.id}.${name}`,
        );
    }
  }
}

/** Make an independent bundle; persist through assembly.put for full validation. */
export function createSystemAssembly(options: {
  id: string;
  name: string;
  inputs: RecipeInput[];
  components: AssemblyComponent[];
}): Recipe {
  const recipe: Recipe = structuredClone({
    ...options,
    components: options.components.map((component) =>
      structuredClone(component),
    ),
    geometryKinds:
      options.components[0]?.assembly.geometryKinds.filter((kind) =>
        options.components.every((component) =>
          component.assembly.geometryKinds.includes(kind),
        ),
      ) ?? [],
    outputs: [],
  });
  validateSystem(recipe);
  if (!recipe.geometryKinds.length)
    throw new Error('System components need compatible geometry');
  return recipe;
}

export function assemblyOutputs(
  recipe: Recipe,
): { output: RecipeOutput; component?: AssemblyComponent }[] {
  validateSystem(recipe);
  return recipe.components
    ? recipe.components.flatMap((component) =>
        component.assembly.outputs.map((output) => ({
          output: { ...output, id: componentOutputId(component.id, output.id) },
          component,
        })),
      )
    : recipe.outputs.map((output) => ({ output }));
}

export function componentInputs(
  recipe: Recipe,
  component: AssemblyComponent,
  sharedValues: Record<string, number | boolean>,
): Record<string, number | boolean> {
  return Object.fromEntries(
    component.assembly.inputs.flatMap((input) => {
      const sharedName = component.bindings[input.name];
      if (sharedName === undefined)
        return input.default === undefined ? [] : [[input.name, input.default]];
      const shared = recipe.inputs.find((entry) => entry.name === sharedName);
      const value = sharedValues[sharedName];
      if (!shared || value === undefined)
        throw new Error(`Required shared input: ${sharedName}`);
      return [
        [
          input.name,
          typeof value === 'number'
            ? formulaOutput(
                formulaQuantity({ value, unit: shared.unit }),
                input.unit,
              )
            : value,
        ],
      ];
    }),
  );
}
