
/**
 * WaysTea — SEO: склейка дублирующих карточек и noindex фильтров каталога.
 *
 * ПЕРЕПИСАНО 21.09.2026. Прежнее правило объявляло дублем любой товар,
 * чей слаг кончается на -2…-9, если существует товар с базовым слагом.
 * Замер по всем 134 товарам с числовым хвостом показал: правило работает
 * наоборот. В 18 парах из 20 из индекса выпадала карточка с нормальным
 * названием, а в индексе оставалась помеченная «(арт. 2)» или «партия 2» —
 * потому что хвост -2 в слаге достаётся тому, кого завели вторым,
 * а не тому, кто хуже. Примеры: «Щипцы для чая» пряталась в пользу
 * «Щипцы для чая (арт. 2)», «Те Гуань Инь весна 2024г» — в пользу
 * «Те Гуань Инь весна 2024г (партия 2)».
 *
 * Ещё две пары склеивались ошибочно, это разные товары:
 * 15369 «Да Хун Пао» и 11595 «Да Хун Пао Чжу Хо (сильного огня)».
 *
 * Теперь ключ — пометка самого магазина в НАЗВАНИИ, а не слаг. Прячем
 * помеченную карточку, каноническую ставим на чисто названную. Проверка
 * запускается только когда пометка есть, поэтому на остальных страницах
 * лишних запросов к базе нет — дешевле прежнего варианта.
 *
 * Тег robots отдаём через фильтр Yoast, а не echo в wp_head: прежний код
 * печатал свой тег, Yoast печатал рядом второй со значением index, follow,
 * и на странице оказывалось два противоречащих тега.
 */

// 1. Склейка карточек, помеченных «(арт. N)» или «партия N»
add_action( 'template_redirect', function () {
	if ( ! is_singular( 'product' ) ) {
		return;
	}
	global $post;
	if ( ! $post ) {
		return;
	}

	$label = '/\s*(?:[\(\[]\s*)?(?:арт\.?\s*\d+|партия\s*\d+)(?:\s*[\)\]])?\s*$/ui';
	$dash  = '/\s*[—–-]\s*(?:арт\.?\s*\d+|партия\s*\d+)\s*$/ui';

	$name = $post->post_title;
	$base_name = preg_replace( $dash, '', $name );
	$base_name = preg_replace( $label, '', $base_name );
	$base_name = trim( $base_name );

	// пометки нет — товар самостоятельный, ничего не делаем и в базу не лезем
	if ( $base_name === '' || $base_name === trim( $name ) ) {
		return;
	}

	$base = get_posts( array(
		'post_type'      => 'product',
		'post_status'    => 'publish',
		'title'          => $base_name,
		'numberposts'    => 1,
		'fields'         => 'ids',
		'no_found_rows'  => true,
		'post__not_in'   => array( $post->ID ),
	) );
	if ( empty( $base ) ) {
		return;
	}

	$base_url = get_permalink( $base[0] );
	if ( ! $base_url ) {
		return;
	}

	// Склеиваем канонической ссылкой, БЕЗ noindex. Разница существенная:
	// noindex страницу выбрасывает и её накопленный вес пропадает, canonical
	// передаёт его основной карточке. К тому же Yoast на странице с noindex
	// вовсе не печатает canonical — получалось «спрятать и ничего не склеить».
	add_filter( 'wpseo_canonical', function () use ( $base_url ) {
		return $base_url;
	} );
}, 10 );

// 2. noindex для страниц каталога с параметрами сортировки и фильтра
add_action( 'template_redirect', function () {
	if ( is_singular() ) {
		return;
	}
	if ( ! is_woocommerce() && ! is_shop() && ! is_product_category() && ! is_product_tag() ) {
		return;
	}
	$noindex_params = array( 'orderby', 'min_price', 'max_price', 'rating_filter', 'on_sale' );
	$should_noindex = false;
	foreach ( $noindex_params as $param ) {
		if ( isset( $_GET[ $param ] ) ) {
			$should_noindex = true;
			break;
		}
	}
	if ( ! $should_noindex ) {
		foreach ( $_GET as $key => $val ) {
			if ( strpos( $key, 'filter_' ) === 0 ) {
				$should_noindex = true;
				break;
			}
		}
	}
	if ( ! $should_noindex ) {
		return;
	}
	add_filter( 'wpseo_robots_array', function ( $robots ) {
		$robots['index']  = 'noindex';
		$robots['follow'] = 'follow';
		return $robots;
	} );
}, 10 );
