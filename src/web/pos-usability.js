'use strict';
// Progressive UI enhancements only; server permissions and form actions remain authoritative.
function script() { return '<script>(' + enhancePOS.toString() + ')();</script>'; }
function enhancePOS() {
  if (!location.hostname.startsWith('pos.') && !location.pathname.startsWith('/ops')) return;
  document.body.classList.add('pos-workspace');
  const main=document.querySelector('#pos-main'); if(!main)return;
  const path=location.pathname.replace(/^\/ops(?=\/|$)/,'')||'/';
  const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
  // Keep table identity and operational facts visible. Secondary fields remain one click away.
  main.querySelectorAll('table').forEach((table,i)=>{
    const heads=[...table.querySelectorAll('thead th')].map(h=>h.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(row=>[...row.children].forEach((cell,n)=>cell.dataset.label=heads[n]||''));
    const wrap=table.closest('.ops-table-wrap,.pt-scroll');
    if(wrap){wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',(table.closest('section')?.querySelector('h2')?.textContent||'Data table')+' — scroll for more columns');}
    if(path==='/'&&heads.includes('Pickup dispatch')) {
      table.classList.add('pos-order-table');
      const secondary=heads.map((h,n)=>['Pickup date','Clock','Weight','Plan','Promotion','Price'].includes(h)?n:-1).filter(n=>n>=0);
      table.querySelectorAll('tr').forEach(row=>secondary.forEach(n=>row.children[n]?.classList.add('pos-secondary-column')));
      const toggle=element('button','Show all order details','btn btn-outline');toggle.type='button';toggle.setAttribute('aria-expanded','false');
      toggle.onclick=()=>{const on=table.classList.toggle('pos-all-columns');toggle.textContent=on?'Show essential details':'Show all order details';toggle.setAttribute('aria-expanded',String(on));};
      table.parentElement.before(toggle);
    }
  });
  if(['/customers','/messages'].includes(path)) {
    const tables=[...main.querySelectorAll('table')];const rows=tables.flatMap(t=>[...t.querySelectorAll('tbody tr')]);
    const box=element('div',null,'pos-directory-search');const label=element('label',path==='/customers'?'Search customers by name or phone':'Search conversations by name or phone');
    const input=element('input');input.type='search';input.className='input';input.placeholder='Name or phone number';label.append(input);
    const status=element('p',null,'hint');status.setAttribute('role','status');box.append(label,status);(tables[0]?.closest('.ops-table-wrap')||tables[0])?.before(box);
    input.addEventListener('input',()=>{const q=input.value.toLowerCase().trim(),digits=q.replace(/\D/g,'');let count=0;rows.forEach(row=>{const text=row.textContent.toLowerCase();const show=text.includes(q)||(digits.length>=3&&text.replace(/\D/g,'').includes(digits));row.hidden=!show;if(show)count++;});status.textContent=count+' matching '+(path==='/customers'?'customers':'conversations')+(count?'':' — try another name or phone number.');});
    status.textContent=rows.length+' '+(path==='/customers'?'customers':'conversations')+' in this list.';
  }
  const thread=main.querySelector('.pos-thread-messages');if(thread)thread.scrollTop=thread.scrollHeight;
  main.querySelectorAll('.intake').forEach(d=>{if(location.hash&&d.contains(document.getElementById(location.hash.slice(1))))d.open=true;});
  main.addEventListener('click',event=>{const a=event.target.closest('a[href^="#"]');if(a){const target=document.getElementById(a.hash.slice(1));const details=target?.closest('details');if(details)details.open=true;}});
  const sendCard=main.querySelector('[name="send_card"]'), saveCustomer=main.querySelector('[data-customer-save]');
  if(sendCard&&saveCustomer){const paint=()=>saveCustomer.textContent=sendCard.checked?'Save customer and text card link':'Save customer';sendCard.addEventListener('change',paint);paint();}
  const hoursRows=[...main.querySelectorAll('[data-hours-day]')];
  if(hoursRows.length){
    main.querySelector('.pos-hours-copy').hidden=false;
    hoursRows.forEach(row=>{const inputs=[...row.querySelectorAll('input[type="time"]')];const label=element('label',null,'pos-day-state');const checkbox=element('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label',row.querySelector('.ph-day').textContent.trim()+' open');checkbox.checked=inputs.some(i=>i.value);label.append(checkbox,document.createTextNode(' Open'));row.querySelector('.ph-day').append(label);
      const paint=()=>{inputs.forEach(i=>i.disabled=!checkbox.checked);row.classList.toggle('pos-day-closed',!checkbox.checked);};checkbox.addEventListener('change',paint);paint();row._hoursToggle=checkbox;
    });
    main.querySelector('[data-copy-hours]').onclick=()=>{
      const source=main.querySelector('[data-hours-source]').value;const from=hoursRows.find(r=>r.dataset.hoursDay===source);let count=0;
      main.querySelectorAll('[data-hours-target]:checked').forEach(check=>{const row=hoursRows.find(r=>r.dataset.hoursDay===check.value);if(row===from)return;const values=[...from.querySelectorAll('input[type="time"]')].map(i=>i.value);row.querySelectorAll('input[type="time"]').forEach((input,i)=>input.value=values[i]);row._hoursToggle.checked=from._hoursToggle.checked;row._hoursToggle.dispatchEvent(new Event('change'));row.querySelector('details').open=Boolean(values[2]||values[3]);count++;});
      main.querySelector('[data-hours-feedback]').textContent=count?count+(count===1?' day':' days')+' updated in this form. Review the hours, then save the form.':'Select at least one different day to copy to.';
    };
  }
  const bookingForm=main.querySelector('form[action$="/order"]');
  if(bookingForm){const date=bookingForm.querySelector('[name="pickup_date"]'),time=bookingForm.querySelector('[name="pickup_time"]'),silent=bookingForm.querySelector('[name="silent"]');if(date&&time&&silent){const preview=element('p',null,'ops-note');preview.setAttribute('role','status');bookingForm.querySelector('button[type="submit"]').before(preview);const paint=()=>preview.textContent='Pickup: '+(date.value||'choose a day')+' · '+(time.value||'first available window')+'. '+(silent.checked?'No confirmation text will be sent.':'A confirmation text will be sent.');bookingForm.addEventListener('input',paint);bookingForm.addEventListener('change',paint);paint();}}
  const hold=main.querySelector('[name="hold_mode"]');if(hold){const field=main.querySelector('[name="hold_fixed"]');const paint=()=>{field.disabled=hold.value!=='FIXED';};hold.addEventListener('change',paint);paint();}
  const pricing=main.querySelector('form[action$="/pricing"]');if(pricing){const fields=[...pricing.querySelectorAll('input,select')];const initial=new Map(fields.map(f=>[f,f.value]));const output=element('div',null,'ops-note');output.setAttribute('role','status');pricing.querySelector('button[type="submit"],button:last-child')?.before(output);const paint=()=>{const changes=fields.filter(f=>!f.disabled&&f.value!==initial.get(f)).map(f=>(f.closest('label')?.childNodes[0]?.textContent.trim()||f.name)+': '+initial.get(f)+' → '+f.value);output.textContent=changes.length?'Changes for new quotes: '+changes.join('; '):'No changes. Existing accepted quotes keep their saved amounts.';};pricing.addEventListener('input',paint);pricing.addEventListener('change',paint);paint();}
  const broadcast=main.querySelector('[data-broadcast-draft]');if(broadcast){const audience=main.querySelector('#b_audience');const output=main.querySelector('.pos-broadcast-preview');const paint=()=>{output.textContent='Audience: '+audience.selectedOptions[0].textContent+'. Message: '+(broadcast.value||'Enter your message above.');};broadcast.addEventListener('input',paint);audience.addEventListener('change',paint);paint();}
  const navigation=main.querySelector('.ops-navigation-grid');if(navigation&&path==='/admin'){
    const groups=[['Daily operations',['/','/issues','/checkouts']],['Service and pricing',['/settings','/pricing','/laundry-checks','/weights','/reports']],['Customer communications',['/promotions','/broadcast','/scheduled']]];
    const links=[...navigation.querySelectorAll('a')];groups.forEach(([title,paths])=>{const section=element('section',null,'pos-admin-group');section.append(element('h2',title));const grid=element('div',null,'ops-navigation-grid');links.filter(a=>paths.includes(new URL(a.href).pathname.replace(/^\/ops(?=\/|$)/,'')||'/')).forEach(a=>grid.append(a));section.append(grid);navigation.before(section);});if(!navigation.querySelector('a'))navigation.remove();
  }
  if(/^\/customers\/[a-f0-9-]+$/.test(path)){const preferences=main.querySelector('.pos-secondary');const details=main.querySelector('.customer-details-table')?.closest('.grid-2');if(preferences&&details)details.after(preferences);}
  if(['/leads','/partners/enquiries'].includes(path)&&!main.querySelector('h1'))main.prepend(element('h1',path==='/leads'?'Leads':'Partner inquiries'));
  if(path==='/partners/enquiries'){const back=element('a','Back to partners');back.href='/partners';main.querySelector('h1')?.after(back);}
}
module.exports={script};
