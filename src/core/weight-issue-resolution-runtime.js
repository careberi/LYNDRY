 'use strict';
const db=require('../db');
const data=async q=>{const {data,error}=await q;if(error)throw error;return data;};
module.exports=require('./weight-issue-resolution').createResolver({
 loadOrders:(customer,numbers)=>data(db.from('orders').select('id,order_number,partner_id,status').eq('customer_id',customer).in('order_number',numbers)),
 readIntake:id=>data(db.from('partner_order_intakes').select('partner_id,return_check_status').eq('order_id',id).maybeSingle()),
 release:(id,admin,note)=>data(db.rpc('release_partner_return_weight',{p_order:id,p_admin:admin,p_note:note})),
 ready:(order,admin)=>data(db.rpc('record_partner_intake_admin',{p_order:order.id,p_partner:order.partner_id,p_admin:admin.id,p_action:'ready',p_tracking:null,p_weight:null})),
 closeIssue:(...args)=>require('./issues').resolve(...args),
 requestReturn:(...args)=>require('./partner-return-runtime').request(...args),
});
