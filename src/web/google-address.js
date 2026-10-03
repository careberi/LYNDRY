'use strict';
const {streetFromComponents}=require('../core/address-street');
function script(settings = {}) {
  if (!settings.enabled) return '';
  // The browser key is public and must have HTTP referrer and API restrictions.
  const key=encodeURIComponent(settings.browserKey);
  return `<script>
  (function(){
    var streetFromComponents=${streetFromComponents.toString()};
    var form=document.querySelector('.pricing-address-form, [data-customer-address]');
    if(!form)return;
    var street=form.querySelector('[name=street], [name=address_line1]'), town=form.querySelector('[name=town], [name=city]'), zip=form.querySelector('[name=zip], [name=postal_code]');
    var hint=document.createElement('p');hint.className='field-hint address-status';hint.id='pricing-address-status';hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');
    hint.textContent='Choose your address from the suggestions.';
    street.after(hint);
    window.lyndryAddressReady=async function(){
      try {
        var library=await google.maps.importLibrary('places');
        var widget=new library.PlaceAutocompleteElement({includedRegionCodes:['us'],includedPrimaryTypes:['street_address','premise','subpremise'],locationBias:{radius:35000,center:{lat:40.88,lng:-74.05}}});
        widget.setAttribute('aria-label','Pickup address');widget.setAttribute('aria-describedby',hint.id);
        widget.placeholder='Start typing your street address';
        var search=document.createElement('div');search.className='field address-search-field';
        var label=document.createElement('span');label.className='field-label';label.textContent='Pickup address';
        search.append(label,widget,hint);street.closest('.field').before(search);form.classList.add('google-address-form');
        street.closest('.field').hidden=true;town.closest('.pricing-address-row, .grid-2').hidden=true;
        [street,town,zip].forEach(function(input){input.required=false;input.type='hidden';});
        var state=document.createElement('input');state.type='hidden';state.name='state';state.value='NJ';form.append(state);
        var existingUnit=form.querySelector('[name=address_line2]');
        var unitField=existingUnit ? existingUnit.closest('.field') : document.createElement('div');unitField.className='field';
        var unitLabel=document.createElement('label');unitLabel.className='field-label';unitLabel.htmlFor='pricing-unit';unitLabel.textContent='Apartment, suite or unit (optional)';
        var unit=existingUnit||document.createElement('input');unit.id=existingUnit?'address_line2':'pricing-unit';unitLabel.htmlFor=unit.id;unit.name=existingUnit?'address_line2':'unit';unit.className='input';unit.autocomplete='address-line2';unit.maxLength=60;unit.placeholder='e.g. Apt 4B';
        unitField.replaceChildren(unitLabel,unit);search.after(unitField);
        var submit=form.querySelector('[type=submit]');submit.disabled=true;
        var selected=!!(street.value&&town.value&&zip.value);
        if(selected){widget.value=[street.value,town.value,'NJ '+zip.value].join(', ');submit.disabled=false;hint.textContent='Your saved pickup address. Search above to change it.';}
        function status(message,kind){hint.textContent=message;hint.dataset.state=kind||'idle';widget.setAttribute('aria-busy',kind==='loading'?'true':'false');}
        function unavailable(){sequence++;selected=false;submit.disabled=true;status('Address search could not connect. Try typing your address again.','error');}
        form.addEventListener('submit',function(event){if(event.submitter&&event.submitter.formNoValidate)return;if(!selected){event.preventDefault();hint.textContent='Select your address from the suggestions first.';}});
        var sequence=0;
        widget.addEventListener('input',function(){sequence++;selected=false;submit.disabled=true;street.value='';town.value='';zip.value='';state.value='';unit.value='';status('Choose your address from the suggestions.');});
        widget.addEventListener('gmp-select',async function(event){
          var version=++sequence;
          selected=false;submit.disabled=true;status('Checking your selected address…','loading');
          try {
            var place=event.placePrediction.toPlace();
            await place.fetchFields({fields:['addressComponents']});
            if(version!==sequence)return;
            var components=place.addressComponents||[];
            var value=function(type){var c=components.find(function(c){return c.types.includes(type);});return c ? c.longText : '';};
            var selectedText=event.placePrediction?.mainText?.text || event.placePrediction?.text?.text || widget.value || '';
            street.value=streetFromComponents(value('street_number'),value('route'),selectedText);
            town.value=value('locality')||value('sublocality_level_1');
            zip.value=value('postal_code');
            var stateComponent=components.find(function(c){return c.types.includes('administrative_area_level_1');});
            var country=components.find(function(c){return c.types.includes('country');});
            state.value=stateComponent ? stateComponent.shortText : '';
            if(!unit.value)unit.value=value('subpremise');
            selected=!!(street.value&&town.value&&zip.value&&state.value==='NJ'&&country&&country.shortText==='US');submit.disabled=!selected;
            status(selected ? [street.value,town.value,'NJ '+zip.value].join(', ') : 'Choose a complete street address in New Jersey.',selected?'success':'error');
          }catch(error){if(version===sequence)unavailable();}
        });
        widget.addEventListener('gmp-error',unavailable);
      }catch(error){hint.textContent='Address search is unavailable. Please reload the page and try again.';}
    };
    var loader=document.createElement('script');loader.async=true;
    loader.src='https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&libraries=places&callback=lyndryAddressReady';
    loader.onerror=function(){hint.textContent='Address search is unavailable. Please reload the page and try again.';};
    document.head.appendChild(loader);
  })();
  </script>`;
}
module.exports={script};
