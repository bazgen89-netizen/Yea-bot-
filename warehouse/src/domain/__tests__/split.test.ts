import {
  clampSplit,
  columnsFor,
  gridPadding,
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

  it('размер плитки не меняется ни при какой ширине витрины', () => {
    // Ширина плитки — одно и то же число: она зависит только от окна.
    // Меняется лишь то, сколько их влезло.
    const wanted = preferredTileWidth(1600);
    let previous = 0;

    for (let width = Math.ceil(MIN_CATALOG_CM * PX_IN_CM); width <= 1600; width += 10) {
      const columns = columnsFor(1600, width);
      // Плитки целиком помещаются, и лишней не влезает.
      expect(columns * wanted).toBeLessThanOrEqual(width + 0.001);
      expect((columns + 1) * wanted).toBeGreaterThan(width);
      // Витрина шире — плиток не меньше, чем было.
      expect(columns).toBeGreaterThanOrEqual(previous);
      previous = columns;
    }
  });

  it('остаток ряда уходит в равные поля по краям', () => {
    const wanted = preferredTileWidth(1600);

    for (let width = 700; width <= 1600; width += 13) {
      const columns = columnsFor(1600, width);
      const edge = gridPadding(1600, width);
      // Поля плюс плитки — ровно ширина витрины.
      expect(2 * edge + columns * wanted).toBeCloseTo(width, 6);
      // И поле меньше половины плитки: иначе туда влезла бы ещё одна.
      expect(edge).toBeLessThan(wanted / 2 + 0.001);
    }
  });

  it('без витрины отвечает по их таблице окна', () => {
    expect(columnsFor(1440, 0)).toBe(tileColumns(1440));
  });
});
