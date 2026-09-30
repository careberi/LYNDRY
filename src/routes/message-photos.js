'use strict';
const {validPath}=require('../core/delivery-photo');
function register(router,{db,guard,may}) {
 router.get('/ops/message-photos/:id',guard,may('messages.view'),async(req,res,next)=>{
  res.set({'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Disposition':'inline'});
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id))return res.sendStatus(404);
  try {
   const {data:message,error}=await db.from('messages').select('media_path,customer_id').eq('id',req.params.id).maybeSingle();
   if(error)throw error;
   if(!message?.customer_id || !validPath(message.media_path,message.customer_id))return res.sendStatus(404);
   const result=await db.storage.from('delivery-photos').download(message.media_path);
   if(result.error || !result.data)return res.sendStatus(404);
   const bytes=Buffer.from(await result.data.arrayBuffer());
   if(bytes.length>290000 || bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255)return res.sendStatus(404);
   return res.type('image/jpeg').send(bytes);
  }catch(error){next(error);}
 });
}
module.exports={register};
