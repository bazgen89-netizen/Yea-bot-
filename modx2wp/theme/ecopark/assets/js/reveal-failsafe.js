/*
 * Предохранитель показа контента (чистый JS, без jQuery).
 * Исходная вёрстка прячет блоки (.anim.frombottom/.opac => opacity:0) и
 * показывает их, навешивая класс .sh скриптом на jQuery. Если на боевом
 * окружении что-то ломает тот механизм (конфликт jQuery от внешних
 * виджетов, ошибка стороннего скрипта), блоки остаются скрытыми и
 * страница выглядит пустой. Этот модуль независимо раскрывает блоки:
 *  - готовит .allanim > * так же, как это делает script.js;
 *  - навешивает .sh на элементы, попавшие в область просмотра, при
 *    загрузке и прокрутке;
 *  - как крайняя мера — гарантированно раскрывает всё, чтобы контент
 *    никогда не оставался невидимым.
 */
(function () {
	function prep() {
		var kids = document.querySelectorAll('.allanim > *');
		for (var i = 0; i < kids.length; i++) {
			var el = kids[i], p = el.parentNode;
			if (!p || p.nodeType !== 1) continue;
			if (p.classList.contains('frombottom')) { el.classList.add('anim'); el.classList.add('frombottom'); }
			if (p.classList.contains('opac')) { el.classList.add('anim'); el.classList.add('opac'); }
		}
	}
	function revealInView() {
		var vh = window.innerHeight || document.documentElement.clientHeight;
		var els = document.querySelectorAll('.anim:not(.sh)');
		for (var i = 0; i < els.length; i++) {
			var r = els[i].getBoundingClientRect();
			if (r.bottom >= 0 && r.top < vh * 0.95) els[i].classList.add('sh');
		}
	}
	function revealAll() {
		var els = document.querySelectorAll('.anim:not(.sh)');
		for (var i = 0; i < els.length; i++) els[i].classList.add('sh');
	}
	function start() {
		prep();
		revealInView();
		window.addEventListener('scroll', revealInView, { passive: true });
		window.addEventListener('resize', revealInView);
		// Несколько ранних проходов на случай позднего появления разметки.
		setTimeout(revealInView, 400);
		setTimeout(revealInView, 1000);
		// Крайняя мера: раскрыть всё, что осталось скрытым, чтобы страница
		// не оставалась пустой, если основной скрипт показа не отработал.
		setTimeout(revealAll, 6000);
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start);
	} else {
		start();
	}
	window.addEventListener('load', revealInView);
})();
