<?php
/**
 * Импорт выгрузки MODX в WordPress.
 *
 * Запуск на сервере с установленным WordPress:
 *   php import.php --wp=/путь/к/wordpress --bundle=bundle.json [--dry]
 *
 * Скрипт идемпотентный: повторный запуск обновляет уже созданные записи,
 * а не плодит дубли. Связь держится через мета-поле _eco_modx_id.
 *
 * Картинки контента остаются по прежним путям (/content/...), поэтому
 * в медиабиблиотеку они не заливаются — их переносит fetch_media.py
 * вместе с сохранением структуры каталогов. Так адреса картинок
 * не меняются, а это важно для поиска по картинкам.
 */

$opts = getopt('', ['wp:', 'bundle:', 'dry', 'quiet']);
$wp_path = rtrim($opts['wp'] ?? '', '/');
$bundle_path = $opts['bundle'] ?? __DIR__ . '/bundle.json';
$dry = isset($opts['dry']);
$quiet = isset($opts['quiet']);

if (!$wp_path || !is_file("$wp_path/wp-load.php")) {
    fwrite(STDERR, "Укажите путь к WordPress: --wp=/путь/к/wordpress\n");
    exit(1);
}
if (!is_file($bundle_path)) {
    fwrite(STDERR, "Не найден файл выгрузки: $bundle_path\n");
    exit(1);
}

define('WP_USE_THEMES', false);
require "$wp_path/wp-load.php";

if (!function_exists('eco_post_types')) {
    fwrite(STDERR, "Тема «ЭкоПарк» не активна — включите её перед импортом.\n");
    exit(1);
}

$bundle = json_decode(file_get_contents($bundle_path), true);
if (!is_array($bundle) || empty($bundle['pages'])) {
    fwrite(STDERR, "Выгрузка пустая или повреждена.\n");
    exit(1);
}

function say($msg) {
    global $quiet;
    if (!$quiet) {
        echo $msg . "\n";
    }
}

/** Ищет уже импортированную запись по её прежнему id в MODX. */
function find_by_modx_id($modx_id) {
    $found = get_posts([
        'post_type'   => array_merge(eco_post_types(), ['post']),
        'post_status' => 'any',
        'numberposts' => 1,
        'fields'      => 'ids',
        'meta_key'    => '_eco_modx_id',
        'meta_value'  => (int) $modx_id,
    ]);
    return $found ? (int) $found[0] : 0;
}

/* ------------------------------------------------------------------ *
 * Блоки: бывшие статические чанки MODX
 * ------------------------------------------------------------------ */

$block_ids = [];
foreach (($bundle['blocks'] ?? []) as $block) {
    $existing = get_page_by_path($block['slug'], OBJECT, 'eco_block');
    $data = [
        'post_type'    => 'eco_block',
        'post_name'    => $block['slug'],
        'post_title'   => $block['title'] ?: $block['slug'],
        'post_content' => $block['content'],
        'post_status'  => 'publish',
    ];
    if ($dry) {
        say('  [проверка] блок ' . $block['slug']);
        continue;
    }
    if ($existing) {
        $data['ID'] = $existing->ID;
        $block_ids[$block['slug']] = wp_update_post($data);
    } else {
        $block_ids[$block['slug']] = wp_insert_post($data);
    }
}
say('Блоков: ' . count($block_ids));

/* ------------------------------------------------------------------ *
 * Первый проход: создаём записи. Ссылки внутри текста ещё не трогаем —
 * они указывают на страницы, которых может пока не существовать.
 * ------------------------------------------------------------------ */

$map = [];      // modx_id => post_id
$created = $updated = 0;

foreach ($bundle['pages'] as $page) {
    $modx_id = (int) $page['modx_id'];
    $existing = find_by_modx_id($modx_id);

    $parent_id = 0;
    if (!empty($page['parent']) && isset($map[$page['parent']])) {
        $parent_id = $map[$page['parent']];
    }

    $data = [
        'post_type'     => $page['post_type'],
        'post_title'    => $page['title'],
        'post_content'  => $page['content'],
        'post_excerpt'  => wp_strip_all_tags($page['excerpt']),
        'post_name'     => $page['alias'] ?: sanitize_title($page['title']),
        'post_parent'   => $parent_id,
        'menu_order'    => (int) $page['menuindex'],
        'post_status'   => $page['published'] ? 'publish' : 'draft',
        'comment_status' => 'closed',
        'ping_status'   => 'closed',
    ];
    if (!empty($page['created'])) {
        $data['post_date'] = $page['created'];
    }

    if ($dry) {
        say(sprintf('  [проверка] %-9s %-42s %s', $page['post_type'], $page['uri'], $page['title']));
        $map[$modx_id] = $existing ?: -$modx_id;
        continue;
    }

    if ($existing) {
        $data['ID'] = $existing;
        $post_id = wp_update_post($data, true);
        $updated++;
    } else {
        $post_id = wp_insert_post($data, true);
        $created++;
    }

    if (is_wp_error($post_id)) {
        fwrite(STDERR, "Ошибка на ресурсе $modx_id: " . $post_id->get_error_message() . "\n");
        continue;
    }

    $map[$modx_id] = $post_id;

    update_post_meta($post_id, '_eco_modx_id', $modx_id);
    update_post_meta($post_id, '_eco_uri', $page['uri']);
    if (!empty($page['longtitle'])) {
        update_post_meta($post_id, '_eco_longtitle', $page['longtitle']);
    }
    foreach ($page['tvs'] as $name => $value) {
        update_post_meta($post_id, $name, $value);
    }
}

say(sprintf('Записи: создано %d, обновлено %d', $created, $updated));

if ($dry) {
    say('Проверочный запуск — ничего не записано.');
    exit(0);
}

/* ------------------------------------------------------------------ *
 * Второй проход: чиним содержимое, когда все страницы уже есть
 * и известны их адреса.
 * ------------------------------------------------------------------ */

$theme_assets = get_template_directory_uri() . '/assets/';
$GLOBALS['eco_static_blocks'] = array_column($bundle['blocks'] ?? [], 'slug');
$unresolved = [];

/** Переводит теги MODX в содержимом на язык WordPress. */
function convert_content($html, array $map, $theme_assets, &$unresolved, $page = null) {
    // Ссылки на другие страницы: [[~15]] -> постоянная ссылка
    // Разделитель не ~: сам тег MODX его содержит.
    $html = preg_replace_callback('#\[\[~\s*(\d+)\s*\]\]#', function ($m) use ($map, &$unresolved) {
        $target = (int) $m[1];
        if (isset($map[$target])) {
            return get_permalink($map[$target]);
        }
        $unresolved[] = "ссылка на ресурс $target";
        return '#';
    }, $html);

    // Выборки getResources различаем по имени чанка-шаблона.
    $lists = [
        'events_mainpage'       => '[main_event]',
        'events_slider_element' => '[events]',
        'nomera_anblock_2'      => '[cottages]',
        'usl_slider_element'    => '',   // выборка по разделу, которого больше нет
    ];
    $html = preg_replace_callback('~\[\[!?getResources\?.*?\]\]~s', function ($m) use ($lists, &$unresolved) {
        if (preg_match('~&tpl=`([^`]*)`~', $m[0], $tpl) && array_key_exists($tpl[1], $lists)) {
            return $lists[$tpl[1]];
        }
        $unresolved[] = 'getResources: ' . trim(preg_replace('~\s+~', ' ', substr($m[0], 0, 80)));
        return '';
    }, $html);

    // Чанки, у которых в теме есть свой шорткод
    $chunks = [
        'travelline2' => '[travelline]',
        'travelline'  => '[travelline]',
        'services'    => '[services]',
        'links'       => '[links]',
        'ymap'        => '[ymap]',
        'calendar'    => '[calendar]',
        'roomsslider' => '[cottages]',
    ];
    // Статические чанки стали блоками
    foreach (($GLOBALS['eco_static_blocks'] ?? []) as $slug) {
        $chunks[$slug] = '[block slug="' . $slug . '"]';
    }
    foreach ($chunks as $chunk => $shortcode) {
        $html = preg_replace('~\[\[\$' . preg_quote($chunk, '~') . '(\?[^\]]*)?\]\]~', $shortcode, $html);
    }

    // Поля самой страницы: в MODX они подставлялись на лету, здесь
    // записываем значение — содержимое всё равно принадлежит странице.
    if ($page) {
        $fields = [
            'pagetitle' => $page['title'],
            'longtitle' => $page['longtitle'] ?: $page['title'],
            'title'     => $page['longtitle'] ?: $page['title'],
            'introtext' => $page['excerpt'],
            'description' => $page['description'],
        ];
        foreach ($fields as $field => $value) {
            $html = str_replace('[[*' . $field . ']]', $value, $html);
        }
    }

    // Телефон и почта подставляются значением: они встречаются внутри
    // атрибутов href, где шорткод не сработает.
    $html = str_replace('[[$phonelink]]', eco_contact('phone_link'), $html);
    $html = str_replace('[[$phone]]', eco_contact('phone'), $html);

    // Статика темы переехала из /template/ внутрь темы.
    $html = preg_replace('~(["\'(])template/~', '$1' . $theme_assets, $html);

    // Всё, что осталось, вычищаем — ровно так же поступал и сам MODX
    // с вызовами несуществующих чанков и ресурсов. Но каждый такой тег
    // попадает в отчёт: молча терять содержимое нельзя.
    if (preg_match_all('~\[\[[^\]]{0,120}~', $html, $rest)) {
        foreach ($rest[0] as $tag) {
            $unresolved[] = trim($tag);
        }
        do {
            $before_clean = $html;
            $html = preg_replace('~\[\[(?:(?!\[\[|\]\]).)*\]\]~s', '', $html);
        } while ($html !== $before_clean);
    }
    return $html;
}

$fixed = 0;
foreach ($bundle['pages'] as $page) {
    $post_id = $map[$page['modx_id']] ?? 0;
    if (!$post_id) {
        continue;
    }
    $before = $page['content'];
    $after = convert_content($before, $map, $theme_assets, $unresolved, $page);

    // Поля с HTML тоже содержат теги MODX.
    foreach (['pg_topcont', 'nomera_text', 'nomera_bronlink'] as $field) {
        $value = get_post_meta($post_id, $field, true);
        if (is_string($value) && $value !== '') {
            update_post_meta($post_id, $field, convert_content($value, $map, $theme_assets, $unresolved, $page));
        }
    }

    if ($after !== $before) {
        wp_update_post(['ID' => $post_id, 'post_content' => $after]);
        $fixed++;
    }
}
say("Содержимое переписано на $fixed страницах");

// Блоки тоже содержат ссылки [[~id]] — чиним их тем же проходом,
// теперь когда все страницы созданы и адреса известны.
$fixed_blocks = 0;
foreach ($block_ids as $slug => $block_id) {
    if (!$block_id || is_wp_error($block_id)) {
        continue;
    }
    $before = get_post_field('post_content', $block_id);
    $after = convert_content($before, $map, $theme_assets, $unresolved);
    if ($after !== $before) {
        wp_update_post(['ID' => $block_id, 'post_content' => $after]);
        $fixed_blocks++;
    }
}
say("Содержимое переписано в $fixed_blocks блоках");


/* ------------------------------------------------------------------ *
 * Главная страница и редиректы
 * ------------------------------------------------------------------ */

$front_modx_id = (int) ($bundle['front_page'] ?? 1);
if (isset($map[$front_modx_id])) {
    $front_id = $map[$front_modx_id];
    update_option('show_on_front', 'page');
    update_option('page_on_front', $front_id);
    update_post_meta($front_id, '_eco_uri', '');
    say('Главная страница: #' . $front_id);
}

$redirects = get_option('eco_redirects', []);
if (!is_array($redirects)) {
    $redirects = [];
}
// Старый адрес главной
$redirects['index.html'] = '';
foreach ($bundle['pages'] as $page) {
    // MODX отдавал любую страницу и по числовому адресу
    $redirects[$page['modx_id'] . '.html'] = $page['uri'];
}
update_option('eco_redirects', $redirects);
say('Редиректов записано: ' . count($redirects));

delete_option('eco_uri_map');
eco_uri_map();
say('Карта адресов пересобрана: ' . count(eco_uri_map()) . ' путей');

if ($unresolved) {
    $unresolved = array_values(array_unique($unresolved));
    say("\nТребует ручной проверки (" . count($unresolved) . '):');
    foreach (array_slice($unresolved, 0, 30) as $item) {
        say('  ' . $item);
    }
}
say("\nГотово.");
