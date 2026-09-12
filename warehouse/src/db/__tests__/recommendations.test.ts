import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import { blankDoc, saveDoc } from '../docs';
import { createLocation } from '../locations';
import { createProduct } from '../products';
import {
  createRecoList,
  deleteRecoList,
  listRecoLists,
  moveRecoList,
  recommendedFor,
  setRecoItems,
  updateRecoList,
} from '../recommendations';
import { createSale } from '../sales';
import type { CartLine, Id } from '../../domain/types';

let db: SqlDriver;
let shop: Id;

beforeEach(() => {
  db = createTestDriver();
  shop = createLocation(db, 'Ереван');
});

function product(name: string): Id {
  const id = createProduct(db, {
    name,
    sku: null,
    barcode: null,
    category_id: null,
    unit: 'шт',
    cost_price: 10000,
    sale_price: 20000,
    min_qty: 0,
    photo_uri: null,
  });

  saveDoc(db, {
    ...blankDoc('purchase'),
    locationToId: shop,
    lines: [{ product_id: id, qty: 100000, price: 10000 }],
  });

  return id;
}

function line(id: Id, name: string): CartLine {
  return {
    product_id: id,
    name,
    unit: 'шт',
    qty: 1000,
    price: 20000,
    cost_price: 10000,
    stock: 100000,
  };
}

describe('списки рекомендаций', () => {
  it('«Покупают вместе» заведён с самого начала', () => {
    const lists = listRecoLists(db);
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe('Покупают вместе');
    expect(lists[0].kind).toBe('together');
    expect(lists[0].size).toBe(8);
    expect(lists[0].enabled).toBe(1);
  });

  it('заводятся, правятся, выключаются и удаляются', () => {
    const id = createRecoList(db, 'Сезонное');
    expect(listRecoLists(db)).toHaveLength(2);

    updateRecoList(db, id, { name: 'Зимнее', size: 3, enabled: false });
    const mine = listRecoLists(db).find((list) => list.id === id)!;
    expect(mine.name).toBe('Зимнее');
    expect(mine.size).toBe(3);
    expect(mine.enabled).toBe(0);

    deleteRecoList(db, id);
    expect(listRecoLists(db)).toHaveLength(1);
  });

  it('размер держится в разумных пределах', () => {
    const id = createRecoList(db, 'Свой');
    updateRecoList(db, id, { size: 0 });
    expect(listRecoLists(db).find((list) => list.id === id)!.size).toBe(1);
    updateRecoList(db, id, { size: 900 });
    expect(listRecoLists(db).find((list) => list.id === id)!.size).toBe(50);
  });

  it('меняются местами', () => {
    const second = createRecoList(db, 'Второй');
    moveRecoList(db, second, -1);
    expect(listRecoLists(db).map((list) => list.id)[0]).toBe(second);
  });
});

describe('что предложить к чеку', () => {
  it('советует то, что лежало в одном чеке с набранным', () => {
    const tea = product('Шу пуэр');
    const cup = product('Пиала');
    const nuts = product('Арахис');

    // Чай с пиалой брали дважды, чай с арахисом — один раз.
    createSale(db, { lines: [line(tea, 'Шу пуэр'), line(cup, 'Пиала')], locationId: shop });
    createSale(db, { lines: [line(tea, 'Шу пуэр'), line(cup, 'Пиала')], locationId: shop });
    createSale(db, { lines: [line(tea, 'Шу пуэр'), line(nuts, 'Арахис')], locationId: shop });

    const advice = recommendedFor(db, [tea]);
    expect(advice.map((item) => item.id)).toEqual([cup, nuts]);
  });

  it('не советует то, что уже в чеке', () => {
    const tea = product('Шу пуэр');
    const cup = product('Пиала');
    createSale(db, { lines: [line(tea, 'Шу пуэр'), line(cup, 'Пиала')], locationId: shop });

    expect(recommendedFor(db, [tea, cup])).toHaveLength(0);
  });

  it('на пустом чеке не советует ничего: не с чем сравнивать', () => {
    const tea = product('Шу пуэр');
    const cup = product('Пиала');
    createSale(db, { lines: [line(tea, 'Шу пуэр'), line(cup, 'Пиала')], locationId: shop });

    expect(recommendedFor(db, [])).toHaveLength(0);
  });

  it('выключенный список не советует ничего', () => {
    const tea = product('Шу пуэр');
    const cup = product('Пиала');
    createSale(db, { lines: [line(tea, 'Шу пуэр'), line(cup, 'Пиала')], locationId: shop });

    updateRecoList(db, listRecoLists(db)[0].id, { enabled: false });
    expect(recommendedFor(db, [tea])).toHaveLength(0);
  });

  it('свой список показывает отобранное руками, без всяких чеков', () => {
    const tea = product('Шу пуэр');
    const cup = product('Пиала');
    const nuts = product('Арахис');

    updateRecoList(db, listRecoLists(db)[0].id, { enabled: false });
    const mine = createRecoList(db, 'Новинки');
    setRecoItems(db, mine, [cup, nuts]);

    // Чеков нет вовсе, но к набранному чаю список своё показывает.
    expect(recommendedFor(db, [tea]).map((item) => item.id)).toEqual([cup, nuts]);
  });

  it('не показывает больше, чем просили', () => {
    const tea = product('Шу пуэр');
    const others = [product('Пиала'), product('Арахис'), product('Печенье')];
    for (const other of others) {
      createSale(db, { lines: [line(tea, 'Шу пуэр'), line(other, 'Х')], locationId: shop });
    }

    updateRecoList(db, listRecoLists(db)[0].id, { size: 2 });
    expect(recommendedFor(db, [tea])).toHaveLength(2);
  });
});
