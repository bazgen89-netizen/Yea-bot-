import {
  clampSplit,
  columnsFor,
  preferredTileWidth,
  tileColumns,
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

describe('плитки витрины', () => {
  it('размер плитки задаёт окно, а не витрина', () => {
    // Ширина окна не менялась — значит, и желаемая ширина плитки та же,
    // сколько бы места ни осталось витрине.
    expect(preferredTileWidth(1600)).toBe(preferredTileWidth(1600));
    expect(preferredTileWidth(1600)).toBeGreaterThan(preferredTileWidth(1200));
  });

  it('витрина шире — плиток в ряду больше', () => {
    const narrow = columnsFor(1600, 700);
    const wide = columnsFor(1600, 1200);
    expect(wide).toBeGreaterThan(narrow);
  });

  it('ряд заполнен целиком, без полей по краям', () => {
    // Ширина плитки — доля ряда, и доли всегда складываются в сто процентов.
    for (let width = 400; width <= 2000; width += 13) {
      const columns = columnsFor(1600, width);
      expect(columns * (100 / columns)).toBeCloseTo(100, 9);
      expect(columns).toBeGreaterThanOrEqual(1);
    }
  });

  it('плитка при этом почти не меняется в размере', () => {
    const wanted = preferredTileWidth(1600);
    let previous = 0;

    for (let width = Math.ceil(MIN_CATALOG_CM * PX_IN_CM); width <= 1600; width += 10) {
      const columns = columnsFor(1600, width);
      // Отклонение — не больше половины столбца, то есть меньше десятой доли.
      expect(Math.abs(width / columns - wanted) / wanted).toBeLessThan(0.1);
      // Витрина шире — плиток не меньше, чем было.
      expect(columns).toBeGreaterThanOrEqual(previous);
      previous = columns;
    }
  });

  it('без витрины отвечает по их таблице окна', () => {
    expect(columnsFor(1440, 0)).toBe(tileColumns(1440));
  });
});
