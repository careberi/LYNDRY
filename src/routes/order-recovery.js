 'use strict';
const {sameOrigin}=require('./spending-routes');
function register(router,{guard,may,upload}){
 for(const action of ['sync','deliver','note']){
  router.post('/ops/orders/:id/recovery/'+action,guard,may('orders.override'),sameOrigin,...(action==='deliver'?[upload.single('photo')]:[]),async(req,res)=>{
   let message,kind='done';
   try{message=await require('../core/order-recovery-runtime').recover(req.params.id,action,{...req.body,file:req.file},req.opsUser);}
   catch(error){kind='problem';message=error.message;}
   res.redirect(303,'/ops/orders/'+encodeURIComponent(req.params.id)+'?'+kind+'='+encodeURIComponent(message));
  });
 }
}
module.exports={register};
