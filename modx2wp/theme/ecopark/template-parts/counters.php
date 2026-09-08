<?php
/**
 * Счётчики: Яндекс.Метрика и Top.Mail.Ru (бывшие чанки yaMetrika и vkPixel).
 * Не грузятся для залогиненных редакторов, чтобы не портить статистику.
 */
if ( is_user_logged_in() ) {
	return;
}
?>
<script type="text/javascript">
	(function (m, e, t, r, i, k, a) {
		m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
		m[i].l = 1 * new Date();
		for (var j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) { return; } }
		k = e.createElement(t), a = e.getElementsByTagName(t)[0], k.async = 1, k.src = r, a.parentNode.insertBefore(k, a);
	})(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
	ym(49319104, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true, ecommerce: 'dataLayer' });
</script>
<noscript><div><img src="https://mc.yandex.ru/watch/49319104" style="position:absolute; left:-9999px;" alt=""></div></noscript>

<script type="text/javascript" defer>
	var _tmr = window._tmr || (window._tmr = []);
	_tmr.push({ id: '3721594', type: 'pageView', start: (new Date()).getTime() });
	(function (d, w, id) {
		if (d.getElementById(id)) return;
		var ts = d.createElement('script'); ts.type = 'text/javascript'; ts.async = true; ts.id = id;
		ts.src = 'https://top-fwz1.mail.ru/js/code.js';
		var f = function () { var s = d.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ts, s); };
		if (w.opera == '[object Opera]') { d.addEventListener('DOMContentLoaded', f, false); } else { f(); }
	})(document, window, 'tmr-code');
</script>
<noscript><div><img src="https://top-fwz1.mail.ru/counter?id=3721594;js=na" style="position:absolute;left:-9999px;" alt="Top.Mail.Ru"></div></noscript>
