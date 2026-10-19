/**
 * Unidades de medida e conversão. Só convertemos dentro da mesma dimensão
 * (massa, volume, contagem). Unidades incompatíveis nunca são convertidas.
 */

export type MeasureUnit = 'mg' | 'g' | 'kg' | 'ml' | 'l' | 'un' | 'dz';
export type Dimension = 'mass' | 'volume' | 'count';

export const MEASURE_UNITS: Array<{ value: MeasureUnit; label: string; dimension: Dimension }> = [
  { value: 'g', label: 'g (grama)', dimension: 'mass' },
  { value: 'kg', label: 'kg (quilo)', dimension: 'mass' },
  { value: 'mg', label: 'mg (miligrama)', dimension: 'mass' },
  { value: 'ml', label: 'ml (mililitro)', dimension: 'volume' },
  { value: 'l', label: 'l (litro)', dimension: 'volume' },
  { value: 'un', label: 'un (unidade)', dimension: 'count' },
  { value: 'dz', label: 'dz (dúzia)', dimension: 'count' },
];

/** Fator para a unidade-base da dimensão, como fração exata [numerador, denominador]. */
const FACTORS: Record<MeasureUnit, [bigint, bigint]> = {
  mg: [1n, 1000n],
  g: [1n, 1n],
  kg: [1000n, 1n],
  ml: [1n, 1n],
  l: [1000n, 1n],
  un: [1n, 1n],
  dz: [12n, 1n],
};

const DIMENSIONS: Record<MeasureUnit, Dimension> = {
  mg: 'mass',
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  l: 'volume',
  un: 'count',
  dz: 'count',
};

export const BASE_UNIT: Record<Dimension, MeasureUnit> = { mass: 'g', volume: 'ml', count: 'un' };

export function isMeasureUnit(value: string): value is MeasureUnit {
  return value in DIMENSIONS;
}

export function dimensionOf(unit: MeasureUnit): Dimension {
  return DIMENSIONS[unit];
}

export function areCompatible(a: MeasureUnit, b: MeasureUnit): boolean {
  return DIMENSIONS[a] === DIMENSIONS[b];
}

export function unitFactor(unit: MeasureUnit): [bigint, bigint] {
  return FACTORS[unit];
}

export class IncompatibleUnitsError extends Error {
  constructor(from: MeasureUnit, to: MeasureUnit) {
    super(`Unidades incompatíveis: ${from} não pode ser convertido em ${to}.`);
    this.name = 'IncompatibleUnitsError';
  }
}

/** Converte uma quantidade entre unidades compatíveis. */
export function convert(quantity: number, from: MeasureUnit, to: MeasureUnit): number {
  if (!areCompatible(from, to)) throw new IncompatibleUnitsError(from, to);
  const [fn, fd] = FACTORS[from];
  const [tn, td] = FACTORS[to];
  return (quantity * Number(fn) * Number(td)) / (Number(fd) * Number(tn));
}
