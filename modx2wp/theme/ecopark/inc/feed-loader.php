<?php
/**
 * Починка «ленты» на страницах-списках (/publication/, /uslugi/).
 *
 * Списки наполняются инлайновым скриптом, который POST-запросом на
 * /req.html подтягивает карточки. При импорте из шаблона пропали обратные
 * слэши (\) — переносы строк внутри строкового литерала t='...' стали
 * «сырыми», и весь скрипт падал с SyntaxError, из-за чего список оставался
 * пустым. Вырезаем сломанный скрипт и подставляем корректный на чистом JS.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Корректный загрузчик ленты. $req — тип запроса (events | services). */
function eco_feed_loader_js( $req ) {
	$req = preg_replace( '/[^a-z]/', '', $req );
	$req = esc_js( $req );
	$js = <<<JS
<script>
(function(){
	var ce = document.querySelector('.eventsanounces .ecentsall');
	if (!ce) return;
	var loaded = 0, loadmax = false, busy = false, REQ = '{$req}';
	function render(list){
		for (var i = 0; i < list.length; i++){
			var d = document.createElement('div');
			d.className = 'blx3';
			d.innerHTML = '<div class="eventan"><a href="' + list[i].l + '"></a>'
				+ '<div class="i" style="background-image:url(' + list[i].i + ')"></div>'
				+ '<div class="cont"><p class="h">' + list[i].t + '</p>'
				+ '<span class="btn"><span>Подробнее</span></span></div></div>';
			ce.appendChild(d);
			loaded++;
		}
	}
	function load(){
		if (busy || loadmax) return;
		busy = true;
		var xhr = new XMLHttpRequest();
		xhr.open('POST', '/req.html', true);
		xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
		xhr.onreadystatechange = function(){
			if (xhr.readyState !== 4) return;
			busy = false;
			var a; try { a = JSON.parse(xhr.responseText); } catch (e) { return; }
			var list = a && a.r ? a.r : [];
			render(list);
			var total = a && typeof a.cnt !== 'undefined' ? a.cnt : loaded;
			if (list.length === 0 || loaded >= total){
				loadmax = true;
				var ld = document.querySelector('.loadmoreblock .load');
				if (ld) ld.style.display = 'none';
			}
			var cur = document.querySelector('.loadmoreblock .cur');
			if (cur) cur.innerHTML = loaded;
			var tot = document.querySelector('.loadmoreblock .tot');
			if (tot) tot.innerHTML = total;
		};
		xhr.send(REQ + '=' + JSON.stringify({ s: loaded }));
	}
	load();
	var btn = document.querySelector('.loadmoreblock .load');
	if (btn) btn.addEventListener('click', function(e){ e.preventDefault(); load(); });
})();
</script>
JS;
	return $js;
}

/**
 * Заменяем сломанный инлайновый загрузчик на исправленный. Работает на
 * выводе всей страницы, поэтому ловит скрипт независимо от того, где он.
 */
function eco_fix_feed_loader( $html ) {
	$pos = strpos( $html, 'events_load' );
	if ( false === $pos ) {
		return $html;
	}
	// Границы <script>…events_load…</script> ищем строковыми операциями,
	// без regex — так безопасно даже на большой странице.
	$start = strrpos( substr( $html, 0, $pos ), '<script' );
	$end   = strpos( $html, '</script>', $pos );
	if ( false === $start || false === $end ) {
		return $html;
	}
	$end += strlen( '</script>' );

	$req   = 'events';
	$block = substr( $html, $start, $end - $start );
	if ( preg_match( "/req\s*:\s*'([a-z]+)'/", $block, $m ) ) {
		$req = $m[1];
	}
	$clean = eco_feed_loader_js( $req );

	return substr( $html, 0, $start ) . $clean . substr( $html, $end );
}
