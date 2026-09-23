import { Platform } from 'react-native';

/**
 * Выбор фотографии товара с компьютера.
 *
 * Раньше рамка «Изображение» в карточке была нарисованной: под ней стояла
 * подпись «добавляется с телефона», нажатие не делало ничего, и завести
 * картинку из кабинета было нельзя вовсе.
 *
 * Картинка **уменьшается перед сохранением**. Снимок с телефона — это три-пять
 * мегабайт; в базе он лёг бы строкой втрое длиннее, и каталог из шестисот
 * товаров с фотографиями перестал бы открываться. Восьмисот точек по большей
 * стороне хватает и плитке кассы, и карточке.
 */

/** Наибольшая сторона сохраняемой картинки, точек. */
const MAX_SIDE = 800;
/** Качество JPEG: 0.82 — предел, за которым разница уже видна. */
const QUALITY = 0.82;

export function pickPhoto(): Promise<string | null> {
  // На телефоне выбор картинки — дело системного окна, а не браузера. Пока
  // его нет, честнее ничего не открывать, чем открыть пустоту.
  if (Platform.OS !== 'web') return Promise.resolve(null);

  return new Promise((resolve) => {
    const input = globalThis.document?.createElement('input');
    if (!input) {
      resolve(null);
      return;
    }

    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      shrink(file).then(resolve, () => resolve(null));
    });

    // Отмену браузер не сообщает вовсе — обещание просто не разрешится, и это
    // ровно то, что нужно: ничего не выбрали, ничего и не меняется.
    globalThis.document.body.appendChild(input);
    input.click();
  });
}

/** Уменьшает картинку и отдаёт её строкой `data:`. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Файл не прочитан'));
    reader.onload = () => {
      const source = String(reader.result);
      const image = new Image();

      image.onerror = () => reject(new Error('Это не картинка'));
      image.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
        // Картинка меньше предела — отдаём как есть: пересжимать её значило бы
        // испортить без всякой выгоды.
        if (scale === 1 && source.length < 400_000) {
          resolve(source);
          return;
        }

        const canvas = globalThis.document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext('2d');
        if (!context) {
          resolve(source);
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', QUALITY));
      };

      image.src = source;
    };

    reader.readAsDataURL(file);
  });
}
