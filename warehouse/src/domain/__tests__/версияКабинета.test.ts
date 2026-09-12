import {
  версияКабинета,
  другаяВерсия,
  подписьПерехода,
  переключитьВерсию,
  ссылкаНаВерсию,
  темаКабинета,
  переключитьТему,
} from '../../ui/версияКабинета';

/**
 * Переключение версий кабинета.
 *
 * Вазген: «сделай так, чтобы был выбор переключиться на новую версию, и в
 * новой версии переключиться на старую». Так у CloudShop: у них сейчас два
 * кабинета сразу, и ходят между ними из бокового меню.
 *
 * Подписи не сочинены — они из их файла переводов
 * `translator.cloudshop.ru/WAPP/ru.json`: `NEW_VERSION_MENU` и
 * `WEBAPP_RETURN_TO_OLD_VERSION`.
 */
describe('какой кабинет показывать', () => {
  const было = (globalThis as { localStorage?: Storage }).localStorage;
  let склад: Record<string, string>;

  beforeEach(() => {
    склад = {};
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (ключ: string) => склад[ключ] ?? null,
        setItem: (ключ: string, знач: string) => {
          склад[ключ] = знач;
        },
        removeItem: (ключ: string) => {
          delete склад[ключ];
        },
        clear: () => {
          склад = {};
        },
        key: () => null,
        length: 0,
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: было });
  });

  it('по умолчанию прежний — тот, что он утверждал экран за экраном', () => {
    expect(версияКабинета()).toBe('старая');
    expect(другаяВерсия()).toBe('новая');
    expect(подписьПерехода()).toBe('Перейти на новую версию');
  });

  it('из прежнего переключается в новый, и подпись становится обратной', () => {
    // Перезагрузки в тестах нет, но выбор должен записаться.
    переключитьВерсию();

    expect(версияКабинета()).toBe('новая');
    expect(другаяВерсия()).toBe('старая');
    expect(подписьПерехода()).toBe('Вернуться к старой версии');
  });

  it('и обратно — из нового в прежний', () => {
    переключитьВерсию('новая');
    переключитьВерсию('старая');

    expect(версияКабинета()).toBe('старая');
    expect(подписьПерехода()).toBe('Перейти на новую версию');
  });

  it('выбор переживает перезагрузку: он в хранилище, а не в памяти экрана', () => {
    переключитьВерсию('новая');
    // Ровно то, что прочитает страница при следующем открытии.
    expect(склад['wayshop:версия-кабинета']).toBe('новая');
  });

  it('чужое значение в хранилище не сбивает с толку', () => {
    склад['wayshop:версия-кабинета'] = 'какая-то';
    expect(версияКабинета()).toBe('старая');
  });
});

describe('версия прямо в адресе', () => {
  const былоХранилище = (globalThis as { localStorage?: Storage }).localStorage;
  const былАдрес = (globalThis as { location?: Location }).location;
  let склад: Record<string, string>;

  const адрес = (строка: string) =>
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { search: строка.split('#')[0], hash: строка.includes('#') ? `#${строка.split('#')[1]}` : '' },
    });

  beforeEach(() => {
    склад = {};
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (к: string) => склад[к] ?? null,
        setItem: (к: string, з: string) => {
          склад[к] = з;
        },
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: былоХранилище });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: былАдрес });
  });

  it('по-русски и по-латыни — одинаково', () => {
    // Вазген не нашёл пункт в меню: на невысоком экране нижние строки уходят
    // под сгиб. Ссылка находится всегда.
    for (const хвост of ['?версия=новая', '?v=new', '?version=NEW', '#v=new']) {
      адрес(хвост);
      expect(версияКабинета()).toBe('новая');
    }
  });

  it('и обратно, к прежнему виду', () => {
    склад['wayshop:версия-кабинета'] = 'новая';
    адрес('?v=old');
    expect(версияКабинета()).toBe('старая');
  });

  it('адрес важнее запомненного и сам запоминается', () => {
    склад['wayshop:версия-кабинета'] = 'старая';
    адрес('?v=new');

    expect(версияКабинета()).toBe('новая');
    // Чтобы второй раз ссылка не понадобилась.
    expect(склад['wayshop:версия-кабинета']).toBe('новая');
  });

  it('чужой хвост в адресе ничего не меняет', () => {
    склад['wayshop:версия-кабинета'] = 'новая';
    адрес('?utm_source=telegram&page=2');
    expect(версияКабинета()).toBe('новая');
  });

  it('ссылка собирается правильно', () => {
    expect(ссылкаНаВерсию('https://waystea.ru/sklad/', 'новая')).toBe(
      'https://waystea.ru/sklad/?v=new',
    );
    expect(ссылкаНаВерсию('https://waystea.ru/sklad/?a=1', 'старая')).toBe(
      'https://waystea.ru/sklad/?a=1&v=old',
    );
  });
});

describe('тёмный вид', () => {
  const былоХранилище = (globalThis as { localStorage?: Storage }).localStorage;
  const былАдрес = (globalThis as { location?: Location }).location;
  let склад: Record<string, string>;

  const адрес = (строка: string) =>
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      // `reload` здесь пустышка: в тестах страницу перечитывать нечем, а
      // проверяем мы то, что записалось, — с этого и начнётся новая загрузка.
      value: { search: строка, hash: '', reload: () => undefined },
    });

  beforeEach(() => {
    склад = {};
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (к: string) => склад[к] ?? null,
        setItem: (к: string, з: string) => {
          склад[к] = з;
        },
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      },
    });
    адрес('');
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: былоХранилище });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: былАдрес });
  });

  it('в прежнем кабинете тёмного вида нет вовсе — как и у них', () => {
    склад['wayshop:версия-кабинета'] = 'старая';
    склад['wayshop:тема-кабинета'] = 'тёмная';

    expect(темаКабинета()).toBe('светлая');
  });

  it('в новом — включается и запоминается', () => {
    склад['wayshop:версия-кабинета'] = 'новая';
    expect(темаКабинета()).toBe('светлая');

    переключитьТему();
    expect(темаКабинета()).toBe('тёмная');

    переключитьТему();
    expect(темаКабинета()).toBe('светлая');
  });

  it('задаётся и ссылкой', () => {
    склад['wayshop:версия-кабинета'] = 'новая';
    for (const хвост of ['?t=dark', '?тема=тёмная', '?theme=DARK']) {
      адрес(хвост);
      expect(темаКабинета()).toBe('тёмная');
    }

    адрес('?t=light');
    expect(темаКабинета()).toBe('светлая');
  });

  it('ссылка сразу и на новый вид, и на тёмный', () => {
    адрес('?v=new&t=dark');
    expect(версияКабинета()).toBe('новая');
    expect(темаКабинета()).toBe('тёмная');
  });
});

describe('когда хранилища нет вовсе', () => {
  const было = (globalThis as { localStorage?: Storage }).localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: было });
  });

  it('показываем прежний и не перезагружаем страницу впустую', () => {
    // На телефоне и в окне без доступа к данным сайта запомнить выбор нечем.
    // Перезагрузка тогда вернула бы тот же вид, и кнопка выглядела бы сломанной.
    expect(версияКабинета()).toBe('старая');
    expect(переключитьВерсию('новая')).toBe(false);
  });
});
