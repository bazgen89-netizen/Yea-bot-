<?php
/**
 * robots.txt в том же виде, что и на старом сайте.
 *
 * WordPress отдаёт свой виртуальный robots.txt, который перекрыл бы
 * настроенные правила: закрытые параметры ссылок и директивы
 * Clean-param для Яндекса. Их собирали под конкретные проблемы
 * с дублями, поэтому переносим как есть, добавляя только защиту
 * служебных каталогов самого WordPress.
 *
 * Файл robots.txt в корне сайта имеет приоритет над этим кодом:
 * если он там появится, правила надо править в нём.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Общие правила для всех роботов и отдельно для Яндекса. */
function eco_robots_rules() {
	$disallow = array(
		'/?id', '/?', '/?*', '*?*',
		'*utm*=', '*openstat=', '*from=',
		'/less/',
		'*?etext=*', '*?etext=', '*?erid*', '*&quot',
		'/*?no-rooms=', '/*no-rooms',
		'/28215/',
		// служебные каталоги WordPress
		'/wp-admin/', '/wp-includes/',
	);
	$clean = array( 'etext', 'etext=', 'utm', 'amp', 'referrer', '&quot', '&', 'no-rooms' );

	return array( 'disallow' => $disallow, 'clean' => $clean );
}

add_filter( 'robots_txt', 'eco_robots_txt', 10, 2 );
function eco_robots_txt( $output, $public ) {
	// Закрытый от индексации сайт (галочка в настройках) не трогаем:
	// это осознанное решение, например на тестовом домене.
	if ( ! $public ) {
		return $output;
	}

	$rules = eco_robots_rules();
	$lines = array();

	foreach ( array( '*', 'Yandex' ) as $agent ) {
		$lines[] = 'User-agent: ' . $agent;
		foreach ( $rules['disallow'] as $path ) {
			$lines[] = 'Disallow: ' . $path;
		}
		$lines[] = 'Allow: /wp-admin/admin-ajax.php';
		foreach ( $rules['clean'] as $param ) {
			$lines[] = 'Clean-param: ' . $param;
		}
		if ( 'Yandex' === $agent ) {
			$lines[] = 'Clean-param: yandexClientId';
		}
		$lines[] = '';
	}

	$lines[] = 'Sitemap: ' . home_url( '/sitemap.xml' );

	return implode( "\n", $lines ) . "\n";
}
