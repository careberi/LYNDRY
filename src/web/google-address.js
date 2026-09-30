'use strict';
function script(settings = {}) {
  if (!settings.enabled) return '';
  // The browser key is public and must have HTTP referrer and API restrictions.
  const key=encodeURIComponent(settings.browserKey);
  return `<script>
  (function(){
    var form=document.querySelector('.pricing-address-form');
    if(!form)return;
    var street=form.querySelector('[name=street]'), town=form.querySelector('[name=town]'), zip=form.querySelector('[name=zip]');
    var hint=document.createElement('p');hint.className='field-hint';hint.setAttribute('role','status');
    hint.textContent='Start typing to find your address. We check the address before showing a price.';
    street.after(hint);
    window.lyndryAddressReady=async function(){
      try {
        var library=await google.maps.importLibrary('places');
        var widget=new library.PlaceAutocompleteElement({includedRegionCodes:['us'],includedPrimaryTypes:['street_address','premise','subpremise'],locationBias:{radius:35000,center:{lat:40.88,lng:-74.05}}});
        widget.setAttribute('aria-label','Search street address');
        widget.placeholder='Start typing your street address';
        var search=document.createElement('div');search.className='field';
        var label=document.createElement('span');label.className='field-label';label.textContent='Pickup address';
        search.append(label,widget,hint);form.prepend(search);
        street.closest('.field').hidden=true;town.closest('.pricing-address-row').hidden=true;
        [street,town,zip].forEach(function(input){input.required=false;input.type='hidden';});
        var state=document.createElement('input');state.type='hidden';state.name='state';form.append(state);
        var unitField=document.createElement('div');unitField.className='field';
        var unitLabel=document.createElement('label');unitLabel.className='field-label';unitLabel.htmlFor='pricing-unit';unitLabel.textContent='Apartment, suite or unit (optional)';
        var unit=document.createElement('input');unit.id='pricing-unit';unit.name='unit';unit.className='input';unit.autocomplete='address-line2';unit.maxLength=60;
        unitField.append(unitLabel,unit);search.after(unitField);
        var submit=form.querySelector('[type=submit]');submit.disabled=true;
        var selected=false;
        form.addEventListener('submit',function(event){if(!selected){event.preventDefault();hint.textContent='Select your address from the suggestions first.';}});
        var sequence=0;
        widget.addEventListener('input',function(){sequence++;selected=false;submit.disabled=true;street.value='';town.value='';zip.value='';state.value='';unit.value='';hint.textContent='Select your address from the suggestions.';});
        widget.addEventListener('gmp-select',async function(event){
          var version=++sequence;
          hint.textContent='Loading address…';
          try {
            var place=event.placePrediction.toPlace();
            await place.fetchFields({fields:['addressComponents']});
            if(version!==sequence)return;
            var components=place.addressComponents||[];
            var value=function(type){var c=components.find(function(c){return c.types.includes(type);});return c ? c.longText : '';};
            street.value=[value('street_number'),value('route')].filter(Boolean).join(' ');
            town.value=value('locality')||value('sublocality_level_1');
            zip.value=value('postal_code');
            var stateComponent=components.find(function(c){return c.types.includes('administrative_area_level_1');});
            var country=components.find(function(c){return c.types.includes('country');});
            state.value=stateComponent ? stateComponent.shortText : '';
            if(!unit.value)unit.value=value('subpremise');
            selected=!!(street.value&&town.value&&zip.value&&state.value==='NJ'&&country&&country.shortText==='US');submit.disabled=!selected;
            hint.textContent=selected ? 'Address selected. Add an apartment or unit if needed.' : 'Choose a complete street address in New Jersey.';
          }catch(error){hint.textContent='Address search is unavailable. Please reload the page and try again.';}
        });
        widget.addEventListener('gmp-error',function(){hint.textContent='Address search is unavailable. Please reload the page and try again.';});
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
