'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { staffRoles, teamMemberBody } = require('../src/web/team-page');
test('Shipday team roles and member forms exclude local driving controls', () => {
  assert.deepEqual(staffRoles(true).map(([key]) => key), ['ADMIN', 'SALES']);
  for (const role of ['ADMIN', 'SALES', 'DRIVER']) {
    const html = teamMemberBody({ person: { id: 'staff', name: 'Staff', role, drives: true, status: 'ACTIVE' }, shipdayWorkspace: true });
    assert.doesNotMatch(html, /value="DRIVER"|name="drives"|On the route|Home base|shift_0_start|wage_dollars_hour/);
    assert.match(html, /name="name"/);
  }
  assert.ok(staffRoles(false).some(([key]) => key === 'DRIVER'));
});
