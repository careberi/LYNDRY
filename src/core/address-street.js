'use strict';
function houseNumber(value) {
 const match=/^\s*(\d+[A-Za-z]?(?:\s*[-\u2010-\u2015]\s*\d+[A-Za-z]?)?)(?=\s|$)/.exec(String(value||''));
 return match?match[1].replace(/\s*[-\u2010-\u2015]\s*/g,'-').toUpperCase():'';
}
function streetFromComponents(number,route,input) {
 const match=/^\s*(\d+[A-Za-z]?(?:\s*[-\u2010-\u2015]\s*\d+[A-Za-z]?)?)(?=\s|$)/.exec(String(input||''));
 const selected=match?match[1].replace(/\s*[-\u2010-\u2015]\s*/g,'-'):number;
 return selected&&route?selected+' '+route:'';
}
module.exports={houseNumber,streetFromComponents};
