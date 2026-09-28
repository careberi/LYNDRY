'use strict';
// Compatibility for old development callers. Historical rows remain in the database.
const retired = () => { throw Error('The spending approval workflow has been retired.'); };
module.exports = {check:async()=>({ok:true,retired:true}), propose:retired, approve:retired};
