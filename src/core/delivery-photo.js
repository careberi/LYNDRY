'use strict';
const sharp=require('sharp');
const {fetchPhoto}=require('../providers/couriers/shipday-proof');
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATH=new RegExp('^delivery-sms/('+UUID+')/('+UUID+')\\.jpg$','i');
function validPath(path,customerId) {
 const match=typeof path==='string' && PATH.exec(path);
 return Boolean(match && (!customerId || match[1]===customerId));
}
async function prepare(bytes) {
 // Re-encode without EXIF/GPS metadata and keep below the smallest common MMS limit.
 for(const width of [1600,1200,800,500]) {
  const image=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true})
   .jpeg({quality:75}).timeout({seconds:10}).toBuffer();
  if(image.length<=290000)return image;
 }
 throw Error('Delivery photo could not fit a picture message.');
}
function createMedia(storage,read=fetchPhoto) {
 return async function save(row,order,url) {
  const path='delivery-sms/'+order.customer_id+'/'+row.id+'.jpg';
  if(!validPath(path,order.customer_id))throw Error('Invalid photo identity.');
  const photo=await read(url),bytes=await prepare(photo.bytes);
  const {error}=await storage.from('delivery-photos').upload(path,bytes,{contentType:'image/jpeg',upsert:true});
  if(error)throw error;
  return path;
 };
}
module.exports={prepare,validPath,createMedia};
