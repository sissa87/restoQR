// ============================================================================
// ترويسة بسيطة + الفوتر - تُحقن في كل صفحة عبر renderNav()
// 🔒 الصفحات مفصولة عن بعضها عمداً: لا شريط تنقّل بين الصفحات هنا - رابط العودة
// لفهرس الصفحات (index.html) فقط. كل صفحة تُفتح بشكل مستقل ومنفصل تماماً عن البقية،
// ودليل كل الروابط الموحّد يبقى حصرياً في index.html.
// ============================================================================

function renderNav(activePage) {
  const header = document.createElement('header');
  header.className = 'bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-8 py-3.5 sticky top-0 z-50';
  header.innerHTML = `
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-4">
      <a href="index.html" class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-amber-600 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-600/30 text-xl">🔥</div>
        <div>
          <h1 class="font-extrabold text-base text-white tracking-wide flex items-center gap-2">
            <span>موقع ادارة المطعم</span>
            <span class="text-[10px] px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full font-mono font-bold">.... </span>
          </h1>
          <p class="text-[11px] text-slate-400">موقع اادارة طلبات لمطعم</p>
        </div>
      </a>
      <div class="relative shrink-0">${notifBellHtml()}</div>
    </div>
  `;
  document.body.prepend(header);
  initNotificationBell();
}

function notifBellHtml() {
  return `
    <button id="notifBellBtn" class="relative p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-400 transition">
      🔔<span id="notifBadge" class="hidden absolute -top-1 -left-1 bg-rose-600 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center"></span>
    </button>
    <div id="notifDropdown" class="hidden absolute left-0 top-12 w-80 max-w-[90vw] card p-3 space-y-2 max-h-96 overflow-y-auto z-50 shadow-2xl">
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <span class="text-xs font-bold text-white">🔔 التنبيهات</span>
        <button id="notifClearAllBtn" class="text-[10px] text-rose-400 font-bold">مسح الكل</button>
      </div>
      <div id="notifList" class="space-y-1.5"></div>
    </div>`;
}

async function initNotificationBell() {
  if (typeof supabaseClient === 'undefined') return;
  const bellBtns = document.querySelectorAll('#notifBellBtn');
  bellBtns.forEach(btn => btn.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll('#notifDropdown').forEach(d => d.classList.toggle('hidden'));
  });
  document.addEventListener('click', () => document.querySelectorAll('#notifDropdown').forEach(d => d.classList.add('hidden')));

  async function roleFilterOr() {
    const myRole = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role) ? currentProfile.role : null;
    return myRole ? `target_role.eq.ALL,target_role.eq.${myRole}` : `target_role.eq.ALL`;
  }

  async function loadNotifs() {
    const orFilter = await roleFilterOr();

    // عدّاد دقيق: استعلام count منفصل على كل غير المقروء الخاص بهذا الدور، وليس عدّاً داخل آخر 20 فقط
    const { count } = await supabaseClient.from('notifications').select('id', { count: 'exact', head: true })
      .eq('is_read', false).or(orFilter);
    const unread = count || 0;
    document.querySelectorAll('#notifBadge').forEach(b => { b.textContent = unread > 99 ? '99+' : unread; b.classList.toggle('hidden', unread === 0); });

    const { data } = await supabaseClient.from('notifications').select('*').or(orFilter).order('timestamp', { ascending: false }).limit(30);
    const notifs = data || [];
    document.querySelectorAll('#notifList').forEach(list => {
      list.innerHTML = notifs.length ? notifs.map(n => `
        <div data-id="${n.id}" class="notif-item p-2.5 rounded-lg text-xs cursor-pointer transition ${n.is_read ? 'bg-slate-950/50 text-slate-400' : 'bg-amber-500/10 text-white border border-amber-500/20'}">
          <div class="font-bold">${n.title}</div>
          ${n.message ? `<div class="text-[11px] opacity-80 mt-0.5">${n.message}</div>` : ''}
          <div class="text-[9px] text-slate-500 mt-1">${timeAgo(n.timestamp)}</div>
        </div>`).join('') : `<div class="text-center text-slate-500 text-xs py-6">لا توجد تنبيهات</div>`;
    });
    document.querySelectorAll('.notif-item').forEach(el => el.onclick = async () => {
      await supabaseClient.from('notifications').update({ is_read: true }).eq('id', el.dataset.id);
      loadNotifs();
    });
  }

  document.querySelectorAll('#notifClearAllBtn').forEach(btn => btn.onclick = async (e) => {
    e.stopPropagation();
    const orFilter = await roleFilterOr();
    // 🔒 يمسح فقط إشعارات هذا الدور (ALL + دوره الخاص) لا كل إشعارات النظام لكل الموظفين
    await supabaseClient.from('notifications').update({ is_read: true }).eq('is_read', false).or(orFilter);
    loadNotifs();
  });

  loadNotifs();
  supabaseClient.channel(`realtime:notifications:${Math.random()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, loadNotifs).subscribe();
}

function renderFooter() {
  const footer = document.createElement('footer');
  footer.className = 'border-t border-slate-800 bg-slate-900 py-6 text-center text-xs text-slate-500 mt-10';
  footer.innerHTML = `
    <div class="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2">
      <div>المطعم</div>
      <div class="font-mono text-amber-500 font-bold">Dynamic QR Secret Token &amp; Single-Device Secured</div>
    </div>
  `;
  document.body.appendChild(footer);
}
