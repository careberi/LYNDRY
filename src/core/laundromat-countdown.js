'use strict';
function countdown(dueAt,now=Date.now(),lang='en') {
 const due=Date.parse(dueAt);
 if(!Number.isFinite(due))return {tone:'unknown',text:lang==='es'?'Plazo no disponible':'Deadline unavailable'};
 const minutes=Math.max(0,Math.ceil((due-now)/60000)),hours=Math.floor(minutes/60),rest=minutes%60;
 const tone=minutes<=120?'red':minutes<=600?'yellow':'green';
 const text=due<=now?(lang==='es'?'Vencido':'Overdue'):
   (lang==='es'?'Quedan ':'')+hours+'h '+rest+'m'+(lang==='es'?'':' left');
 return {tone,text};
}
module.exports={countdown};
