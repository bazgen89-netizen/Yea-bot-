import {
  clampSplit,
  columnsFor,
  MAX_COLUMNS,
  MIN_CATALOG_CM,
  MIN_COLUMNS,
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

describe('плитки витрины', () => {
  it('от пяти в ряду слева до семи справа', () => {
    const window = 1600;
    const narrow = clampSplit(0, window) * window;
    const wide = clampSplit(1, window) * window;

    expect(columnsFor(window, narrow)).toBe(MIN_COLUMNS);
    expect(columnsFor(window, wide)).toBe(MAX_COLUMNS);
    // Между крайними положениями — шесть, то есть ряд меняется постепенно.
    expect(columnsFor(window, (narrow + wide) / 2)).toBe(6);
  });

  it('за пределы пяти и семи не выходит ни на каком экране', () => {
    for (const window of [1024, 1280, 1440, 1600, 1920, 2560, 3440]) {
      for (let width = 100; width <= window; width += 37) {
        const columns = columnsFor(window, width);
        expect(columns).toBeGreaterThanOrEqual(MIN_COLUMNS);
        expect(columns).toBeLessThanOrEqual(MAX_COLUMNS);
      }
    }
  });

  it('витрина шире — плиток в ряду не меньше', () => {
    let previous = 0;
    for (let width = 600; width <= 1500; width += 10) {
      const columns = columnsFor(1600, width);
      expect(columns).toBeGreaterThanOrEqual(previous);
      previous = columns;
    }
  });

  it('ряд заполнен целиком, без полей по краям', () => {
    // Ширина плитки — доля ряда, и доли всегда складываются в сто процентов.
    for (let width = 400; width <= 2000; width += 13) {
      const columns = columnsFor(1600, width);
      expect(columns * (100 / columns)).toBeCloseTo(100, 9);
    }
  });

  it('до первой раскладки — пять, как при границе слева', () => {
    expect(columnsFor(1440, 0)).toBe(MIN_COLUMNS);
  });
});
