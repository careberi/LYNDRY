'use strict';
const {validIntake}=require('../core/partner-intake');
function wireReturnWeight(doc,valid) {
  const input=doc.getElementById('return_weight');
  const button=input?.form?.querySelector('[data-return-submit]');
  if(!input || !button)return;
  const update=()=>{button.disabled=!input.validity.valid || !valid(input.value);};
  input.addEventListener('input',update);
  input.addEventListener('change',update);
  update();
}
module.exports={wireReturnWeight,script:'<script>('+wireReturnWeight.toString()+')(document,'+validIntake.toString()+');</script>'};
