<?php /** Выезжающее меню. Три колонки — три области меню в админке. */ ?>
<div class="ppmenu">
	<div class="halign">
		<div class="inline">
			<div class="close"></div>
			<p class="hotel">Загородный комплекс</p>
		</div>
		<div class="menuin">
			<div class="menucontent">

				<div class="menublock">
					<p>Гостям</p>
					<?php
					wp_nav_menu( array(
						'theme_location' => 'mobile_guest',
						'container'      => false,
						'items_wrap'     => '<ul>%3$s</ul>',
						'depth'          => 1,
						'fallback_cb'    => false,
					) );
					?>
				</div>

				<div class="menublock">
					<p>Услуги</p>
					<?php
					wp_nav_menu( array(
						'theme_location' => 'mobile_usl',
						'container'      => false,
						'items_wrap'     => '<ul>%3$s</ul>',
						'depth'          => 1,
						'fallback_cb'    => false,
					) );
					?>
				</div>

				<div class="menublock">
					<p>Экопарк</p>
					<?php
					wp_nav_menu( array(
						'theme_location' => 'mobile_park',
						'container'      => false,
						'items_wrap'     => '<ul>%3$s</ul>',
						'depth'          => 1,
						'fallback_cb'    => false,
					) );
					?>
				</div>

				<div class="line"></div>

				<div class="botmenublock">
					<div class="menucontent">
						<div class="botmenu">
							<p>Cлужба бронирования:</p>
							<a class="ptel" href="tel:<?php echo esc_attr( eco_contact( 'phone_link' ) ); ?>"><?php echo esc_html( eco_contact( 'phone' ) ); ?></a>
						</div>
						<div class="botmenu">
							<p>Наш адрес:</p>
							<p class="loc"><?php echo esc_html( eco_contact( 'address' ) ); ?></p>
						</div>
						<div class="botmenu">
							<p>Электронная почта:</p>
							<a class="padr" href="mailto:<?php echo esc_attr( eco_contact( 'email' ) ); ?>"><?php echo esc_html( eco_contact( 'email' ) ); ?></a>
						</div>
					</div>
				</div>

			</div>
		</div>
	</div>
</div>
