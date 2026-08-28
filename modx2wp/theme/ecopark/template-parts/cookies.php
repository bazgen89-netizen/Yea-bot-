<?php
/** Плашка про cookies. Порт чанка `cookieslabel`, стили переехали в newstyle.css. */
$eco_privacy = get_privacy_policy_url() ?: eco_url( 'politika.html' );
?>
<div class="pp_cookies">
	<p>Используем <a target="_blank" href="<?php echo esc_url( $eco_privacy ); ?>">cookies</a>, чтобы <br>создавать удобства на сайте.</p>
	<button type="button">Хорошо</button>
</div>
<script>
	(function () {
		var box = document.querySelector('.pp_cookies');
		if (!box) return;
		try {
			if (!localStorage.getItem('eco_cookies_ok')) box.classList.add('sh');
		} catch (e) { box.classList.add('sh'); }
		box.querySelector('button').addEventListener('click', function (e) {
			e.preventDefault();
			e.stopPropagation();
			box.classList.remove('sh');
			try { localStorage.setItem('eco_cookies_ok', '1'); } catch (e) {}
		});
	})();
</script>
