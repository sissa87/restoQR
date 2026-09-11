// ============================================================================
// عميل Supabase الموحّد + دوال مساعدة (CRUD, Realtime, Toast, Formatters)
// يعتمد على مكتبة supabase-js عبر CDN (مذكورة في كل صفحة HTML)
// ============================================================================

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

// ---------------------------------------------------------------------------
// أدوات عامة
// ---------------------------------------------------------------------------
function genId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDA(amount) {
  return `${Number(amount || 0).toLocaleString('ar-DZ')} د.ج`;
}

function timeAgo(isoDate) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  return `منذ ${hrs} س`;
}

// تنبيه سريع (Toast) أعلى الشاشة
function showToast(message, type = 'info') {
  const colors = {
    success: 'bg-emerald-600',
    error: 'bg-rose-600',
    info: 'bg-slate-800',
    warning: 'bg-amber-600'
  };
  const el = document.createElement('div');
  el.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] ${colors[type] || colors.info} text-white font-bold px-5 py-3 rounded-xl shadow-2xl border border-white/10 text-sm animate-[fadeIn_.2s_ease]`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; }, 2200);
  setTimeout(() => el.remove(), 2700);
}

// ---------------------------------------------------------------------------
// معرّف الجهاز (لكل متصفح/جوال معرّف ثابت مخزن محلياً - لجلسات QR)
// ---------------------------------------------------------------------------
function getDeviceId() {
  let id = localStorage.getItem('staifi_grill_device_id');
  if (!id) {
    id = `DEV-${Math.random().toString(36).substring(2, 10).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    localStorage.setItem('staifi_grill_device_id', id);
  }
  return id;
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'موبايل أندرويد (Android)';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'موبايل أيفون (iOS)';
  return 'متصفح كمبيوتر / حاسوب';
}

// ---------------------------------------------------------------------------
// دوال قراءة عامة (Fetch helpers) - تُرجع مصفوفة أو null عند الخطأ
// ---------------------------------------------------------------------------
async function fetchAll(table, orderCol = null, ascending = true) {
  let q = supabaseClient.from(table).select('*');
  if (orderCol) q = q.order(orderCol, { ascending });
  const { data, error } = await q;
  if (error) { console.error(`fetchAll(${table})`, error); showToast('تعذر تحميل البيانات، حاول لاحقاً', 'error'); return []; }
  return data || [];
}

// 🆕 نسخة تُحمّل كل الصفوف فعلياً عبر صفحات (range) متتالية - fetchAll العادية تتوقف عند الحد الافتراضي
// لـ PostgREST (غالباً 1000 صف)، فأي جدول يكبر عن ذلك (كسجل الطلبات على المدى الطويل) تختفي صفوفه
// الأقدم بصمت دون أي خطأ ظاهر. استخدمها لأي جدول يُتوقع أن ينمو بلا حد (orders، revenue_log، إلخ).
async function fetchAllPaginated(table, orderCol = null, ascending = true, pageSize = 1000) {
  let all = [], from = 0;
  while (true) {
    let q = supabaseClient.from(table).select('*').range(from, from + pageSize - 1);
    if (orderCol) q = q.order(orderCol, { ascending });
    const { data, error } = await q;
    if (error) { console.error(`fetchAllPaginated(${table})`, error); showToast('تعذر تحميل كل البيانات، حاول لاحقاً', 'error'); break; }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function insertRow(table, row) {
  const { data, error } = await supabaseClient.from(table).insert(row).select().single();
  if (error) { console.error(`insertRow(${table})`, error); showToast(friendlyRpcError(error) || 'تعذر إتمام العملية، حاول لاحقاً', 'error'); return null; }
  return data;
}

async function updateRow(table, matchCol, matchVal, patch) {
  const { data, error } = await supabaseClient.from(table).update(patch).eq(matchCol, matchVal).select();
  if (error) { console.error(`updateRow(${table})`, error); showToast(friendlyRpcError(error) || 'تعذر تحديث البيانات، حاول لاحقاً', 'error'); return null; }
  return data;
}

async function deleteRow(table, matchCol, matchVal) {
  const { error } = await supabaseClient.from(table).delete().eq(matchCol, matchVal);
  if (error) { console.error(`deleteRow(${table})`, error); showToast(friendlyRpcError(error) || 'تعذر حذف العنصر (تأكد أنه غير مرتبط بعناصر أخرى)', 'error'); return false; }
  return true;
}

// رسالة تشخيصية واضحة عندما يكون السبب الحقيقي هو عدم تنفيذ ملفات SQL الجديدة بعد
// (دالة/عمود غير موجود) بدل رسالة عامة غير مفيدة تُخفي السبب الحقيقي
function friendlyRpcError(error) {
  if (!error) return null;
  const msg = (error.message || '').toLowerCase();
  if (error.code === 'PGRST202' || msg.includes('could not find the function') || msg.includes('schema cache')) {
    return '⚠️ إعداد النظام غير مكتمل بعد (دالة قاعدة بيانات مفقودة) - أبلغ إدارة المطعم بتنفيذ آخر ترقية SQL';
  }
  if (error.code === '42703' || (msg.includes('does not exist') && msg.includes('column'))) {
    return '⚠️ إعداد النظام غير مكتمل بعد (عمود قاعدة بيانات مفقود) - أبلغ إدارة المطعم بتنفيذ آخر ترقية SQL';
  }
  return null;
}

// رقم تعريفي تسلسلي يتجدد يومياً (يبدأ من جديد كل يوم) - يُستخدم لأرقام التذاكر والطلبات
async function getNextDailyNumber(table, numberCol, startFrom = 100) {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const { data, error } = await supabaseClient.from(table).select(numberCol)
    .gte('created_at', startOfDay.toISOString())
    .order(numberCol, { ascending: false }).limit(1);
  if (error) { console.error(`getNextDailyNumber(${table})`, error); }
  return (data && data[0] ? data[0][numberCol] : startFrom) + 1;
}

// اشتراك تحديث حي (Realtime) على جدول معيّن، ينفّذ callback عند أي تغيير (أو نوع محدد فقط عبر event)
function subscribeToTable(table, callback, event = '*') {
  return supabaseClient
    .channel(`realtime:${table}:${genId('ch')}`)
    .on('postgres_changes', { event, schema: 'public', table }, callback)
    .subscribe();
}

// ---------------------------------------------------------------------------
// 🆕 تنبيه صوتي + مرئي عند تأكيد طلب جديد (للمحاسب والمراقب) - نغمة تُولَّد
// مباشرة عبر Web Audio API (لا حاجة لملف صوتي خارجي)، مع بانر مرئي بارز يبقى
// ظاهراً حتى يضغط الموظف عليه أو تنتهي مدته.
// ---------------------------------------------------------------------------
let _newOrderAudioCtx = null;
function playNewOrderAlertSound() {
  try {
    _newOrderAudioCtx = _newOrderAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _newOrderAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    // نغمتان متتاليتان (دو-صول) تُحاكي "دينغ" تنبيه الطلبات
    [880, 1108].forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(start); osc.stop(start + 0.4);
    });
  } catch (e) { console.error('playNewOrderAlertSound', e); }
}

// بانر مرئي بارز أعلى الشاشة (منفصل عن showToast الصغير) - يبقى حتى يُغلَق يدوياً أو بعد 8 ثوانٍ
function showBigOrderAlert(title, subtitle) {
  const el = document.createElement('div');
  el.className = 'fixed top-4 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-[10000] max-w-md sm:w-full bg-amber-500 text-slate-950 rounded-2xl shadow-2xl border-2 border-amber-300 px-5 py-4 flex items-center gap-3 animate-[fadeIn_.2s_ease]';
  el.style.animation = 'pulseAlert 1s ease-in-out 3';
  el.innerHTML = `
    <span class="text-3xl">🔔</span>
    <div class="flex-1 min-w-0">
      <div class="font-extrabold text-sm">${title}</div>
      ${subtitle ? `<div class="text-xs font-bold opacity-80">${subtitle}</div>` : ''}
    </div>
    <button class="shrink-0 px-2 py-1 bg-slate-950/10 hover:bg-slate-950/20 rounded-lg font-bold text-xs">✕</button>`;
  el.querySelector('button').onclick = () => el.remove();
  document.body.appendChild(el);
  if (!document.getElementById('pulseAlertStyle')) {
    const style = document.createElement('style');
    style.id = 'pulseAlertStyle';
    style.textContent = `@keyframes pulseAlert { 0%,100% { transform: scale(1) translateX(var(--tw-translate-x,0)); } 50% { transform: scale(1.03) translateX(var(--tw-translate-x,0)); } }`;
    document.head.appendChild(style);
  }
  setTimeout(() => { el.style.transition = 'opacity .5s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 600); }, 8000);
}

// اشتراك مخصص: تنبيه صوتي+مرئي عند كل طلب جديد يُنشأ (INSERT فقط - لا يتكرر عند أي تعديل لاحق)
function subscribeToNewOrderAlerts() {
  return subscribeToTable('orders', (payload) => {
    const o = payload.new;
    if (!o) return;
    playNewOrderAlertSound();
    showBigOrderAlert('🆕 طلب جديد وصل!', `طلب #${o.order_number}${o.table_number ? ` - طاولة #${o.table_number}` : ''} - ${formatDA(o.total_amount)}`);
  }, 'INSERT');
}

// إضافة سجل تدقيق (Audit Log)
async function addAuditLog(action, role, details, status = 'SUCCESS') {
  return insertRow('audit_logs', { id: genId('log'), action, role, details, status });
}

// إضافة إشعار
async function addNotification(title, message, targetRole = 'ALL', priority = 'MEDIUM') {
  return insertRow('notifications', { id: genId('notif'), title, message, target_role: targetRole, priority, is_read: false });
}
