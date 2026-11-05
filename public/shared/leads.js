(function () {
  'use strict';
  document.querySelectorAll('#bookingForm, #contact-form').forEach(function (form) {
    var button = form.querySelector('[type="submit"]');
    var success = form.querySelector('.form-success');
    var error = document.createElement('p');
    error.className = 'lead-error'; error.hidden = true;
    error.setAttribute('role', 'alert'); form.appendChild(error);
    var request = null;
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (button.disabled) return;
      error.hidden = true;
      success.hidden = true;
      form.classList.remove('is-sent');
      var fields = new FormData(form);
      var payload = { name: (fields.get('name') || '').trim(),
        contact: (fields.get('contact') || fields.get('phone') || '').trim(),
        course: fields.get('course') || fields.get('direction') || '',
        message: (fields.get('message') || fields.get('comment') || '').trim(),
        website: fields.get('website') || '', source: location.pathname };
      var validName = payload.name.length >= 2;
      var digits = payload.contact.replace(/\D/g, '');
      var validContact = digits.length >= 10 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contact)
        || /^@[A-Za-z0-9_]{5,32}$/.test(payload.contact);
      [['name', validName], [form.elements.phone ? 'phone' : 'contact', validContact]].forEach(function (pair) {
        var input = form.elements[pair[0]];
        input.setAttribute('aria-invalid', pair[1] ? 'false' : 'true');
        var field = input.closest('.field');
        if (field) field.classList.toggle('is-invalid', !pair[1]);
      });
      if (!validName || !validContact) {
        error.textContent = !validName ? 'Укажите ваше имя.' : 'Укажите телефон, почту или Telegram для связи.';
        error.hidden = false;
        form.elements[!validName ? 'name' : form.elements.phone ? 'phone' : 'contact'].focus();
        return;
      }
      var key = JSON.stringify(payload);
      if (!request || request.key !== key) request = { key: key, id: crypto.randomUUID() };
      payload.request_id = request.id;
      button.disabled = true;
      form.setAttribute('aria-busy', 'true');
      var label = button.innerHTML;
      button.textContent = 'Отправляем…';
      try {
        var response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
        var result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Не удалось отправить заявку. Попробуйте ещё раз.');
        success.hidden = false;
        success.setAttribute('role', 'status');
        form.classList.add('is-sent');
        form.reset(); request = null;
      } catch (failure) {
        error.textContent = failure.name === 'TimeoutError' || failure.name === 'TypeError'
          ? 'Не удалось получить подтверждение. Повторите отправку или напишите в Telegram.'
          : failure.message;
        error.hidden = false;
      } finally {
        button.disabled = false;
        button.innerHTML = label;
        form.removeAttribute('aria-busy');
      }
    });
  });
})();
