<?php
/**
 * Перенос содержимого из MODX.
 *
 * Логика живёт в теме, а не в отдельном скрипте, чтобы её можно было
 * запустить и из командной строки, и со страницы в админке. На хостингах
 * без SSH второе — единственный доступный путь.
 *
 * Точка входа: eco_import_bundle(). Медиафайлы качаются отдельно
 * и порциями — eco_import_media_batch(): их сотни, в один запрос
 * они не помещаются.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Ищет уже перенесённую запись по её прежнему id в MODX. */
function eco_import_find( $modx_id ) {
	$found = get_posts( array(
		'post_type'   => array_merge( eco_post_types(), array( 'post' ) ),
		'post_status' => 'any',
		'numberposts' => 1,
		'fields'      => 'ids',
		'meta_key'    => '_eco_modx_id',
		'meta_value'  => (int) $modx_id,
	) );
	return $found ? (int) $found[0] : 0;
}

/**
 * Переводит теги MODX в содержимом на язык WordPress.
 *
 * @param string     $html   исходная разметка
 * @param array      $map    modx_id => post_id
 * @param array      $ctx    ['assets' => URL статики, 'blocks' => слаги блоков]
 * @param array      $notes  сюда попадает всё, что не удалось разобрать
 * @param array|null $page   страница, если теги ссылаются на её поля
 */
function eco_import_convert( $html, array $map, array $ctx, array &$notes, $page = null ) {
	// Ссылки на другие страницы: [[~15]] -> постоянная ссылка.
	// Разделитель не ~: сам тег MODX его содержит.
	$html = preg_replace_callback( '#\[\[~\s*(\d+)\s*\]\]#', function ( $m ) use ( $map, &$notes ) {
		$target = (int) $m[1];
		if ( isset( $map[ $target ] ) ) {
			return get_permalink( $map[ $target ] );
		}
		$notes[] = "ссылка на ресурс $target";
		return '#';
	}, $html );

	// Скрипт формы бронирования TravelLine, вставленный прямо в текст,
	// заменяем шорткодом: WordPress вырезает <script> из содержимого
	// у редакторов без права unfiltered_html, и форма однажды пропадёт.
	$html = preg_replace(
		'~<div id="tl-booking-form">\s*</div>\s*<script.*?</script>~s',
		'[travelline]',
		$html
	);

	// Выборки getResources различаем по имени чанка-шаблона.
	$lists = array(
		'events_mainpage'       => '[main_event]',
		'events_slider_element' => '[events]',
		'nomera_anblock_2'      => '[cottages]',
		'usl_slider_element'    => '',   // выборка по разделу, которого больше нет
	);
	$html = preg_replace_callback( '~\[\[!?getResources\?.*?\]\]~s', function ( $m ) use ( $lists, &$notes ) {
		if ( preg_match( '~&tpl=`([^`]*)`~', $m[0], $tpl ) && array_key_exists( $tpl[1], $lists ) ) {
			return $lists[ $tpl[1] ];
		}
		$notes[] = 'getResources: ' . trim( preg_replace( '~\s+~', ' ', substr( $m[0], 0, 80 ) ) );
		return '';
	}, $html );

	// Чанки, у которых в теме есть свой шорткод.
	$chunks = array(
		// Оба чанка travelline выводили форму подбора дат, а не форму брони.
		'travelline2' => '[travelline_search variant="2"]',
		'travelline'  => '[travelline_search]',
		'services'    => '[services]',
		'links'       => '[links]',
		'ymap'        => '[ymap]',
		'calendar'    => '[calendar]',
		'roomsslider' => '[cottages]',
	);
	foreach ( $ctx['blocks'] as $slug ) {          // статические чанки стали блоками
		$chunks[ $slug ] = '[block slug="' . $slug . '"]';
	}
	foreach ( $chunks as $chunk => $shortcode ) {
		$html = preg_replace( '~\[\[\$' . preg_quote( $chunk, '~' ) . '(\?[^\]]*)?\]\]~', $shortcode, $html );
	}

	// Поля самой страницы: в MODX они подставлялись на лету, здесь
	// записываем значение — содержимое всё равно принадлежит странице.
	if ( $page ) {
		$fields = array(
			'pagetitle'   => $page['title'],
			'longtitle'   => $page['longtitle'] ?: $page['title'],
			'title'       => $page['longtitle'] ?: $page['title'],
			'introtext'   => $page['excerpt'],
			'description' => $page['description'],
		);
		foreach ( $fields as $field => $value ) {
			$html = str_replace( '[[*' . $field . ']]', $value, $html );
		}
	}

	// Телефон и почта — значением: они встречаются внутри атрибутов href,
	// где шорткод не сработает.
	$html = str_replace( '[[$phonelink]]', eco_contact( 'phone_link' ), $html );
	$html = str_replace( '[[$phone]]', eco_contact( 'phone' ), $html );

	// Статика темы переехала из /template/ внутрь темы.
	$html = preg_replace( '~(["\'(])template/~', '$1' . $ctx['assets'], $html );

	// Всё, что осталось, вычищаем — так же поступал и сам MODX с вызовами
	// несуществующих чанков. Но каждый тег попадает в отчёт: молча терять
	// содержимое нельзя.
	if ( preg_match_all( '~\[\[[^\]]{0,120}~', $html, $rest ) ) {
		foreach ( $rest[0] as $tag ) {
			$notes[] = trim( $tag );
		}
		do {
			$before = $html;
			$html = preg_replace( '~\[\[(?:(?!\[\[|\]\]).)*\]\]~s', '', $html );
		} while ( $html !== $before );
	}

	return $html;
}

/**
 * Переносит выгрузку в WordPress. Повторный запуск обновляет
 * уже созданные записи, а не плодит дубли.
 *
 * @param array $bundle разобранный bundle.json
 * @param bool  $dry    только показать, ничего не записывать
 * @return array ['log' => строки отчёта, 'notes' => что проверить руками]
 */
function eco_import_bundle( array $bundle, $dry = false ) {
	$log   = array();
	$notes = array();
	$say   = function ( $line ) use ( &$log ) { $log[] = $line; };

	if ( empty( $bundle['pages'] ) ) {
		return array( 'log' => array( 'Выгрузка пустая или повреждена.' ), 'notes' => array() );
	}

	$ctx = array(
		'assets' => get_template_directory_uri() . '/assets/',
		'blocks' => array_column( $bundle['blocks'] ?? array(), 'slug' ),
	);

	/* Блоки — бывшие статические чанки MODX. */
	$block_ids = array();
	foreach ( ( $bundle['blocks'] ?? array() ) as $block ) {
		if ( $dry ) {
			$say( 'блок ' . $block['slug'] );
			continue;
		}
		$existing = get_page_by_path( $block['slug'], OBJECT, 'eco_block' );
		// Закомментированную вёрстку из чанков не переносим: она мертва,
		// а любая её обработка рискует показать её на странице.
		$data = array(
			'post_type'    => 'eco_block',
			'post_name'    => $block['slug'],
			'post_title'   => $block['title'] ?: $block['slug'],
			'post_content' => preg_replace( '~<!--.*?-->~s', '', $block['content'] ),
			'post_status'  => 'publish',
		);
		if ( $existing ) {
			$data['ID'] = $existing->ID;
			$block_ids[ $block['slug'] ] = wp_update_post( $data );
		} else {
			$block_ids[ $block['slug'] ] = wp_insert_post( $data );
		}
	}
	$say( 'Блоков: ' . count( $block_ids ) );

	/* Первый проход: создаём записи. Ссылки внутри текста ещё не трогаем —
	   они указывают на страницы, которых может пока не существовать. */
	$map = array();
	$created = 0;
	$updated = 0;

	foreach ( $bundle['pages'] as $page ) {
		$modx_id  = (int) $page['modx_id'];
		$existing = eco_import_find( $modx_id );

		if ( $dry ) {
			$say( sprintf( '%-9s /%s', $page['post_type'], $page['uri'] ) );
			$map[ $modx_id ] = $existing ?: -$modx_id;
			continue;
		}

		$data = array(
			'post_type'      => $page['post_type'],
			'post_title'     => $page['title'],
			'post_content'   => $page['content'],
			'post_excerpt'   => wp_strip_all_tags( $page['excerpt'] ),
			'post_name'      => $page['alias'] ?: sanitize_title( $page['title'] ),
			'post_parent'    => ( ! empty( $page['parent'] ) && isset( $map[ $page['parent'] ] ) ) ? $map[ $page['parent'] ] : 0,
			'menu_order'     => (int) $page['menuindex'],
			'post_status'    => $page['published'] ? 'publish' : 'draft',
			'comment_status' => 'closed',
			'ping_status'    => 'closed',
		);
		if ( ! empty( $page['created'] ) ) {
			$data['post_date'] = $page['created'];
		}
		if ( $existing ) {
			$data['ID'] = $existing;
			$post_id = wp_update_post( $data, true );
			$updated++;
		} else {
			$post_id = wp_insert_post( $data, true );
			$created++;
		}
		if ( is_wp_error( $post_id ) ) {
			$notes[] = "ресурс $modx_id: " . $post_id->get_error_message();
			continue;
		}

		$map[ $modx_id ] = $post_id;

		update_post_meta( $post_id, '_eco_modx_id', $modx_id );
		update_post_meta( $post_id, '_eco_uri', $page['uri'] );
		if ( ! empty( $page['longtitle'] ) ) {
			update_post_meta( $post_id, '_eco_longtitle', $page['longtitle'] );
		}
		// Описание страницы: на старом сайте это поле ресурса, а не TV.
		if ( ! empty( $page['description'] ) ) {
			update_post_meta( $post_id, '_eco_description', $page['description'] );
		}
		// Флаг «скрыть в меню» решал, попадёт ли страница в карту сайта.
		update_post_meta( $post_id, '_eco_hidemenu', $page['hidemenu'] ? '1' : '' );
		foreach ( $page['tvs'] as $name => $value ) {
			update_post_meta( $post_id, $name, $value );
		}
	}

	$say( sprintf( 'Записи: создано %d, обновлено %d', $created, $updated ) );

	if ( $dry ) {
		$say( 'Проверочный запуск — ничего не записано.' );
		return array( 'log' => $log, 'notes' => $notes );
	}

	/* Второй проход: чиним содержимое, когда все страницы уже есть
	   и известны их адреса. */
	$fixed = 0;
	foreach ( $bundle['pages'] as $page ) {
		$post_id = $map[ $page['modx_id'] ] ?? 0;
		if ( ! $post_id ) {
			continue;
		}
		$after = eco_import_convert( $page['content'], $map, $ctx, $notes, $page );

		foreach ( array( 'pg_topcont', 'nomera_text', 'nomera_bronlink' ) as $field ) {
			$value = get_post_meta( $post_id, $field, true );
			if ( is_string( $value ) && '' !== $value ) {
				update_post_meta( $post_id, $field, eco_import_convert( $value, $map, $ctx, $notes, $page ) );
			}
		}

		// Ссылки внутри строк слайдера — такие же теги [[~id]].
		if ( ! empty( $page['tvs']['home_slider'] ) ) {
			$rows = get_post_meta( $post_id, 'home_slider', true );
			if ( is_array( $rows ) ) {
				foreach ( $rows as $i => $row ) {
					if ( ! empty( $row['url'] ) ) {
						$rows[ $i ]['url'] = eco_import_convert( $row['url'], $map, $ctx, $notes );
					}
				}
				update_post_meta( $post_id, 'home_slider', $rows );
			}
		}

		if ( $after !== $page['content'] ) {
			wp_update_post( array( 'ID' => $post_id, 'post_content' => $after ) );
			$fixed++;
		}
	}
	$say( "Содержимое переписано на $fixed страницах" );

	/* Блоки тоже содержат ссылки [[~id]]. */
	$fixed_blocks = 0;
	foreach ( $block_ids as $block_id ) {
		if ( ! $block_id || is_wp_error( $block_id ) ) {
			continue;
		}
		$before = get_post_field( 'post_content', $block_id );
		$after  = eco_import_convert( $before, $map, $ctx, $notes );
		if ( $after !== $before ) {
			wp_update_post( array( 'ID' => $block_id, 'post_content' => $after ) );
			$fixed_blocks++;
		}
	}
	$say( "Содержимое переписано в $fixed_blocks блоках" );

	/* Главная страница. */
	$front_modx_id = (int) ( $bundle['front_page'] ?? 1 );
	if ( isset( $map[ $front_modx_id ] ) ) {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $map[ $front_modx_id ] );
		update_post_meta( $map[ $front_modx_id ], '_eco_uri', '' );
		$say( 'Главная страница назначена' );
	}

	/* Меню. */
	$locations  = get_theme_mod( 'nav_menu_locations', array() );
	$menu_count = 0;
	foreach ( ( $bundle['menus'] ?? array() ) as $menu ) {
		$existing = wp_get_nav_menu_object( $menu['name'] );
		$menu_id  = $existing ? (int) $existing->term_id : wp_create_nav_menu( $menu['name'] );
		if ( is_wp_error( $menu_id ) ) {
			$notes[] = "меню «{$menu['name']}»: " . $menu_id->get_error_message();
			continue;
		}
		// Пункты пересобираем заново: иначе повторный запуск их удвоит.
		foreach ( wp_get_nav_menu_items( $menu_id ) ?: array() as $item ) {
			wp_delete_post( $item->ID, true );
		}
		foreach ( $menu['items'] as $item ) {
			wp_update_nav_menu_item( $menu_id, 0, array(
				'menu-item-title'  => $item['title'],
				'menu-item-url'    => eco_import_convert( $item['url'], $map, $ctx, $notes ),
				'menu-item-status' => 'publish',
			) );
		}
		$locations[ $menu['location'] ] = $menu_id;
		$menu_count++;
	}
	if ( $menu_count ) {
		set_theme_mod( 'nav_menu_locations', $locations );
		$say( "Меню: $menu_count" );
	}

	/* Редиректы со старых адресов. */
	$redirects = get_option( 'eco_redirects', array() );
	if ( ! is_array( $redirects ) ) {
		$redirects = array();
	}
	$redirects['index.html'] = '';
	foreach ( $bundle['pages'] as $page ) {
		// MODX отдавал любую страницу и по числовому адресу
		$redirects[ $page['modx_id'] . '.html' ] = $page['uri'];
	}
	update_option( 'eco_redirects', $redirects );
	$say( 'Редиректов записано: ' . count( $redirects ) );

	delete_option( ECO_URI_MAP );
	$say( 'Карта адресов пересобрана: ' . count( eco_uri_map() ) . ' путей' );

	return array( 'log' => $log, 'notes' => array_values( array_unique( $notes ) ) );
}

/**
 * Качает порцию медиафайлов со старого сайта, сохраняя пути.
 *
 * Файлов сотни и весят они под двести мегабайт — в один запрос
 * это не помещается, поэтому порциями.
 *
 * @return array ['done' => сколько обработано всего, 'ok', 'missing', 'failed']
 */
function eco_import_media_batch( array $files, $base, $offset = 0, $limit = 12 ) {
	$base  = rtrim( $base, '/' ) . '/';
	$slice = array_slice( $files, $offset, $limit );
	$ok    = array();
	$missing = array();
	$failed  = array();

	foreach ( $slice as $rel ) {
		$rel = ltrim( (string) $rel, '/' );
		// Наружу из корня сайта не выходим ни при каких данных в выгрузке.
		if ( '' === $rel || str_contains( $rel, '..' ) ) {
			$failed[] = $rel;
			continue;
		}
		$dst = ABSPATH . $rel;
		if ( file_exists( $dst ) && filesize( $dst ) > 0 ) {
			$ok[] = $rel;
			continue;
		}

		$response = wp_remote_get( $base . $rel, array( 'timeout' => 45 ) );
		if ( is_wp_error( $response ) ) {
			$failed[] = $rel;
			continue;
		}
		$code = wp_remote_retrieve_response_code( $response );
		if ( 404 === $code ) {
			$missing[] = $rel;
			continue;
		}
		if ( 200 !== $code ) {
			$failed[] = $rel;
			continue;
		}

		wp_mkdir_p( dirname( $dst ) );
		if ( false === file_put_contents( $dst, wp_remote_retrieve_body( $response ) ) ) {
			$failed[] = $rel;
			continue;
		}
		$ok[] = $rel;
	}

	return array(
		'done'    => $offset + count( $slice ),
		'total'   => count( $files ),
		'ok'      => $ok,
		'missing' => $missing,
		'failed'  => $failed,
	);
}
