var currentLang = localStorage.getItem('lang') || 'zh';
function applyLang(){
  if(currentLang === 'en'){
    document.querySelectorAll('.lang-zh').forEach(el=>el.style.display='none');
    document.querySelectorAll('.lang-en').forEach(el=>el.style.display='');
  }else{
    document.querySelectorAll('.lang-en').forEach(el=>el.style.display='none');
    document.querySelectorAll('.lang-zh').forEach(el=>el.style.display='');
  }
}
document.addEventListener('DOMContentLoaded',applyLang);
document.addEventListener('DOMContentLoaded',function(){
  var btn=document.getElementById('langToggle');
  if(btn){
    btn.addEventListener('click',function(){
      currentLang = currentLang==='zh'?'en':'zh';
      localStorage.setItem('lang',currentLang);
      applyLang();
    });
  }
});
