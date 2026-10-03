'use strict';
function register(router,{guard,may,service=require('../core/order-photos-runtime')}) {
 router.get('/ops/orders/:id/photos/:leg/:index',guard,may('orders.view'),may('customers.view'),async(req,res,next)=>{
  res.set({'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Disposition':'inline'});
  try {
   const image=await service.photo(req.params.id,req.params.leg,req.params.index);
   if(!image)return res.sendStatus(404);
   return res.type(image.contentType).send(image.bytes);
  }catch(error){next(error);}
 });
}
module.exports={register};
