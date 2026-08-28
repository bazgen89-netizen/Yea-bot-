<?php
/**
 * Всплывающие формы. Разметка и имена полей сохранены точно:
 * на них завязан assets/js/script.js, который не менялся при переносе.
 */
$eco_privacy = get_privacy_policy_url() ?: eco_url( 'politika.html' );
?>
<div class="ppwinbg"></div>

<div class="ppwin mes">
	<div class="tbl"><div class="tbc"><div class="in"><div class="frm"><div class="cont">
		<div class="close"><span></span><span></span></div>
		<form>
			<input class="noshow" type="text" name="realaddr">
			<input type="hidden" name="action" value="">
			<input type="hidden" name="details" value="">
			<div class="field"><input type="text" name="fio"><p>Как Вас зовут?</p></div>
			<div class="field"><input type="text" name="addr"><p>Электронная почта</p></div>
			<div class="field"><input type="text" name="mes"><p>Сообщение</p></div>
			<div class="check">
				<input name="ch1" type="checkbox" checked>
				<span></span><span></span>
				<p>Отправляя форму Вы соглашаетесь <br><a href="<?php echo esc_url( $eco_privacy ); ?>" target="_blank">с политикой конфиденциальности</a></p>
			</div>
			<button class="btn brown">Отправить</button>
		</form>
	</div></div></div></div></div>
</div>

<div class="ppwin meswtel">
	<div class="tbl"><div class="tbc"><div class="in"><div class="frm"><div class="cont">
		<div class="close"><span></span><span></span></div>
		<form>
			<input class="noshow" type="text" name="realaddr">
			<input type="hidden" name="action" value="">
			<input type="hidden" name="details" value="">
			<div class="field"><input type="text" name="fio"><p>Как Вас зовут?</p></div>
			<div class="field"><input type="text" name="tel"><p>Контактный телефон</p></div>
			<div class="field"><input type="text" name="mes"><p>Сообщение</p></div>
			<div class="check">
				<input name="ch1" type="checkbox" checked>
				<span></span><span></span>
				<p>Отправляя форму Вы соглашаетесь <br><a href="<?php echo esc_url( $eco_privacy ); ?>" target="_blank">с политикой конфиденциальности</a></p>
			</div>
			<button class="btn brown">Отправить</button>
		</form>
	</div></div></div></div></div>
</div>

<div class="ppwin thanks">
	<div class="tbl"><div class="tbc"><div class="in"><div class="frm"><div class="cont">
		<div class="close"><span></span><span></span></div>
		<p class="mt20">Спасибо, мы Вам перезвоним.</p>
		<div class="mt40"></div>
		<button class="btn brown">Закрыть</button>
	</div></div></div></div></div>
</div>
