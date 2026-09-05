<?php /** Блок с картой и контактами. Порт чанка `map_and_footer`. */ ?>
<div class="ymap">
	<div class="halign">
		<div class="rel">
			<div class="contact anim frombottom">
				<p class="h">Где мы находимся</p>
				<p class="loc"><?php echo esc_html( eco_contact( 'address' ) ); ?></p>
				<p>Cлужба бронирования:</p>
				<a class="cont" href="tel:<?php echo esc_attr( eco_contact( 'phone_link' ) ); ?>"><?php echo esc_html( eco_contact( 'phone' ) ); ?></a>
				<a class="mail" href="mailto:<?php echo esc_attr( eco_contact( 'email' ) ); ?>"><?php echo esc_html( eco_contact( 'email' ) ); ?></a>
				<a class="btn brown anim frombottom shwin" href="#">Консультация<span class="noshow act">bron</span><span class="noshow txt">Консультация</span></a>
			</div>
		</div>
	</div>
	<div id="ymap">
		<iframe src="https://yandex.ru/map-widget/v1/?um=constructor%3Abc88bc0705a4f5e74d7527de508c2a9c08243de11c5fd5c85688f111c561afde"
			width="100%" height="100%" frameborder="0" loading="lazy" title="Карта проезда"></iframe>
	</div>
</div>
