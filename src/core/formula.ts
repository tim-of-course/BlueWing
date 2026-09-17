import type { Quantity, Unit } from './types';

export interface FormulaNumber {
  value: number;
  dimension: number;
}
export type FormulaValue = FormulaNumber | boolean;
type Node =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; op: string; value: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };
const units: Record<Unit, { scale: number; dimension: number }> = {
  m: { scale: 1, dimension: 1 },
  mm: { scale: 0.001, dimension: 1 },
  ft: { scale: 0.3048, dimension: 1 },
  in: { scale: 0.0254, dimension: 1 },
  m2: { scale: 1, dimension: 2 },
  ft2: { scale: 0.09290304, dimension: 2 },
  ea: { scale: 1, dimension: 0 },
  scalar: { scale: 1, dimension: 0 },
};
export function formulaQuantity(quantity: Quantity): FormulaNumber {
  return numeric(
    quantity.value * units[quantity.unit].scale,
    units[quantity.unit].dimension,
  );
}
export function formulaOutput(value: FormulaValue, unit: Unit): number {
  const result = asNumber(value);
  if (result.dimension !== units[unit].dimension)
    throw new Error(`Formula dimension does not match output unit ${unit}`);
  return result.value / units[unit].scale;
}
function numeric(value: number, dimension = 0): FormulaNumber {
  if (!Number.isFinite(value))
    throw new Error('Formula produced a nonfinite value');
  return { value, dimension };
}
function asNumber(value: FormulaValue): FormulaNumber {
  if (typeof value === 'boolean')
    throw new Error('Expected a numeric formula value');
  return value;
}
function same(left: FormulaNumber, right: FormulaNumber): void {
  if (left.dimension !== right.dimension)
    throw new Error('Formula operands have incompatible dimensions');
}
function parse(formula: string): Node {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < formula.length) {
    const rest = formula.slice(cursor);
    const match =
      /^\s+|^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_][A-Za-z0-9_]*|^(?:<=|>=|==|!=|&&|\|\||[+*/(),<>!^-])/.exec(
        rest,
      );
    if (!match)
      throw new Error(`Invalid formula token near ${rest.slice(0, 20)}`);
    const token = match[0];
    cursor += token.length;
    if (token.trim()) tokens.push(token);
  }
  let index = 0;
  const precedence: Record<string, number> = {
    '||': 1,
    '&&': 2,
    '==': 3,
    '!=': 3,
    '<': 4,
    '>': 4,
    '<=': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '^': 7,
  };
  function expression(minimum = 0): Node {
    const token = tokens[index++];
    if (!token) throw new Error('Expected formula expression');
    let left: Node;
    if (token === '-' || token === '+' || token === '!')
      left = { kind: 'unary', op: token, value: expression(7) };
    else if (token === '(') {
      left = expression();
      if (tokens[index++] !== ')')
        throw new Error('Expected closing parenthesis');
    } else if (/^(?:\d|\.)/.test(token))
      left = { kind: 'number', value: Number(token) };
    else if (/^[A-Za-z_]/.test(token)) {
      if (tokens[index] === '(') {
        index++;
        const args: Node[] = [];
        if (tokens[index] !== ')') {
          for (;;) {
            args.push(expression());
            if (tokens[index] !== ',') break;
            index++;
          }
        }
        if (tokens[index++] !== ')')
          throw new Error('Expected closing function parenthesis');
        left = { kind: 'call', name: token, args };
      } else left = { kind: 'variable', name: token };
    } else throw new Error(`Unexpected token ${token}`);
    for (;;) {
      const op = tokens[index];
      const priority = op ? precedence[op] : undefined;
      if (!op || priority === undefined || priority < minimum) break;
      index++;
      left = {
        kind: 'binary',
        op,
        left,
        right: expression(priority + (op === '^' ? 0 : 1)),
      };
    }
    return left;
  }
  const root = expression();
  if (index !== tokens.length)
    throw new Error(`Unexpected formula token ${tokens[index] ?? ''}`);
  return root;
}
export function evaluateFormula(
  formula: string,
  variables: Record<string, FormulaValue>,
): FormulaValue {
  function evaluate(node: Node): FormulaValue {
    switch (node.kind) {
      case 'number':
        return numeric(node.value);
      case 'variable': {
        if (node.name === 'true') return true;
        if (node.name === 'false') return false;
        const value = Object.hasOwn(variables, node.name)
          ? variables[node.name]
          : undefined;
        if (value === undefined)
          throw new Error(
            `Unavailable or undeclared formula value: ${node.name}`,
          );
        return value;
      }
      case 'unary': {
        const value = evaluate(node.value);
        if (node.op === '!') {
          if (typeof value !== 'boolean')
            throw new Error('Expected boolean condition');
          return !value;
        }
        const result = asNumber(value);
        return numeric(
          node.op === '-' ? -result.value : result.value,
          result.dimension,
        );
      }
      case 'binary': {
        const leftValue = evaluate(node.left);
        if (node.op === '&&' || node.op === '||') {
          if (typeof leftValue !== 'boolean')
            throw new Error('Expected boolean operands');
          if (node.op === '&&' && !leftValue) return false;
          if (node.op === '||' && leftValue) return true;
          const rightValue = evaluate(node.right);
          if (typeof rightValue !== 'boolean')
            throw new Error('Expected boolean operands');
          return rightValue;
        }
        const rightValue = evaluate(node.right);
        if (
          typeof leftValue === 'boolean' &&
          typeof rightValue === 'boolean' &&
          (node.op === '==' || node.op === '!=')
        )
          return node.op === '=='
            ? leftValue === rightValue
            : leftValue !== rightValue;
        const left = asNumber(leftValue);
        const right = asNumber(rightValue);
        if (node.op === '*')
          return numeric(
            left.value * right.value,
            left.dimension + right.dimension,
          );
        if (node.op === '/')
          return numeric(
            left.value / right.value,
            left.dimension - right.dimension,
          );
        if (node.op === '^') {
          if (right.dimension !== 0 || !Number.isInteger(right.value))
            throw new Error('Exponent must be a dimensionless integer');
          return numeric(
            left.value ** right.value,
            left.dimension * right.value,
          );
        }
        same(left, right);
        switch (node.op) {
          case '+':
            return numeric(left.value + right.value, left.dimension);
          case '-':
            return numeric(left.value - right.value, left.dimension);
          case '<':
            return left.value < right.value;
          case '>':
            return left.value > right.value;
          case '<=':
            return left.value <= right.value;
          case '>=':
            return left.value >= right.value;
          case '==':
            return left.value === right.value;
          case '!=':
            return left.value !== right.value;
          default:
            throw new Error(`Unsupported operator ${node.op}`);
        }
      }
      case 'call': {
        if (node.name === 'if') {
          const [condition, yes, no] = node.args;
          if (node.args.length !== 3 || !condition || !yes || !no)
            throw new Error('if needs condition, true value, false value');
          const conditionValue = evaluate(condition);
          if (typeof conditionValue !== 'boolean')
            throw new Error('if condition must be boolean');
          // Dimensions are checked dynamically on the selected path and at the output boundary.
          return evaluate(conditionValue ? yes : no);
        }
        const args = node.args.map((arg) => asNumber(evaluate(arg)));
        const first = args[0];
        if (!first) throw new Error(`${node.name} needs arguments`);
        if (node.name === 'min' || node.name === 'max') {
          args.forEach((arg) => {
            same(first, arg);
          });
          return numeric(
            (node.name === 'min' ? Math.min : Math.max)(
              ...args.map((arg) => arg.value),
            ),
            first.dimension,
          );
        }
        if (args.length !== 1)
          throw new Error(`${node.name} needs one argument`);
        if (node.name === 'abs')
          return numeric(Math.abs(first.value), first.dimension);
        if (first.dimension !== 0)
          throw new Error('Rounding functions require dimensionless values');
        const nearest = Math.round(first.value);
        const roundedValue =
          Math.abs(first.value - nearest) <=
          Number.EPSILON * Math.max(1, Math.abs(first.value)) * 8
            ? nearest
            : first.value;
        switch (node.name) {
          case 'ceil':
            return numeric(Math.ceil(roundedValue));
          case 'floor':
            return numeric(Math.floor(roundedValue));
          case 'round':
            return numeric(Math.round(first.value));
          default:
            throw new Error(`Unknown formula function: ${node.name}`);
        }
      }
    }
  }
  return evaluate(parse(formula));
}
