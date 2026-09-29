'use strict';

const { escapeHtml } = require('./layout');

function optOutControl(person, mayDo) {
  if (!mayDo) return '';
  const off = person.status === 'UNSUBSCRIBED';
  return `<div class="card card-xl customer-texting">
    <span id="texting-label" class="field-label">Text messages: ${off ? 'Off' : 'On'}</span>
    ${off ? '<p class="field-hint">The customer must text START to enable messages again.</p>' : `
    <form method="post" action="/ops/customers/${escapeHtml(person.id)}/opt-out" style="display:block;margin-top:12px;">
      <label for="texting-note">How did the customer ask to stop texts?</label>
      <input class="input" id="texting-note" name="note" maxlength="200" required
        placeholder="For example: Asked by phone today" style="display:block;width:100%;margin:8px 0;">
      <p class="field-hint">This note records their request. Turning texts off sends no message. Only the customer can turn texts back on by texting START.</p>
      <button type="submit" class="btn btn-outline">Turn off text messages</button>
    </form>`}
  </div>`;
}

module.exports = { optOutControl };
