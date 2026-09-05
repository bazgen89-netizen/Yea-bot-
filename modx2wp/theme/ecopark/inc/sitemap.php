<?php
/**
 * Карта сайта по прежнему адресу /sitemap.xml.
 *
 * На старом сайте это был отдельный ресурс со сниппетом pdoSitemap.
 * Ядро WordPress отдаёт свою карту по адресу /wp-sitemap.xml — другой
 * адрес, а прежний уже передан в Яндекс и Google, поэтому отдаём
 * карту там же, где она была.
 *
 * Частота обновления и приоритет берутся из бывших TV sitemap_freq
 * и sitemap_prio — они настроены по страницам, и терять это не нужно.
 *
 * Если поставят SEO-плагин, он обычно занимает /sitemap.xml сам —
 * тогда тема в это не вмешивается.
 *
 * Замечание: страница /booking/ закрыта от индексации, но в карте
 * старого сайта присутствует. Поведение сохранено один в один;
 * убирать её — отдельное решение, а не задача переноса.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Своя карта заменяет карту ядра — две карты поисковику ни к чему. */
add_filter( 'wp_sitemaps_enabled', function ( $enabled ) {
	return eco_seo_plugin_active() ? $enabled : false;
} );

add_action( 'parse_request', 'eco_serve_sitemap', 2 );
function eco_serve_sitemap() {
	if ( eco_seo_plugin_active() || 'sitemap.xml' !== eco_request_path() ) {
		return;
	}

	$posts = get_posts( array(
		'post_type'      => eco_post_types(),
		'post_status'    => 'publish',
		'posts_per_page' => -1,
		'orderby'        => 'ID',
		'order'          => 'ASC',
	) );

	header( 'Content-Type: application/xml; charset=UTF-8' );
	echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
	echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";

	foreach ( $posts as $post ) {
		// Правило старого сайта: в карту не попадают страницы с флагом
		// «скрыть в меню». Воспроизводим как есть — набор адресов в карте
		// должен остаться прежним.
		if ( get_post_meta( $post->ID, '_eco_hidemenu', true ) ) {
			continue;
		}

		$freq = get_post_meta( $post->ID, 'sitemap_freq', true ) ?: 'weekly';
		$prio = get_post_meta( $post->ID, 'sitemap_prio', true ) ?: '0.5';

		echo "\t<url>\n";
		printf( "\t\t<loc>%s</loc>\n", esc_url( get_permalink( $post ) ) );
		printf( "\t\t<lastmod>%s</lastmod>\n", esc_html( get_post_modified_time( 'c', false, $post ) ) );
		printf( "\t\t<changefreq>%s</changefreq>\n", esc_html( $freq ) );
		printf( "\t\t<priority>%s</priority>\n", esc_html( $prio ) );
		echo "\t</url>\n";
	}

	echo '</urlset>';
	exit;
}
