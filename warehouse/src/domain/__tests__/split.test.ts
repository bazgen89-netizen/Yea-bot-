import {
  clampSplit,
  MIN_CATALOG_CM,
  MIN_RECEIPT_CM,
  PX_IN_CM,
} from '../split';

/** Ширина, которую делят витрина и чек, при окне в 1600 точек. */
const WIDE = 1600 - 11;

describe('пределы разделительной полосы', () => {
  it('вправо до упора — чеку остаётся 8 см', () => {
    const split = clampSplit(0.99, WIDE);
    const receipt = WIDE * (1 - split);
    expect(receipt / PX_IN_CM).toBeCloseTo(MIN_RECEIPT_CM, 5);
  });

  it('влево до упора — витрине остаётся 18 см', () => {
    const split = clampSplit(0.01, WIDE);
    const catalog = WIDE * split;
    expect(catalog / PX_IN_CM).toBeCloseTo(MIN_CATALOG_CM, 5);
  });

  it('внутри пределов ничего не трогает', () => {
    expect(clampSplit(0.6, WIDE)).toBe(0.6);
  });

  it('в узком окне ужимает оба предела в одинаковой доле', () => {
    // Оба предела вместе — 26 см; окно вдвое уже.
    const narrow = ((MIN_CATALOG_CM + MIN_RECEIPT_CM) * PX_IN_CM) / 2;

    const left = clampSplit(0, narrow);
    const right = clampSplit(1, narrow);

    // Витрина и чек делят окно в том же отношении, 18 к 8.
    expect(left).toBeCloseTo(MIN_CATALOG_CM / (MIN_CATALOG_CM + MIN_RECEIPT_CM), 5);
    expect(right).toBeCloseTo(left, 5);
  });

  it('без ширины ничего не решает', () => {
    expect(clampSplit(0.6, 0)).toBe(0.6);
  });
});
