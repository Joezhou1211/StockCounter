window.currentLang = localStorage.getItem('lang') || 'zh';
function applyLang(){
  if(window.currentLang === 'en'){
    document.querySelectorAll('.lang-zh').forEach(el=>el.style.display='none');
    document.querySelectorAll('.lang-en').forEach(el=>el.style.display='');
  }else{
    document.querySelectorAll('.lang-en').forEach(el=>el.style.display='none');
    document.querySelectorAll('.lang-zh').forEach(el=>el.style.display='');
  }
  document.body.dispatchEvent(new Event('langChanged'));
}
document.addEventListener('DOMContentLoaded',applyLang);
document.addEventListener('DOMContentLoaded',function(){
  var btn=document.getElementById('langToggle');
  if(btn){
    btn.addEventListener('click',function(){
      window.currentLang = window.currentLang==='zh'?'en':'zh';
      localStorage.setItem('lang',window.currentLang);
      applyLang();
    });
  }
});

window.t = function(zh,en){
  return (window.currentLang==='en'? en : zh);
};
